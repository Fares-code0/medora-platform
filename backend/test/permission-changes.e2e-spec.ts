import { Redis } from 'ioredis';
import { Secret, TOTP } from 'otpauth';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  PERMISSION_CACHE,
  PLATFORM_ROLES,
  SEEDED_MATRIX,
  type CachedPermissions,
  type PermissionCache,
} from '../src/shared/authz';
import {
  PERMISSION_CACHE_KEY_PREFIX,
  RedisPermissionCache,
} from '../src/shared/authz/redis-permission-cache';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  markVerified,
  registrationBody,
  testEmail,
} from './support/auth-app';

/**
 * G4 (ADR-047) — permission changes apply on the next request, fail closed.
 *
 * Against real PostgreSQL (the triggers that bump `users.permission_version`)
 * and real Redis (the shared permission cache). The cache is the real
 * `RedisPermissionCache` behind a wrapper whose **invalidations can be made
 * to fail**: with them failing, a stale entry stays in Redis, and the only
 * thing between it and an authorization decision is the version check.
 *
 * Routes used as probes, both `@Can`-guarded `GET`s with no side effect:
 *
 * - `GET /me/ai-settings` — `ai.use` (doctor: yes; laboratory: no);
 * - `GET /me/incident-bookmarks` — `logs.view` (doctor: no).
 */
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const MATRIX = '/api/v1/roles/matrix';
const ADMIN_USERS = '/api/v1/admin/users';
const AI_SETTINGS = '/api/v1/me/ai-settings';
const BOOKMARKS = '/api/v1/me/incident-bookmarks';
const PASSWORD = 'Medora123!';

/** The real Redis cache, with invalidation that can be switched to fail. */
class SwitchableCache implements PermissionCache {
  failInvalidation = false;
  constructor(readonly inner: RedisPermissionCache) {}

  get(userId: string): Promise<CachedPermissions | undefined> {
    return this.inner.get(userId);
  }
  set(userId: string, entry: CachedPermissions): Promise<void> {
    return this.inner.set(userId, entry);
  }
  forget(userId: string): Promise<void> {
    return this.failInvalidation ? this.down() : this.inner.forget(userId);
  }
  forgetMany(userIds: readonly string[]): Promise<void> {
    return this.failInvalidation ? this.down() : this.inner.forgetMany(userIds);
  }
  clear(): Promise<void> {
    return this.failInvalidation ? this.down() : this.inner.clear();
  }
  private down(): Promise<void> {
    return Promise.reject(new Error('redis down (invalidation)'));
  }
}

let harness: AuthHarness;
let cache: SwitchableCache;
let raw: Redis;

function currentCode(secret: string): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

async function seedAccount(local: string): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  return email;
}

async function tokenFor(email: string): Promise<string> {
  const response = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });
  return dataOf<{ accessToken: string }>(response).accessToken;
}

async function adminToken(local: string): Promise<string> {
  const email = await seedAccount(local);
  const bootstrap = await tokenFor(email);

  const setup = await request(harness.server)
    .post('/api/v1/me/2fa/setup')
    .set('Authorization', `Bearer ${bootstrap}`)
    .send({ password: PASSWORD });
  const secret = dataOf<{ secret: string }>(setup).secret;
  await request(harness.server)
    .post('/api/v1/me/2fa/enable')
    .set('Authorization', `Bearer ${bootstrap}`)
    .send({ code: currentCode(secret) });

  const adminRole = await harness.prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
  await harness.prisma.user.update({ where: { email }, data: { roleId: adminRole.id } });

  const login = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });
  const verified = await request(harness.server)
    .post('/api/v1/auth/otp/verify')
    .send({ otpToken: dataOf<{ otpToken: string }>(login).otpToken, code: currentCode(secret) });
  return dataOf<{ accessToken: string }>(verified).accessToken;
}

async function account(email: string) {
  return harness.prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true, publicId: true, permissionVersion: true },
  });
}

async function status(path: string, token: string): Promise<number> {
  return (await request(harness.server).get(path).set('Authorization', `Bearer ${token}`)).status;
}

async function setOverrides(
  admin: string,
  publicId: string,
  body: { granted: string[]; revoked: string[] },
): Promise<void> {
  const response = await request(harness.server)
    .put(`/api/v1/users/${publicId}/permissions`)
    .set('Authorization', `Bearer ${admin}`)
    .send(body);
  expect(response.status).toBe(200);
}

async function liveSessions(userId: string): Promise<number> {
  return harness.prisma.session.count({ where: { userId, revokedAt: null } });
}

async function cachedEntry(userId: string): Promise<{ v: number; p: string[] } | null> {
  const value = await raw.get(`${PERMISSION_CACHE_KEY_PREFIX}${userId}`);
  return value === null ? null : (JSON.parse(value) as { v: number; p: string[] });
}

function seededGrid(): Record<string, string[]> {
  return Object.fromEntries(PLATFORM_ROLES.map((role) => [role, [...SEEDED_MATRIX[role]]]));
}

async function putMatrix(admin: string, grid: Record<string, string[]>): Promise<void> {
  const current = await request(harness.server).get(MATRIX).set('Authorization', `Bearer ${admin}`);
  const response = await request(harness.server)
    .put(MATRIX)
    .set('Authorization', `Bearer ${admin}`)
    .send({ grid, revision: dataOf<{ revision: number }>(current).revision, confirm: true });
  expect(response.status).toBe(200);
}

beforeAll(async () => {
  const inner = new RedisPermissionCache(REDIS_URL);
  await inner.ready();
  cache = new SwitchableCache(inner);
  raw = new Redis(REDIS_URL);
  harness = await createAuthHarness('permission-changes', {
    overrides: [{ token: PERMISSION_CACHE, value: cache }],
  });
}, 60_000);

afterAll(async () => {
  await harness.reset();
  await harness.close();
  await cache.inner.onModuleDestroy();
  await raw.quit();
});

beforeEach(async () => {
  cache.failInvalidation = false;
  await harness.reset();
});

describe('per-user overrides (API §15.5) apply on the next request', () => {
  it('a granted permission is effective on the next request, without re-login', async () => {
    const admin = await adminToken('grant-admin');
    const email = await seedAccount('grant-doctor');
    const token = await tokenFor(email);
    const { id, publicId } = await account(email);

    expect(await status(BOOKMARKS, token)).toBe(403);

    await setOverrides(admin, publicId, { granted: ['logs.view'], revoked: [] });

    // Same token: no refresh, no sign-in.
    expect(await status(BOOKMARKS, token)).toBe(200);
    expect(await liveSessions(id)).toBe(1);
  });

  it('a revoked permission is refused on the next request', async () => {
    const admin = await adminToken('revoke-admin');
    const email = await seedAccount('revoke-doctor');
    const token = await tokenFor(email);
    const { id, publicId } = await account(email);

    expect(await status(AI_SETTINGS, token)).toBe(200);

    await setOverrides(admin, publicId, { granted: [], revoked: ['ai.use'] });

    expect(await status(AI_SETTINGS, token)).toBe(403);
    // An ordinary permission change does not end the sign-in.
    expect(await liveSessions(id)).toBe(1);
    expect(await status(BOOKMARKS, token)).toBe(403);
  });

  it('the stale claim in the token is replaced, so /auth/session reports the current set', async () => {
    const admin = await adminToken('claim-admin');
    const email = await seedAccount('claim-doctor');
    const token = await tokenFor(email);
    const { publicId } = await account(email);

    await setOverrides(admin, publicId, { granted: ['logs.view'], revoked: ['ai.use'] });

    const session = await request(harness.server)
      .get('/api/v1/auth/session')
      .set('Authorization', `Bearer ${token}`);
    expect(session.status).toBe(200);
    const permissions = dataOf<{ permissions: string[] }>(session).permissions;
    expect(permissions).toContain('logs.view');
    expect(permissions).not.toContain('ai.use');
  });
});

describe('a stale cache entry is never used', () => {
  it('an entry stamped with the old version is ignored when invalidation fails (fail closed)', async () => {
    const admin = await adminToken('stale-admin');
    const email = await seedAccount('stale-doctor');
    const token = await tokenFor(email);
    const before = await account(email);

    // Warm the cache at the current version.
    expect(await status(AI_SETTINGS, token)).toBe(200);
    expect((await cachedEntry(before.id))?.v).toBe(before.permissionVersion);

    cache.failInvalidation = true;
    // The change commits; its invalidation fails and is logged; the old
    // entry — which still grants `ai.use` — stays in Redis.
    await setOverrides(admin, before.publicId, { granted: [], revoked: ['ai.use'] });
    const stale = await cachedEntry(before.id);
    expect(stale?.p).toContain('ai.use');
    expect(stale?.v).toBe(before.permissionVersion);

    const after = await account(email);
    expect(after.permissionVersion).toBeGreaterThan(before.permissionVersion);

    expect(await status(AI_SETTINGS, token)).toBe(403);
    // Re-resolved and re-stamped at the new version.
    const fresh = await cachedEntry(before.id);
    expect(fresh?.v).toBe(after.permissionVersion);
    expect(fresh?.p).not.toContain('ai.use');
  });

  it('a planted entry at a different version grants nothing', async () => {
    const email = await seedAccount('planted-doctor');
    const token = await tokenFor(email);
    const { id, permissionVersion } = await account(email);

    await raw.set(
      `${PERMISSION_CACHE_KEY_PREFIX}${id}`,
      JSON.stringify({ v: permissionVersion + 1, p: ['logs.view'] }),
      'PX',
      60_000,
    );

    expect(await status(BOOKMARKS, token)).toBe(403);
  });

  it('a pre-G4 entry (bare array, no version) grants nothing', async () => {
    const email = await seedAccount('legacy-doctor');
    const token = await tokenFor(email);
    const { id } = await account(email);

    await raw.set(`${PERMISSION_CACHE_KEY_PREFIX}${id}`, '["logs.view"]', 'PX', 60_000);

    expect(await status(BOOKMARKS, token)).toBe(403);
  });
});

describe('role-permission edits (API §15.3) reach every member of the role', () => {
  it('a matrix grant and its revert apply to every laboratory user on the next request', async () => {
    const admin = await adminToken('matrix-admin');
    const laboratory = await harness.prisma.role.findUniqueOrThrow({
      where: { code: 'laboratory' },
    });
    const emails = [await seedAccount('lab-one'), await seedAccount('lab-two')];
    for (const email of emails) {
      await harness.prisma.user.update({ where: { email }, data: { roleId: laboratory.id } });
    }
    const tokens = [await tokenFor(emails[0]!), await tokenFor(emails[1]!)];

    for (const token of tokens) expect(await status(AI_SETTINGS, token)).toBe(403);

    // Invalidation failing too: the version alone must carry the change.
    cache.failInvalidation = true;
    const grid = seededGrid();
    grid['laboratory'] = [...grid['laboratory']!, 'ai.use'];
    try {
      await putMatrix(admin, grid);
      for (const token of tokens) expect(await status(AI_SETTINGS, token)).toBe(200);
    } finally {
      await putMatrix(admin, seededGrid());
    }

    for (const token of tokens) expect(await status(AI_SETTINGS, token)).toBe(403);
    for (const email of emails) expect(await liveSessions((await account(email)).id)).toBe(1);
  });
});

describe('a role change: ADR-046 plus the approved G4 contract', () => {
  it('the old access token is refused 401, the sessions are revoked; the account signs in under the new role', async () => {
    const admin = await adminToken('role-admin');
    const email = await seedAccount('role-subject');
    const token = await tokenFor(email);
    const { id, publicId, permissionVersion } = await account(email);

    const response = await request(harness.server)
      .patch(`${ADMIN_USERS}/${publicId}`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ role: 'laboratory' });
    expect(response.status).toBe(200);

    expect(await status(AI_SETTINGS, token)).toBe(401);
    // ADR-046 §2 refuses the role claim; the approved G4 contract also
    // revokes the sessions (database trigger, same transaction).
    expect(await liveSessions(id)).toBe(0);
    // The database also bumped the version with the role change.
    expect((await account(email)).permissionVersion).toBeGreaterThan(permissionVersion);

    const fresh = await tokenFor(email);
    expect(await status(AI_SETTINGS, fresh)).toBe(403);
  });
});
