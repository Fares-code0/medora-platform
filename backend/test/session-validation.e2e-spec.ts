import type { Type } from '@nestjs/common';
import { ModulesContainer, Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ALLOW_ENDED_SESSION_KEY } from '../src/common/auth/allow-ended-session.decorator';
import { UserStatus } from '../src/generated/prisma/enums';
import { SessionService } from '../src/modules/auth/services/session.service';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  endGraceWindow,
  errorBody,
  markVerified,
  registrationBody,
  testEmail,
} from './support/auth-app';

/**
 * PRE-01 — per-request session validation (owner decisions I4 and O-13,
 * FINAL; MFA recovery spec v1.2.1 §5.1; risk MRR-01).
 *
 * Before PRE-01 the access-token guard checked the signature and nothing
 * else, so every way of ending a session — logout, "sign out of this
 * session", sign out everywhere, suspension, single-session sign-in —
 * stopped the *refresh* and left the access token working for up to
 * `JWT_ACCESS_TTL` (900 s). Each case below holds an access token that
 * is unexpired and validly signed, ends its session by one of those
 * routes, and asserts the **very next** request is refused.
 *
 * The refusal is the same 401 `unauthorized` in every case: the client's
 * next move (ADR-013: refresh once, then sign out) does not depend on
 * why, and a token-holder who could tell the cases apart could probe
 * account state.
 */
let harness: AuthHarness;

const PREFIX = '/api/v1';
const REGISTER = `${PREFIX}/auth/register`;
const LOGIN = `${PREFIX}/auth/login`;
const REFRESH = `${PREFIX}/auth/refresh`;
const LOGOUT = `${PREFIX}/auth/logout`;
const SESSION = `${PREFIX}/auth/session`;
const MY_SESSIONS = `${PREFIX}/me/sessions`;
const PASSWORD = 'Medora123!';

interface SignedIn {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly sessionId: string;
}

function auth(token: string): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}

function refreshCookieOf(response: { headers: Record<string, unknown> }): string {
  const raw: unknown = response.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : [raw];
  const cookie = cookies.find(
    (value): value is string => typeof value === 'string' && value.startsWith('medora_rt='),
  );
  return /medora_rt=([^;]*)/.exec(cookie ?? '')?.[1] ?? '';
}

async function seedAccount(local: string): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email })).expect(201);
  await markVerified(harness.prisma, email);
  return email;
}

async function signIn(email: string): Promise<SignedIn> {
  const response = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false })
    .expect(200);
  const { accessToken } = dataOf<{ accessToken: string }>(response);
  const sessionId = decodeSid(accessToken);
  return { accessToken, refreshToken: refreshCookieOf(response), sessionId };
}

/** The `sid` claim, read without verifying — the test already trusts this token. */
function decodeSid(accessToken: string): string {
  const claims = new JwtService({}).decode<{ sid?: unknown }>(accessToken);
  if (typeof claims.sid !== 'string') throw new Error('fixture: the access token has no sid');
  return claims.sid;
}

async function expectRefused(accessToken: string, path = SESSION): Promise<void> {
  const response = await request(harness.server).get(path).set(auth(accessToken));
  expect(response.status).toBe(401);
  expect(errorBody(response).code).toBe('unauthorized');
}

async function expectAccepted(accessToken: string, path = SESSION): Promise<void> {
  const response = await request(harness.server).get(path).set(auth(accessToken));
  expect(response.status).toBe(200);
}

beforeAll(async () => {
  harness = await createAuthHarness('session-validation');
});

afterAll(async () => {
  await harness.reset();
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
});

describe('PRE-01 — a live session', () => {
  it('is accepted on every protected route it reaches, not just one', async () => {
    const email = await seedAccount('live');
    const { accessToken } = await signIn(email);

    await expectAccepted(accessToken, SESSION);
    await expectAccepted(accessToken, MY_SESSIONS);
  });

  it('keeps concurrent sessions of one account independent', async () => {
    const email = await seedAccount('concurrent');
    const workstation = await signIn(email);
    const phone = await signIn(email);

    await expectAccepted(workstation.accessToken);
    await expectAccepted(phone.accessToken);
    expect(phone.sessionId).not.toBe(workstation.sessionId);
  });
});

describe('PRE-01 — a revoked session is refused on the next request', () => {
  it('after logout', async () => {
    const email = await seedAccount('logout');
    const { accessToken } = await signIn(email);

    await request(harness.server).post(LOGOUT).set(auth(accessToken)).expect(204);

    await expectRefused(accessToken);
    await expectRefused(accessToken, MY_SESSIONS);
  });

  it('logout stays idempotent: a second logout with the same token is still 204 and clears the cookie', async () => {
    const email = await seedAccount('logout-twice');
    const { accessToken } = await signIn(email);

    await request(harness.server).post(LOGOUT).set(auth(accessToken)).expect(204);
    const again = await request(harness.server).post(LOGOUT).set(auth(accessToken));

    // API §1.6: the cookie is cleared whatever else happens. A client
    // whose session was ended elsewhere is told to drop it, not 401'd.
    expect(again.status).toBe(204);
    const cleared = refreshCookieOf(again);
    expect(cleared).toBe('');
    expect(String(again.headers['set-cookie'])).toContain('medora_rt=;');
  });

  it('logout still refuses a token this service did not sign', async () => {
    const foreign = new JwtService({ secret: 'not-this-deployments-key-000000000000' }).sign({
      sub: '00000000-0000-4000-8000-000000000000',
      pid: 'usr_nobody',
      role: 'doctor',
      permissions: [],
      sid: '00000000-0000-4000-8000-000000000000',
    });

    const response = await request(harness.server).post(LOGOUT).set(auth(foreign));
    expect(response.status).toBe(401);
  });

  it('after "sign out of this session" from another device — and only that session', async () => {
    const email = await seedAccount('revoke-one');
    const lost = await signIn(email);
    const current = await signIn(email);

    await request(harness.server)
      .delete(`${MY_SESSIONS}/${lost.sessionId}`)
      .set(auth(current.accessToken))
      .expect(204);

    await expectRefused(lost.accessToken);
    await expectAccepted(current.accessToken);
  });

  it('after "sign out everywhere else" — the caller keeps working', async () => {
    const email = await seedAccount('revoke-others');
    const first = await signIn(email);
    const second = await signIn(email);
    const current = await signIn(email);

    const response = await request(harness.server)
      .post(`${MY_SESSIONS}/revoke-others`)
      .set(auth(current.accessToken))
      .expect(200);
    expect(dataOf<{ revoked: number }>(response).revoked).toBe(2);

    await expectRefused(first.accessToken);
    await expectRefused(second.accessToken);
    await expectAccepted(current.accessToken);
  });

  it('after a password change — the other sessions end, the changing one continues', async () => {
    const email = await seedAccount('password-change');
    const other = await signIn(email);
    const current = await signIn(email);

    await request(harness.server)
      .post(`${PREFIX}/me/password`)
      .set(auth(current.accessToken))
      .send({ currentPassword: PASSWORD, newPassword: 'Medora456!' })
      .expect(204);

    await expectRefused(other.accessToken);
    await expectAccepted(current.accessToken);
  });

  it('after single-session sign-in on another device', async () => {
    harness.policy.overrides = { singleSessionPerUser: true };
    const email = await seedAccount('single-session');
    const first = await signIn(email);
    const second = await signIn(email);

    await expectRefused(first.accessToken);
    await expectAccepted(second.accessToken);
  });

  it('when the revocation is written directly — the guard reads PostgreSQL, not a copy', async () => {
    const email = await seedAccount('direct');
    const { accessToken, sessionId } = await signIn(email);
    await expectAccepted(accessToken);

    await harness.prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: new Date() },
    });

    await expectRefused(accessToken);
  });
});

describe('PRE-01 — refresh and revocation', () => {
  it('a refresh after logout is refused, and so is the access token it would have replaced', async () => {
    const email = await seedAccount('refresh-after-logout');
    const { accessToken, refreshToken } = await signIn(email);

    await request(harness.server).post(LOGOUT).set(auth(accessToken)).expect(204);

    const refresh = await request(harness.server)
      .post(REFRESH)
      .set('Cookie', `medora_rt=${refreshToken}`);
    expect(refresh.status).toBe(401);
    await expectRefused(accessToken);
  });

  it('an access token minted by a refresh that raced a logout is refused once the logout commits', async () => {
    // The refresh wins the race (its rotation is conditional on
    // `revoked_at IS NULL`, so it can only win by committing first) and
    // hands out a fresh access token for the session. The logout then
    // revokes the row. Before PRE-01 that fresh token worked for its full
    // TTL; now the row decides.
    const email = await seedAccount('refresh-race');
    const signedIn = await signIn(email);

    const refreshed = await request(harness.server)
      .post(REFRESH)
      .set('Cookie', `medora_rt=${signedIn.refreshToken}`)
      .expect(200);
    const fresh = dataOf<{ accessToken: string }>(refreshed).accessToken;
    expect(decodeSid(fresh)).toBe(signedIn.sessionId);

    await request(harness.server).post(LOGOUT).set(auth(signedIn.accessToken)).expect(204);

    await expectRefused(fresh);
    await expectRefused(signedIn.accessToken);
  });

  it('a revoked session family cannot be revived by its rotated refresh token', async () => {
    const email = await seedAccount('reuse');
    const { refreshToken } = await signIn(email);

    const attacker = await request(harness.server)
      .post(REFRESH)
      .set('Cookie', `medora_rt=${refreshToken}`)
      .expect(200);
    const attackerAccess = dataOf<{ accessToken: string }>(attacker).accessToken;
    await expectAccepted(attackerAccess);

    // The real client replays the rotated token — after ADR-045's 30-second
    // grace window, inside which it would be answered as a retry: reuse
    // revokes the family (ADR-026), and the attacker's access token goes
    // with it.
    await endGraceWindow(harness.prisma, email);
    await request(harness.server)
      .post(REFRESH)
      .set('Cookie', `medora_rt=${refreshToken}`)
      .expect(401);

    await expectRefused(attackerAccess);
  });
});

describe('PRE-01 — an expired session is refused', () => {
  it('even while its access token is still unexpired', async () => {
    const email = await seedAccount('expired');
    const { accessToken, sessionId } = await signIn(email);

    // `started_at` moves too: DB §9's CHECK refuses a row that expires
    // before it began.
    const past = Date.now() - 60_000;
    await harness.prisma.session.update({
      where: { id: sessionId },
      data: { startedAt: new Date(past), expiresAt: new Date(past + 1_000) },
    });

    await expectRefused(accessToken);
  });
});

describe('PRE-01 — the account must still be ACTIVE', () => {
  // Asserted on `/me/sessions`, not `/auth/session`: the latter re-reads
  // the user row and refuses a non-ACTIVE account by itself (M8.1), so it
  // would pass with or without the guard's check. `/me/sessions` has no
  // status check of its own — only the guard stands in the way.

  for (const status of [UserStatus.SUSPENDED, UserStatus.LOCKED, UserStatus.INACTIVE]) {
    it(`refuses a live session once the account is ${status}`, async () => {
      const email = await seedAccount(`status-${status.toLowerCase()}`);
      const { accessToken } = await signIn(email);
      await expectAccepted(accessToken, MY_SESSIONS);

      await harness.prisma.user.update({ where: { email }, data: { status } });

      await expectRefused(accessToken, MY_SESSIONS);
    });
  }

  it('refuses a live session once the account is soft-deleted', async () => {
    const email = await seedAccount('soft-deleted');
    const { accessToken } = await signIn(email);

    await harness.prisma.user.update({ where: { email }, data: { deletedAt: new Date() } });

    await expectRefused(accessToken, MY_SESSIONS);
  });

  it('accepts the session again if the account is reactivated before the session is revoked', async () => {
    // A status flip written straight to the row (an operator's
    // containment step, INCIDENT_RESPONSE §3.1) does not itself revoke
    // sessions; reactivating the account therefore restores them. The
    // API's own deactivation revokes sessions as well, so this is only
    // reachable at the database.
    const email = await seedAccount('reactivated');
    const { accessToken } = await signIn(email);

    await harness.prisma.user.update({ where: { email }, data: { status: UserStatus.SUSPENDED } });
    await expectRefused(accessToken, MY_SESSIONS);

    await harness.prisma.user.update({ where: { email }, data: { status: UserStatus.ACTIVE } });
    await expectAccepted(accessToken, MY_SESSIONS);
  });
});

describe('PRE-01 — tokens whose session claim does not hold up', () => {
  function signWithDeploymentKey(claims: Record<string, unknown>): string {
    return new JwtService({ secret: process.env.JWT_SECRET ?? '' }).sign(claims, {
      expiresIn: 300,
    });
  }

  it('refuses a token whose sid belongs to another account', async () => {
    const victimEmail = await seedAccount('sid-victim');
    const holderEmail = await seedAccount('sid-holder');
    const victim = await signIn(victimEmail);
    const holder = await signIn(holderEmail);
    const holderRow = await harness.prisma.user.findUniqueOrThrow({
      where: { email: holderEmail },
    });

    // Validly signed, so only the session check can catch it: `sub` is
    // the holder, `sid` is the victim's live session.
    const mixed = signWithDeploymentKey({
      sub: holderRow.id,
      pid: holderRow.publicId,
      role: 'doctor',
      permissions: [],
      sid: victim.sessionId,
    });

    await expectRefused(mixed);
    await expectAccepted(victim.accessToken);
    await expectAccepted(holder.accessToken);
  });

  it('refuses a sid that names no session', async () => {
    const email = await seedAccount('sid-unknown');
    const row = await harness.prisma.user.findUniqueOrThrow({ where: { email } });

    await expectRefused(
      signWithDeploymentKey({
        sub: row.id,
        pid: row.publicId,
        role: 'doctor',
        permissions: [],
        sid: '00000000-0000-4000-8000-000000000000',
      }),
    );
  });

  it('answers 401, not 500, for a sid or sub that is not a uuid', async () => {
    const email = await seedAccount('sid-malformed');
    const row = await harness.prisma.user.findUniqueOrThrow({ where: { email } });
    const { sessionId } = await signIn(email);

    await expectRefused(
      signWithDeploymentKey({
        sub: row.id,
        pid: row.publicId,
        role: 'doctor',
        permissions: [],
        sid: 'not-a-uuid',
      }),
    );
    await expectRefused(
      signWithDeploymentKey({
        sub: 'not-a-uuid',
        pid: row.publicId,
        role: 'doctor',
        permissions: [],
        sid: sessionId,
      }),
    );
  });
});

describe('PRE-01 — public routes are untouched', () => {
  it('a revoked token does not stop a public route from answering', async () => {
    const email = await seedAccount('public');
    const { accessToken } = await signIn(email);
    await request(harness.server).post(LOGOUT).set(auth(accessToken)).expect(204);

    // `/auth/verification/resend` is `@Public()` and always 202. The
    // guard returns before it looks at a token, so a stale header on a
    // public route is not an error.
    const response = await request(harness.server)
      .post(`${PREFIX}/auth/verification/resend`)
      .set(auth(accessToken))
      .send({ email });
    expect(response.status).toBe(202);
  });
});

/** Validly signed, so only the session checks can refuse it. */
function signedToken(claims: Record<string, unknown>): string {
  return new JwtService({ secret: process.env.JWT_SECRET ?? '' }).sign(claims, { expiresIn: 300 });
}

describe('PRE-01 — the logout exception (@AllowEndedSession) waives liveness, not identity', () => {
  it('is carried by exactly one handler, POST /auth/logout, and by no controller', () => {
    const reflector = new Reflector();
    const carriers: string[] = [];

    for (const module of harness.app.get(ModulesContainer).values()) {
      for (const wrapper of module.controllers.values()) {
        const controller = wrapper.metatype as Type | null;
        if (controller === null) continue;
        if (reflector.get<boolean | undefined>(ALLOW_ENDED_SESSION_KEY, controller) === true) {
          carriers.push(`class ${controller.name}`);
        }
        const prototype = controller.prototype as Record<string, unknown>;
        for (const name of Object.getOwnPropertyNames(prototype)) {
          const handler = prototype[name];
          if (name === 'constructor' || typeof handler !== 'function') continue;
          if (reflector.get<boolean | undefined>(ALLOW_ENDED_SESSION_KEY, handler) === true) {
            carriers.push(`${controller.name}.${name}`);
          }
        }
      }
    }

    expect([...new Set(carriers)]).toEqual(['AuthController.logout']);
  });

  it('an ended session is refused by every other route, reads and writes alike', async () => {
    const email = await seedAccount('ended-write');
    const { accessToken } = await signIn(email);
    await request(harness.server).post(LOGOUT).set(auth(accessToken)).expect(204);

    await expectRefused(accessToken, MY_SESSIONS);
    const write = await request(harness.server)
      .post(`${MY_SESSIONS}/revoke-others`)
      .set(auth(accessToken));
    expect(write.status).toBe(401);
    expect(errorBody(write).code).toBe('unauthorized');
  });

  it('refuses logout when the token’s sid is another account’s session — and leaves that session live', async () => {
    const victimEmail = await seedAccount('logout-victim');
    const holderEmail = await seedAccount('logout-holder');
    const victim = await signIn(victimEmail);
    const holder = await harness.prisma.user.findUniqueOrThrow({ where: { email: holderEmail } });

    const mixed = signedToken({
      sub: holder.id,
      pid: holder.publicId,
      role: 'doctor',
      permissions: [],
      sid: victim.sessionId,
    });

    const response = await request(harness.server).post(LOGOUT).set(auth(mixed));

    expect(response.status).toBe(401);
    const row = await harness.prisma.session.findUniqueOrThrow({ where: { id: victim.sessionId } });
    expect(row.revokedAt).toBeNull();
    await expectAccepted(victim.accessToken);
  });

  it('answers 401, not 500, on logout for a sid that is not a uuid or names no session', async () => {
    const email = await seedAccount('logout-malformed');
    const row = await harness.prisma.user.findUniqueOrThrow({ where: { email } });
    const base = { sub: row.id, pid: row.publicId, role: 'doctor', permissions: [] };

    for (const sid of ['not-a-uuid', '00000000-0000-4000-8000-000000000000']) {
      const response = await request(harness.server)
        .post(LOGOUT)
        .set(auth(signedToken({ ...base, sid })));
      expect(response.status, sid).toBe(401);
    }
  });

  it('still lets a suspended account log out of its own session: 204, cookie cleared, session revoked', async () => {
    const email = await seedAccount('logout-suspended');
    const { accessToken, sessionId } = await signIn(email);
    await harness.prisma.user.update({ where: { email }, data: { status: UserStatus.SUSPENDED } });
    await expectRefused(accessToken, MY_SESSIONS);

    const response = await request(harness.server).post(LOGOUT).set(auth(accessToken));

    expect(response.status).toBe(204);
    expect(String(response.headers['set-cookie'])).toContain('medora_rt=;');
    const row = await harness.prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
    expect(row.revokedAt).not.toBeNull();
  });

  it('logs out an expired session idempotently too', async () => {
    const email = await seedAccount('logout-expired');
    const { accessToken, sessionId } = await signIn(email);
    const past = Date.now() - 60_000;
    await harness.prisma.session.update({
      where: { id: sessionId },
      data: { startedAt: new Date(past), expiresAt: new Date(past + 1_000) },
    });

    await request(harness.server).post(LOGOUT).set(auth(accessToken)).expect(204);
    await request(harness.server).post(LOGOUT).set(auth(accessToken)).expect(204);
  });
});

describe('PRE-01 — a failed session read fails closed', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('answers 5xx with no data, never the protected response, when the session read throws', async () => {
    const email = await seedAccount('db-down');
    const { accessToken } = await signIn(email);
    vi.spyOn(harness.app.get(SessionService), 'activePermissionVersion').mockRejectedValueOnce(
      new Error('connection terminated unexpectedly'),
    );

    const response = await request(harness.server).get(MY_SESSIONS).set(auth(accessToken));

    expect(response.status).toBeGreaterThanOrEqual(500);
    expect((response.body as { data?: unknown }).data).toBeUndefined();
    // The next request, with the database back, is decided normally.
    await expectAccepted(accessToken, MY_SESSIONS);
  });
});
