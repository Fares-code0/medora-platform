import { Secret, TOTP } from 'otpauth';
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
 * `POST /me/password/verify` — the lock screen's re-authentication
 * (`docs/handoff/auth-seam.md` §4.1, A-07; Multi-Hospital A5).
 *
 * The two defects the route exists to remove are asserted directly: an
 * unlock **issues nothing** (no token, no cookie, no session row), and a
 * two-factor account **unlocks in place** with no challenge. The guess
 * budget is asserted to be sign-in's own — failures here lock the
 * account for sign-in too, and the guess that locks it ends the session
 * the lock screen was protecting.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const REFRESH = '/api/v1/auth/refresh';
const VERIFY = '/api/v1/me/password/verify';
const PASSWORD = 'Medora123!';

interface SignedIn {
  readonly email: string;
  readonly userId: string;
  readonly token: string;
  readonly cookie: string;
}

function currentCode(secret: string): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

function refreshCookie(response: { headers: Record<string, unknown> }): string {
  const raw = response.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? (raw as string[]) : [];
  const cookie = cookies.find((value) => value.startsWith('medora_rt='));

  return cookie?.split(';')[0] ?? '';
}

async function signIn(local: string): Promise<SignedIn> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  const login = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });
  expect(login.status).toBe(200);

  const user = await harness.prisma.user.findUniqueOrThrow({ where: { email } });

  return {
    email,
    userId: user.id,
    token: dataOf<{ accessToken: string }>(login).accessToken,
    cookie: refreshCookie(login),
  };
}

function verify(token: string, body: Record<string, unknown>) {
  return request(harness.server).post(VERIFY).set('Authorization', `Bearer ${token}`).send(body);
}

function auditRows(actorId: string, eventType: string) {
  return harness.prisma.auditEvent.findMany({ where: { actorId, eventType } });
}

beforeAll(async () => {
  harness = await createAuthHarness('reauthenticate');
}, 60_000);

beforeEach(async () => {
  harness.policy.overrides = {};
  await harness.reset();
});

afterAll(async () => {
  if (harness === undefined) return;
  await harness.reset();
  await harness.close();
});

describe('POST /me/password/verify', () => {
  it('answers 204 for the right password and issues nothing', async () => {
    const account = await signIn('unlock-ok');
    const before = await harness.prisma.session.count({ where: { userId: account.userId } });

    const response = await verify(account.token, { password: PASSWORD });

    expect(response.status).toBe(204);
    expect(response.text).toBe('');
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(await harness.prisma.session.count({ where: { userId: account.userId } })).toBe(before);

    // The interrupted session is the one that keeps working.
    const refreshed = await request(harness.server).post(REFRESH).set('Cookie', account.cookie);
    expect(refreshed.status).toBe(200);

    const [row] = await auditRows(account.userId, 'auth.reauthenticate');
    expect(row?.category).toBe('AUTHENTICATION');
    expect(row?.severity).toBe('INFO');
  });

  it('answers a wrong password 401 invalid_credentials and spends one guess', async () => {
    const account = await signIn('unlock-wrong');

    const response = await verify(account.token, { password: 'Not-the-password1!' });

    expect(response.status).toBe(401);
    expect(errorBody(response).code).toBe('invalid_credentials');

    const credentials = await harness.prisma.userCredential.findUniqueOrThrow({
      where: { userId: account.userId },
    });
    expect(credentials.failedAttempts).toBe(1);

    const [row] = await auditRows(account.userId, 'auth.reauthenticate_failed');
    expect(row?.severity).toBe('WARNING');
    expect(JSON.stringify(row?.payload)).toContain('"reason":"invalid_credentials"');
    expect(JSON.stringify(row?.payload)).not.toContain('Not-the-password1!');
  });

  it('clears the counter on success, as sign-in does', async () => {
    const account = await signIn('unlock-clears');

    await verify(account.token, { password: 'wrong-1' });
    await verify(account.token, { password: 'wrong-2' });
    expect((await verify(account.token, { password: PASSWORD })).status).toBe(204);

    const credentials = await harness.prisma.userCredential.findUniqueOrThrow({
      where: { userId: account.userId },
    });
    expect(credentials.failedAttempts).toBe(0);
    expect(credentials.lockedUntil).toBeNull();
  });

  it('locks the account at the limit, ends the session and answers 429', async () => {
    harness.policy.overrides = { loginAttemptLimit: 3 };
    const account = await signIn('unlock-lock');

    expect((await verify(account.token, { password: 'wrong-1' })).status).toBe(401);
    expect((await verify(account.token, { password: 'wrong-2' })).status).toBe(401);

    const locking = await verify(account.token, { password: 'wrong-3' });
    expect(locking.status).toBe(429);
    expect(errorBody(locking).code).toBe('rate_limited');
    expect(Number(locking.headers['retry-after'])).toBeGreaterThan(0);

    // The session behind the lock screen is over …
    const refreshed = await request(harness.server).post(REFRESH).set('Cookie', account.cookie);
    expect(refreshed.status).toBe(401);

    // … and sign-in is locked too: one budget, not two.
    const login = await request(harness.server)
      .post(LOGIN)
      .send({ email: account.email, password: PASSWORD, rememberMe: false });
    expect(login.status).toBe(429);
  });

  it('spends from the budget sign-in already used', async () => {
    harness.policy.overrides = { loginAttemptLimit: 2 };
    const account = await signIn('unlock-shared');

    const failedLogin = await request(harness.server)
      .post(LOGIN)
      .send({ email: account.email, password: 'wrong-at-login', rememberMe: false });
    expect(failedLogin.status).toBe(401);

    // One guess left, and the lock screen spends it.
    expect((await verify(account.token, { password: 'wrong-at-lock' })).status).toBe(429);
  });

  it('refuses a correct password while the account is locked, and ends the session', async () => {
    const account = await signIn('unlock-locked');
    await harness.prisma.userCredential.update({
      where: { userId: account.userId },
      data: { lockedUntil: new Date(Date.now() + 10 * 60_000) },
    });

    const response = await verify(account.token, { password: PASSWORD });

    expect(response.status).toBe(429);
    const session = await harness.prisma.session.findFirstOrThrow({
      where: { userId: account.userId },
    });
    expect(session.revokedAt).not.toBeNull();
  });

  it('unlocks a two-factor account in place, with no challenge', async () => {
    const account = await signIn('unlock-2fa');

    const setup = await request(harness.server)
      .post('/api/v1/me/2fa/setup')
      .set('Authorization', `Bearer ${account.token}`)
      .send({ password: PASSWORD });
    const secret = dataOf<{ secret: string }>(setup).secret;
    const enabled = await request(harness.server)
      .post('/api/v1/me/2fa/enable')
      .set('Authorization', `Bearer ${account.token}`)
      .send({ code: currentCode(secret) });
    expect(enabled.status).toBe(204);

    const response = await verify(account.token, { password: PASSWORD });

    expect(response.status).toBe(204);
    expect(response.body).toEqual({});
  });

  it('validates the body', async () => {
    const account = await signIn('unlock-body');

    const response = await verify(account.token, { password: '' });

    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors).toHaveProperty('password');
  });

  it('requires a session', async () => {
    expect((await request(harness.server).post(VERIFY).send({ password: PASSWORD })).status).toBe(
      401,
    );
  });
});
