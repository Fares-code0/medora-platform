import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  markVerified,
  registrationBody,
  testEmail,
} from './support/auth-app';

/**
 * `GET /auth/session`, `/me/sessions`, `/me/devices`, `/me/login-history`
 * (RM M8.1, M8.3–M8.5 — API §1.11, §2.4–2.7).
 *
 * The milestone's verify steps, executable:
 *
 *  · M8.1 "returns the exact `SessionUser` shape" — asserted field by
 *    field, including that nothing else is on the wire.
 *  · M8.3 "revoked session's refresh → 401" — driven over HTTP with the
 *    real cookie rather than by reading `revoked_at` back out, because
 *    the column being set is not the property that matters.
 *  · M8.4 "CRUD round-trip matches `TrustedDevice` shape".
 *  · M8.5 "failed M6 attempts appear with `result: 'failed'`" — a real
 *    wrong-password login is made, not a row inserted.
 *
 * The ownership cases are the ones worth reading: every route here takes
 * its subject from the token, so the test that matters is that a second
 * account's session id and device id are **404**, not 403 — a 403 would
 * confirm the id exists.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const REFRESH = '/api/v1/auth/refresh';
const SESSION = '/api/v1/auth/session';
const SESSIONS = '/api/v1/me/sessions';
const DEVICES = '/api/v1/me/devices';
const HISTORY = '/api/v1/me/login-history';
const PASSWORD = 'Medora123!';

interface SessionPayload {
  user: { id: string; name: string; email: string; role: string; permissions: string[] };
  accessToken: string;
  expiresIn: number;
}

interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
  permissions: string[];
}

interface ActiveSession {
  id: string;
  device: string | null;
  browser: string | null;
  location: string | null;
  ipAddress: string | null;
  startedAt: string;
  lastActiveAt: string;
  current: boolean;
}

interface TrustedDevice {
  id: string;
  name: string;
  platform: string;
  addedAt: string;
  lastSeenAt: string | null;
  current: boolean;
}

interface LoginEventView {
  id: string;
  at: string;
  device: string | null;
  location: string | null;
  ipAddress: string | null;
  status: 'success' | 'failed';
}

interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

interface SignedIn {
  readonly email: string;
  readonly accessToken: string;
  readonly refreshToken: string;
}

function refreshTokenOf(response: { headers: Record<string, unknown> }): string {
  const raw: unknown = response.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : [raw];
  const cookie = cookies.find(
    (value): value is string => typeof value === 'string' && value.startsWith('medora_rt='),
  );
  return /medora_rt=([^;]*)/.exec(cookie ?? '')?.[1] ?? '';
}

async function seedAccount(local: string): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  return email;
}

async function signIn(email: string): Promise<SignedIn> {
  const response = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });

  return {
    email,
    accessToken: dataOf<SessionPayload>(response).accessToken,
    refreshToken: refreshTokenOf(response),
  };
}

async function seedAndSignIn(local: string): Promise<SignedIn> {
  return signIn(await seedAccount(local));
}

beforeAll(async () => {
  harness = await createAuthHarness('account-security');
}, 60_000);

afterAll(async () => {
  // `beforeEach` resets before each case, which leaves the **last**
  // case's accounts in the database for good — a doctor and a user that
  // no later run ever removes. Harmless to this suite, but it enlarges
  // the pool any unconstrained lookup elsewhere draws from, and it
  // compounds run over run (RA-M10.1). Resetting here too closes that.
  await harness.reset();
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
});

describe('GET /auth/session (M8.1)', () => {
  it('returns the SessionUser shape and nothing more', async () => {
    const session = await seedAndSignIn('amelia');

    const response = await request(harness.server)
      .get(SESSION)
      .set('Authorization', `Bearer ${session.accessToken}`);

    expect(response.status).toBe(200);

    const user = dataOf<SessionUser>(response);
    // The exact key set, not a superset: a field added to `users` must
    // not reach the shell by default. `licenseNumber` and `phone` are
    // the two that would, and neither belongs in a session payload.
    expect(Object.keys(user).sort()).toEqual(['email', 'id', 'name', 'permissions', 'role']);
    expect(user.email).toBe(session.email);
    expect(user.id).toMatch(/^usr_/);
    expect(user.role).toBe('doctor');
    expect(Array.isArray(user.permissions)).toBe(true);
  });

  it('matches the payload the login response carried', async () => {
    const email = await seedAccount('parity');
    const login = await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false });

    const fromLogin = dataOf<SessionPayload>(login).user;
    const response = await request(harness.server)
      .get(SESSION)
      .set('Authorization', `Bearer ${dataOf<SessionPayload>(login).accessToken}`);

    // Two code paths build this shape — the login service and the
    // session service — and a client that trusts one must be able to
    // trust the other.
    expect(dataOf<SessionUser>(response)).toEqual(fromLogin);
  });

  it('refuses an unauthenticated caller', async () => {
    const response = await request(harness.server).get(SESSION);

    expect(response.status).toBe(401);
  });

  it('refuses a token whose account has been suspended', async () => {
    const session = await seedAndSignIn('suspended');
    await harness.prisma.user.update({
      where: { email: session.email },
      data: { status: 'SUSPENDED' },
    });

    const response = await request(harness.server)
      .get(SESSION)
      .set('Authorization', `Bearer ${session.accessToken}`);

    // 401 and not 404: the client's correct response is to sign out, and
    // a 404 on your own session renders as a broken page.
    expect(response.status).toBe(401);
  });
});

describe('GET /me/sessions (M8.3)', () => {
  it('lists the live session and flags the current one', async () => {
    const session = await seedAndSignIn('sessions');

    const response = await request(harness.server)
      .get(SESSIONS)
      .set('Authorization', `Bearer ${session.accessToken}`);

    expect(response.status).toBe(200);

    const sessions = dataOf<ActiveSession[]>(response);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.current).toBe(true);
    expect(Object.keys(sessions[0] ?? {}).sort()).toEqual([
      'browser',
      'current',
      'device',
      'id',
      'ipAddress',
      'lastActiveAt',
      'location',
      'startedAt',
    ]);
  });

  it('does not leak the refresh-token hashes', async () => {
    const session = await seedAndSignIn('nohash');

    const response = await request(harness.server)
      .get(SESSIONS)
      .set('Authorization', `Bearer ${session.accessToken}`);

    const raw = JSON.stringify(response.body);
    expect(raw).not.toContain('refreshTokenHash');
    expect(raw).not.toContain('previousTokenHash');
    expect(raw).not.toContain('expiresAt');
  });

  it('shows a second sign-in as a second session, only one current', async () => {
    const email = await seedAccount('two');
    const first = await signIn(email);
    await signIn(email);

    const response = await request(harness.server)
      .get(SESSIONS)
      .set('Authorization', `Bearer ${first.accessToken}`);

    const sessions = dataOf<ActiveSession[]>(response);
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((row) => row.current)).toHaveLength(1);
  });

  it('never shows another account a session it does not own', async () => {
    const mine = await seedAndSignIn('mine');
    const theirs = await seedAndSignIn('theirs');

    const response = await request(harness.server)
      .get(SESSIONS)
      .set('Authorization', `Bearer ${theirs.accessToken}`);

    const ids = dataOf<ActiveSession[]>(response).map((row) => row.id);
    const mineList = await request(harness.server)
      .get(SESSIONS)
      .set('Authorization', `Bearer ${mine.accessToken}`);

    for (const row of dataOf<ActiveSession[]>(mineList)) {
      expect(ids).not.toContain(row.id);
    }
  });
});

describe('DELETE /me/sessions/{id} (M8.3)', () => {
  it("revokes the session so its refresh answers 401", async () => {
    const email = await seedAccount('revoke');
    const doomed = await signIn(email);
    const keeper = await signIn(email);

    const list = await request(harness.server)
      .get(SESSIONS)
      .set('Authorization', `Bearer ${keeper.accessToken}`);
    const target = dataOf<ActiveSession[]>(list).find((row) => !row.current);

    const revoked = await request(harness.server)
      .delete(`${SESSIONS}/${target?.id ?? ''}`)
      .set('Authorization', `Bearer ${keeper.accessToken}`);

    expect(revoked.status).toBe(204);

    // The verify step: the refresh that would have extended the revoked
    // session is refused.
    const refresh = await request(harness.server)
      .post(REFRESH)
      .set('Cookie', `medora_rt=${doomed.refreshToken}`);

    expect(refresh.status).toBe(401);

    // And the keeper's own session still works — "sign out that one"
    // must not be "sign out everything".
    const stillLive = await request(harness.server)
      .post(REFRESH)
      .set('Cookie', `medora_rt=${keeper.refreshToken}`);

    expect(stillLive.status).toBe(200);
  });

  it("answers 404 for another account's session, not 403", async () => {
    const mine = await seedAndSignIn('victim');
    const attacker = await seedAndSignIn('attacker');

    const list = await request(harness.server)
      .get(SESSIONS)
      .set('Authorization', `Bearer ${mine.accessToken}`);
    const victimSessionId = dataOf<ActiveSession[]>(list)[0]?.id ?? '';

    const response = await request(harness.server)
      .delete(`${SESSIONS}/${victimSessionId}`)
      .set('Authorization', `Bearer ${attacker.accessToken}`);

    // A 403 would confirm the id names a real session. The refusal has
    // to be byte-identical to the one a nonsense id produces.
    expect(response.status).toBe(404);
    expect(errorBody(response).code).toBe('not_found');

    const nonsense = await request(harness.server)
      .delete(`${SESSIONS}/11111111-2222-3333-4444-555555555555`)
      .set('Authorization', `Bearer ${attacker.accessToken}`);

    expect(nonsense.status).toBe(404);
    expect(errorBody(nonsense).code).toBe(errorBody(response).code);
  });

  it('leaves the victim able to refresh', async () => {
    const mine = await seedAndSignIn('unharmed');
    const attacker = await seedAndSignIn('thief');

    const list = await request(harness.server)
      .get(SESSIONS)
      .set('Authorization', `Bearer ${mine.accessToken}`);

    await request(harness.server)
      .delete(`${SESSIONS}/${dataOf<ActiveSession[]>(list)[0]?.id ?? ''}`)
      .set('Authorization', `Bearer ${attacker.accessToken}`);

    const refresh = await request(harness.server)
      .post(REFRESH)
      .set('Cookie', `medora_rt=${mine.refreshToken}`);

    expect(refresh.status).toBe(200);
  });

  it('answers 404 for a non-uuid id rather than raising a type error', async () => {
    const session = await seedAndSignIn('badid');

    const response = await request(harness.server)
      .delete(`${SESSIONS}/not-a-uuid`)
      .set('Authorization', `Bearer ${session.accessToken}`);

    // Postgres answers a malformed uuid literal with a type error, which
    // would surface as a 500 — the repository's UUID guard is what makes
    // this a 404.
    expect(response.status).toBe(404);
  });
});

describe('POST /me/sessions/revoke-others (M8.3)', () => {
  it('ends every other session and keeps the caller signed in', async () => {
    const email = await seedAccount('others');
    const first = await signIn(email);
    const second = await signIn(email);
    const caller = await signIn(email);

    const response = await request(harness.server)
      .post(`${SESSIONS}/revoke-others`)
      .set('Authorization', `Bearer ${caller.accessToken}`);

    expect(response.status).toBe(200);
    expect(dataOf<{ revoked: number }>(response).revoked).toBe(2);

    for (const ended of [first, second]) {
      const refresh = await request(harness.server)
        .post(REFRESH)
        .set('Cookie', `medora_rt=${ended.refreshToken}`);
      expect(refresh.status).toBe(401);
    }

    // The button must not log you out of the device you pressed it on.
    const survivor = await request(harness.server)
      .post(REFRESH)
      .set('Cookie', `medora_rt=${caller.refreshToken}`);

    expect(survivor.status).toBe(200);
  });

  it('answers 0 rather than failing when there is nothing to end', async () => {
    const session = await seedAndSignIn('alone');

    const response = await request(harness.server)
      .post(`${SESSIONS}/revoke-others`)
      .set('Authorization', `Bearer ${session.accessToken}`);

    expect(response.status).toBe(200);
    expect(dataOf<{ revoked: number }>(response).revoked).toBe(0);
  });

  it("does not touch another account's sessions", async () => {
    const bystander = await seedAndSignIn('bystander');
    const caller = await seedAndSignIn('caller');

    await request(harness.server)
      .post(`${SESSIONS}/revoke-others`)
      .set('Authorization', `Bearer ${caller.accessToken}`);

    const refresh = await request(harness.server)
      .post(REFRESH)
      .set('Cookie', `medora_rt=${bystander.refreshToken}`);

    expect(refresh.status).toBe(200);
  });
});

describe('/me/devices (M8.4)', () => {
  it('round-trips the TrustedDevice shape', async () => {
    const session = await seedAndSignIn('devices');

    const created = await request(harness.server)
      .post(DEVICES)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ name: "Amelia's MacBook", platform: 'mac', current: true });

    expect(created.status).toBe(201);

    const device = dataOf<TrustedDevice>(created);
    expect(Object.keys(device).sort()).toEqual([
      'addedAt',
      'current',
      'id',
      'lastSeenAt',
      'name',
      'platform',
    ]);
    expect(device.name).toBe("Amelia's MacBook");
    expect(device.platform).toBe('mac');
    expect(device.current).toBe(true);
    // Registering a device is seeing it; "never seen" beside a machine
    // the user is holding would be wrong.
    expect(device.lastSeenAt).not.toBeNull();

    const listed = await request(harness.server)
      .get(DEVICES)
      .set('Authorization', `Bearer ${session.accessToken}`);

    expect(dataOf<TrustedDevice[]>(listed)).toEqual([device]);

    const removed = await request(harness.server)
      .delete(`${DEVICES}/${device.id}`)
      .set('Authorization', `Bearer ${session.accessToken}`);

    expect(removed.status).toBe(204);

    const empty = await request(harness.server)
      .get(DEVICES)
      .set('Authorization', `Bearer ${session.accessToken}`);

    expect(dataOf<TrustedDevice[]>(empty)).toEqual([]);
  });

  it('soft-removes rather than deleting', async () => {
    const session = await seedAndSignIn('soft');

    const created = await request(harness.server)
      .post(DEVICES)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ name: 'Reception PC', platform: 'windows' });

    await request(harness.server)
      .delete(`${DEVICES}/${dataOf<TrustedDevice>(created).id}`)
      .set('Authorization', `Bearer ${session.accessToken}`);

    // "Remove trusted device" is a security event; the row is the record
    // that it happened.
    const row = await harness.prisma.trustedDevice.findUnique({
      where: { id: dataOf<TrustedDevice>(created).id },
    });

    expect(row).not.toBeNull();
    expect(row?.removedAt).not.toBeNull();
  });

  it('keeps exactly one device flagged current', async () => {
    const session = await seedAndSignIn('current');

    await request(harness.server)
      .post(DEVICES)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ name: 'Old laptop', platform: 'windows', current: true });

    await request(harness.server)
      .post(DEVICES)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ name: 'New laptop', platform: 'mac', current: true });

    const listed = await request(harness.server)
      .get(DEVICES)
      .set('Authorization', `Bearer ${session.accessToken}`);

    const devices = dataOf<TrustedDevice[]>(listed);
    expect(devices).toHaveLength(2);
    // "This device" pointing at two machines is a state the UI cannot
    // render honestly.
    expect(devices.filter((device) => device.current)).toHaveLength(1);
    expect(devices.find((device) => device.current)?.name).toBe('New laptop');
  });

  it('rejects an unknown platform with 422 and field errors', async () => {
    const session = await seedAndSignIn('platform');

    const response = await request(harness.server)
      .post(DEVICES)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ name: 'Something', platform: 'blackberry' });

    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors?.['platform']).toBeDefined();
  });

  it("answers 404 for another account's device", async () => {
    const owner = await seedAndSignIn('owner');
    const other = await seedAndSignIn('other');

    const created = await request(harness.server)
      .post(DEVICES)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'Tablet', platform: 'tablet' });

    const response = await request(harness.server)
      .delete(`${DEVICES}/${dataOf<TrustedDevice>(created).id}`)
      .set('Authorization', `Bearer ${other.accessToken}`);

    expect(response.status).toBe(404);

    // And the owner still has it.
    const listed = await request(harness.server)
      .get(DEVICES)
      .set('Authorization', `Bearer ${owner.accessToken}`);

    expect(dataOf<TrustedDevice[]>(listed)).toHaveLength(1);
  });
});

describe('GET /me/login-history (M8.5)', () => {
  it('shows the failed attempt as failed and the success as success', async () => {
    const email = await seedAccount('history');

    await request(harness.server)
      .post(LOGIN)
      .send({ email, password: 'WrongPassword1!', rememberMe: false });

    const session = await signIn(email);

    const response = await request(harness.server)
      .get(HISTORY)
      .set('Authorization', `Bearer ${session.accessToken}`);

    expect(response.status).toBe(200);

    const page = dataOf<Page<LoginEventView>>(response);
    expect(page.totalItems).toBe(2);
    // Newest first.
    expect(page.items[0]?.status).toBe('success');
    expect(page.items[1]?.status).toBe('failed');
    expect(Object.keys(page.items[0] ?? {}).sort()).toEqual([
      'at',
      'device',
      'id',
      'ipAddress',
      'location',
      'status',
    ]);
  });

  it('never publishes the failure code', async () => {
    const email = await seedAccount('whyfail');
    await request(harness.server)
      .post(LOGIN)
      .send({ email, password: 'WrongPassword1!', rememberMe: false });
    const session = await signIn(email);

    const response = await request(harness.server)
      .get(HISTORY)
      .set('Authorization', `Bearer ${session.accessToken}`);

    // `invalid_credentials`, `email_unverified` and `account_inactive`
    // are finer than `LoginEvent.status` renders, and finer than this
    // page should answer.
    expect(JSON.stringify(response.body)).not.toContain('failureCode');
    expect(JSON.stringify(response.body)).not.toContain('invalid_credentials');
  });

  it('pages, and the page envelope is the shared one', async () => {
    const email = await seedAccount('paged');
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await request(harness.server)
        .post(LOGIN)
        .send({ email, password: 'WrongPassword1!', rememberMe: false });
    }
    const session = await signIn(email);

    const response = await request(harness.server)
      .get(`${HISTORY}?page=2&pageSize=2`)
      .set('Authorization', `Bearer ${session.accessToken}`);

    const page = dataOf<Page<LoginEventView>>(response);
    expect(page.page).toBe(2);
    expect(page.pageSize).toBe(2);
    expect(page.totalItems).toBe(4);
    expect(page.totalPages).toBe(2);
    expect(page.items).toHaveLength(2);
  });

  it('rejects a pageSize beyond the ceiling', async () => {
    const session = await seedAndSignIn('greedy');

    const response = await request(harness.server)
      .get(`${HISTORY}?pageSize=5000`)
      .set('Authorization', `Bearer ${session.accessToken}`);

    expect(response.status).toBe(422);
  });

  it("shows only the caller's own attempts", async () => {
    const otherEmail = await seedAccount('noisy');
    await request(harness.server)
      .post(LOGIN)
      .send({ email: otherEmail, password: 'WrongPassword1!', rememberMe: false });

    const session = await seedAndSignIn('quiet');

    const response = await request(harness.server)
      .get(HISTORY)
      .set('Authorization', `Bearer ${session.accessToken}`);

    const page = dataOf<Page<LoginEventView>>(response);
    // One row: this account's own successful sign-in.
    expect(page.totalItems).toBe(1);
    expect(page.items[0]?.status).toBe('success');
  });
});

describe('the activity feed records what the security routes did (M8.6)', () => {
  it('writes a security entry for a device change', async () => {
    const session = await seedAndSignIn('activity');

    const created = await request(harness.server)
      .post(DEVICES)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ name: 'Clinic iPad', platform: 'ios' });

    await request(harness.server)
      .delete(`${DEVICES}/${dataOf<TrustedDevice>(created).id}`)
      .set('Authorization', `Bearer ${session.accessToken}`);

    const user = await harness.prisma.user.findUniqueOrThrow({
      where: { email: session.email },
      select: { id: true },
    });

    // Scoped to `SECURITY`, which is what this test is about. Signing in
    // writes a `LOGIN` row of its own since M29.1 — the feed is not this
    // suite's private space, and asserting the *whole* feed's contents
    // made an unrelated milestone's writer hook fail this file.
    const rows = await harness.prisma.userActivityLog.findMany({
      where: { userId: user.id, kind: 'SECURITY' },
      orderBy: { occurredAt: 'asc' },
    });

    expect(rows.map((row) => row.kind)).toEqual(['SECURITY', 'SECURITY']);
    expect(rows[0]?.summary).toContain('trusted device');
  });
});
