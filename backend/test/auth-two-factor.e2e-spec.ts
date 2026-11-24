import { TOTP, Secret } from 'otpauth';
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
 * TOTP enrolment and the login step-up (RM M6.4, API §1.3–1.4, §2.9).
 *
 * The roadmap asks for a "full 2FA login round-trip with an
 * authenticator lib". `otpauth` plays the authenticator here — the same
 * library the server uses, driven from the secret the setup endpoint
 * hands out, which is exactly what a phone does with a scanned QR. A
 * hand-rolled expected code would prove the implementation agrees with
 * itself; this proves it agrees with RFC 6238.
 */
let harness: AuthHarness;
const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const SETUP = '/api/v1/me/2fa/setup';
const ENABLE = '/api/v1/me/2fa/enable';
const DISABLE = '/api/v1/me/2fa/disable';
const OTP_VERIFY = '/api/v1/auth/otp/verify';
const OTP_RESEND = '/api/v1/auth/otp/resend';
const REFRESH = '/api/v1/auth/refresh';
const PASSWORD = 'Medora123!';

interface SessionPayload {
  user: { id: string; name: string; email: string; role: string; permissions: string[] };
  accessToken: string;
  expiresIn: number;
}
interface Enrolment {
  otpauthUrl: string;
  secret: string;
  recoveryCodes: string[];
}

async function seedAccount(local: string): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  return email;
}

async function accessTokenFor(email: string): Promise<string> {
  const response = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });
  return dataOf<SessionPayload>(response).accessToken;
}

/** What the user's authenticator app would be showing right now. */
function currentCode(secret: string): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

/**
 * Enrols and enables, returning the secret the "phone" now holds and an
 * access token that still works.
 *
 * The token is minted **before** the flag flips, and stays valid:
 * enabling 2FA does not revoke the session it was enabled from. That is
 * what a real user experiences too — the session they enabled 2FA from
 * does not end underneath them.
 *
 * The sessions this setup created are then removed, so a test that
 * counts sessions is counting only what it caused. Since PRE-01 the
 * guard reads the session row on every request, so a token whose row
 * was removed is refused (401): a test that goes on to *use* the token
 * passes `{ keepSession: true }`, which removes every session but the
 * token's own.
 */
async function enrol(
  email: string,
  options: { keepSession?: boolean } = {},
): Promise<{ secret: string; accessToken: string; refreshCookie: string }> {
  const login = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });
  const accessToken = dataOf<SessionPayload>(login).accessToken;
  const rawCookies: unknown = login.headers['set-cookie'];
  const refreshCookie =
    (Array.isArray(rawCookies) ? (rawCookies as unknown[]) : [rawCookies])
      .find((value): value is string => typeof value === 'string' && value.startsWith('medora_rt='))
      ?.split(';')[0] ?? '';
  const enrolment = dataOf<Enrolment>(
    await request(harness.server)
      .post(SETUP)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ password: PASSWORD }),
  );

  await request(harness.server)
    .post(ENABLE)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ code: currentCode(enrolment.secret) });

  const keep = options.keepSession === true ? { id: { not: sidOf(accessToken) } } : {};
  await harness.prisma.session.deleteMany({ where: { user: { email }, ...keep } });

  return { secret: enrolment.secret, accessToken, refreshCookie };
}

/** The `sid` claim of an access token this suite was just issued. */
function sidOf(accessToken: string): string {
  const claims = JSON.parse(
    Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString('utf8'),
  ) as { sid: string };
  return claims.sid;
}

beforeAll(async () => {
  harness = await createAuthHarness('twofactor');
});

afterAll(async () => {
  await harness.reset();
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
});

describe('enrolment', () => {
  it('returns the otpauth URL, the secret and ten recovery codes', async () => {
    const email = await seedAccount('julian');
    const token = await accessTokenFor(email);

    const response = await request(harness.server)
      .post(SETUP)
      .set('Authorization', `Bearer ${token}`)
      .send({ password: PASSWORD });

    expect(response.status).toBe(200);
    const enrolment = dataOf<Enrolment>(response);

    // The client renders the QR from this; the parameters in it are what
    // the authenticator bakes in permanently.
    expect(enrolment.otpauthUrl.startsWith('otpauth://totp/')).toBe(true);
    expect(enrolment.otpauthUrl).toContain('issuer=Medora');
    expect(enrolment.otpauthUrl).toContain(encodeURIComponent(email));
    expect(enrolment.otpauthUrl).toContain('algorithm=SHA1');
    expect(enrolment.otpauthUrl).toContain('digits=6');
    expect(enrolment.otpauthUrl).toContain('period=30');

    expect(enrolment.secret).toMatch(/^[A-Z2-7]+$/);
    expect(enrolment.recoveryCodes).toHaveLength(10);
    expect(new Set(enrolment.recoveryCodes).size).toBe(10);
  });

  it('stores the secret encrypted, never in the clear', async () => {
    const email = await seedAccount('julian');
    const token = await accessTokenFor(email);
    const enrolment = dataOf<Enrolment>(
      await request(harness.server)
        .post(SETUP)
        .set('Authorization', `Bearer ${token}`)
        .send({ password: PASSWORD }),
    );

    const credential = await harness.prisma.userCredential.findFirstOrThrow({
      where: { user: { email } },
    });
    const stored = Buffer.from(credential.totpSecretEnc!);

    expect(stored.toString('utf8')).not.toContain(enrolment.secret);
    expect(stored.toString('base64')).not.toContain(enrolment.secret);
    // 12-byte IV + 16-byte tag, so ciphertext is always longer than the
    // 32-character base32 secret it wraps.
    expect(stored.byteLength).toBeGreaterThan(enrolment.secret.length);
  });

  it('does not turn 2FA on until a code proves the round trip', async () => {
    const email = await seedAccount('julian');
    const token = await accessTokenFor(email);
    await request(harness.server)
      .post(SETUP)
      .set('Authorization', `Bearer ${token}`)
      .send({ password: PASSWORD });

    // A mis-scanned QR would otherwise lock the user out of their own
    // account: flag on, phone holding a different secret, no way back.
    const user = await harness.prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.twoFactorEnabled).toBe(false);

    const stillPasswordOnly = await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false });
    expect(dataOf<SessionPayload>(stillPasswordOnly).accessToken).toBeTruthy();
  });

  it('enables on a code the authenticator produces', async () => {
    const email = await seedAccount('julian');
    const token = await accessTokenFor(email);
    const enrolment = dataOf<Enrolment>(
      await request(harness.server)
        .post(SETUP)
        .set('Authorization', `Bearer ${token}`)
        .send({ password: PASSWORD }),
    );

    const response = await request(harness.server)
      .post(ENABLE)
      .set('Authorization', `Bearer ${token}`)
      .send({ code: currentCode(enrolment.secret) });

    expect(response.status).toBe(204);
    const user = await harness.prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.twoFactorEnabled).toBe(true);
  });

  it('refuses a wrong code with otp_invalid', async () => {
    const email = await seedAccount('julian');
    const token = await accessTokenFor(email);
    await request(harness.server)
      .post(SETUP)
      .set('Authorization', `Bearer ${token}`)
      .send({ password: PASSWORD });

    const response = await request(harness.server)
      .post(ENABLE)
      .set('Authorization', `Bearer ${token}`)
      .send({ code: '000000' });

    expect(response.status).toBe(401);
    expect(errorBody(response).code).toBe('otp_invalid');
    const user = await harness.prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.twoFactorEnabled).toBe(false);
  });

  it('refuses to enable with no enrolment in progress', async () => {
    const email = await seedAccount('julian');
    const token = await accessTokenFor(email);

    const response = await request(harness.server)
      .post(ENABLE)
      .set('Authorization', `Bearer ${token}`)
      .send({ code: '123456' });

    expect(response.status).toBe(409);
    expect(errorBody(response).detail).toBeTruthy();
  });

  it('requires authentication', async () => {
    expect((await request(harness.server).post(SETUP)).status).toBe(401);
    expect((await request(harness.server).post(ENABLE).send({ code: '123456' })).status).toBe(401);
  });

  it('records the change in the user activity feed and the audit ledger', async () => {
    const email = await seedAccount('julian');
    await enrol(email);

    // Scoped to `SECURITY`: enrolling signs in first, and since M29.1
    // that writes a `LOGIN` row of its own. This suite does not own the
    // feed, so it asserts about its own kind rather than its length.
    const activity = await harness.prisma.userActivityLog.findMany({
      where: { user: { email }, kind: 'SECURITY' },
    });

    // DB §A12's feed is what the account owner sees; `audit_events` is
    // what an administrator investigates. A security change needs both.
    expect(activity).toHaveLength(1);
    expect(activity[0]?.kind).toBe('SECURITY');
    expect(activity[0]?.summary).toContain('enabled');
  });
});

describe('disabling', () => {
  it('takes the password and clears the secret', async () => {
    const email = await seedAccount('julian');
    const { accessToken } = await enrol(email, { keepSession: true });

    const response = await request(harness.server)
      .post(DISABLE)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ password: PASSWORD });

    expect(response.status).toBe(204);

    const user = await harness.prisma.user.findUniqueOrThrow({ where: { email } });
    const credential = await harness.prisma.userCredential.findFirstOrThrow({
      where: { user: { email } },
    });

    expect(user.twoFactorEnabled).toBe(false);
    // Leaving the secret behind would mean a later `enable` silently
    // reactivated a factor the user believes they removed.
    expect(credential.totpSecretEnc).toBeNull();
    expect(credential.recoveryCodesEnc).toBeNull();
  });

  it('refuses an administrator, who may not remove their own factor', async () => {
    const email = await seedAccount('marcus');
    const { accessToken: doctorToken, refreshCookie } = await enrol(email, { keepSession: true });

    const adminRole = await harness.prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
    await harness.prisma.user.update({ where: { email }, data: { roleId: adminRole.id } });

    // ADR-046: the token minted for the old role is refused outright, and
    // the session's one refresh mints the administrator token this case is
    // about. The ADR-035 refusal below is then exercised with a token that
    // really carries the `admin` role.
    const stale = await request(harness.server)
      .post(DISABLE)
      .set('Authorization', `Bearer ${doctorToken}`)
      .send({ password: PASSWORD });
    expect(stale.status).toBe(401);

    const refreshed = await request(harness.server).post(REFRESH).set('Cookie', refreshCookie);
    expect(refreshed.status).toBe(200);
    expect(dataOf<SessionPayload>(refreshed).user.role).toBe('admin');
    const accessToken = dataOf<SessionPayload>(refreshed).accessToken;

    const response = await request(harness.server)
      .post(DISABLE)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ password: PASSWORD });

    // ADR-035 §7. Without this an administrator could disable MFA here
    // and then be refused at their next sign-in by the login check, with
    // no self-service way back — the refusal is the kinder outcome as
    // well as the safer one.
    expect(response.status).toBe(403);

    const user = await harness.prisma.user.findUniqueOrThrow({ where: { email } });
    const credential = await harness.prisma.userCredential.findFirstOrThrow({
      where: { user: { email } },
    });
    expect(user.twoFactorEnabled).toBe(true);
    expect(credential.totpSecretEnc).not.toBeNull();
  });

  it('refuses a wrong password', async () => {
    const email = await seedAccount('julian');
    const { accessToken } = await enrol(email, { keepSession: true });

    const response = await request(harness.server)
      .post(DISABLE)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ password: 'Wrong123!' });

    expect(response.status).toBe(401);
    expect(errorBody(response).code).toBe('invalid_credentials');
    const user = await harness.prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.twoFactorEnabled).toBe(true);
  });

  it('ends every session', async () => {
    const email = await seedAccount('julian');
    const { accessToken } = await enrol(email, { keepSession: true });
    // A session from the step-up, so "ends every session" has something
    // to end.
    await request(harness.server).post(LOGIN).send({ email, password: PASSWORD, rememberMe: false });
    // The disabling session itself is live, so the count below cannot be
    // zero by accident.
    expect(
      await harness.prisma.session.count({ where: { user: { email }, revokedAt: null } }),
    ).toBeGreaterThan(0);

    const disabled = await request(harness.server)
      .post(DISABLE)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ password: PASSWORD });
    expect(disabled.status).toBe(204);

    // A security downgrade nobody asked for is most likely someone else
    // being signed in.
    const live = await harness.prisma.session.count({
      where: { user: { email }, revokedAt: null },
    });
    expect(live).toBe(0);

    // PRE-01: "every session" includes the one that disabled 2FA, and its
    // access token stops working on the next request, not at expiry.
    const after = await request(harness.server)
      .get('/api/v1/me/sessions')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(after.status).toBe(401);
  });
});

describe('the login step-up', () => {
  it('completes the round trip with a code from the authenticator', async () => {
    const email = await seedAccount('julian');
    const { secret } = await enrol(email);

    const challenge = await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: true });
    const { otpToken } = dataOf<{ requiresOtp: true; otpToken: string }>(challenge);

    const verified = await request(harness.server)
      .post(OTP_VERIFY)
      .send({ otpToken, code: currentCode(secret) });

    expect(verified.status).toBe(200);
    const payload = dataOf<SessionPayload>(verified);
    // Indistinguishable from a password-only sign-in, which is the point
    // of both paths sharing one implementation.
    expect(payload.user.email).toBe(email);
    expect(payload.user.permissions).toContain('patients.view');
    expect(payload.expiresIn).toBe(900);

    const raw: unknown = verified.headers['set-cookie'];
    const cookies = Array.isArray(raw) ? raw : [raw];
    expect(cookies.some((c) => typeof c === 'string' && c.startsWith('medora_rt='))).toBe(true);
  });

  it('carries rememberMe across the step-up', async () => {
    const email = await seedAccount('julian');
    const { secret } = await enrol(email);

    const challenge = await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: true });
    const { otpToken } = dataOf<{ otpToken: string }>(challenge);

    await request(harness.server).post(OTP_VERIFY).send({ otpToken, code: currentCode(secret) });

    // The flag is chosen on the login form and never sent again (API
    // §1.3's body is `{ otpToken, code }`), so the token has to carry it.
    const session = await harness.prisma.session.findFirstOrThrow({
      where: { user: { email }, revokedAt: null },
    });
    expect(session.rememberMe).toBe(true);
  });

  it('refuses a wrong code and counts the attempt', async () => {
    const email = await seedAccount('julian');
    await enrol(email);

    const challenge = await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false });
    const { otpToken } = dataOf<{ otpToken: string }>(challenge);

    const response = await request(harness.server)
      .post(OTP_VERIFY)
      .send({ otpToken, code: '000000' });

    expect(response.status).toBe(401);
    expect(errorBody(response).code).toBe('otp_invalid');

    const row = await harness.prisma.otpCode.findFirstOrThrow({ where: { user: { email } } });
    expect(row.attempts).toBe(1);
    expect(row.consumedAt).toBeNull();
  });

  it('gives up after the attempt limit with 429', async () => {
    const email = await seedAccount('julian');
    await enrol(email);
    harness.policy.overrides = { loginAttemptLimit: 3 };

    const challenge = await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false });
    const { otpToken } = dataOf<{ otpToken: string }>(challenge);

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 4; attempt += 1) {
      statuses.push(
        (await request(harness.server).post(OTP_VERIFY).send({ otpToken, code: '000000' })).status,
      );
    }

    expect(statuses).toEqual([401, 401, 429, 401]);
  });

  it('cannot be replayed once used', async () => {
    const email = await seedAccount('julian');
    const { secret } = await enrol(email);

    const challenge = await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false });
    const { otpToken } = dataOf<{ otpToken: string }>(challenge);
    const code = currentCode(secret);

    expect((await request(harness.server).post(OTP_VERIFY).send({ otpToken, code })).status).toBe(200);
    // Same token, same still-valid code: the challenge is single-use.
    expect((await request(harness.server).post(OTP_VERIFY).send({ otpToken, code })).status).toBe(401);
    expect(await harness.prisma.session.count({ where: { user: { email } } })).toBe(1);
  });

  it('refuses a token that was never issued', async () => {
    const response = await request(harness.server)
      .post(OTP_VERIFY)
      .send({ otpToken: 'not-a-token', code: '123456' });

    expect(response.status).toBe(401);
    expect(errorBody(response).code).toBe('otp_invalid');
  });

  it('refuses an access token presented as a challenge token', async () => {
    // Both are signed with the same key, so without the `typ` check an
    // access token would resolve here and skip the second factor.
    const email = await seedAccount('julian');
    const accessToken = await accessTokenFor(email);

    const response = await request(harness.server)
      .post(OTP_VERIFY)
      .send({ otpToken: accessToken, code: '123456' });

    expect(response.status).toBe(401);
  });

  it('requires exactly six digits', async () => {
    const response = await request(harness.server)
      .post(OTP_VERIFY)
      .send({ otpToken: 'anything', code: '12345' });

    expect(response.status).toBe(422);
    expect(Object.keys(errorBody(response).fieldErrors ?? {})).toContain('code');
  });

  describe('resend', () => {
    it('is refused inside the frontend countdown', async () => {
      const email = await seedAccount('julian');
      await enrol(email);

      const challenge = await request(harness.server)
        .post(LOGIN)
        .send({ email, password: PASSWORD, rememberMe: false });
      const { otpToken } = dataOf<{ otpToken: string }>(challenge);

      const response = await request(harness.server).post(OTP_RESEND).send({ otpToken });

      // `VerifyOtpPage` declares RESEND_SECONDS = 30 and renders a
      // countdown from it; a server that allowed a resend sooner would
      // make that countdown a lie.
      expect(response.status).toBe(429);
      expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
      expect(Number(response.headers['retry-after'])).toBeLessThanOrEqual(30);
    });

    it('does not extend the deadline once the cooldown has passed', async () => {
      const email = await seedAccount('julian');
      await enrol(email);

      const challenge = await request(harness.server)
        .post(LOGIN)
        .send({ email, password: PASSWORD, rememberMe: false });
      const { otpToken } = dataOf<{ otpToken: string }>(challenge);

      // Rewinding the row rather than waiting thirty seconds. The
      // cooldown is derived from `created_at` precisely so it survives a
      // restart and holds across instances.
      const before = await harness.prisma.otpCode.findFirstOrThrow({ where: { user: { email } } });
      await harness.prisma.otpCode.update({
        where: { id: before.id },
        data: { createdAt: new Date(Date.now() - 31_000) },
      });

      const response = await request(harness.server).post(OTP_RESEND).send({ otpToken });
      expect(response.status).toBe(204);

      // Owner decision 2026-11-06 (C-11): the deadline is absolute.
      const after = await harness.prisma.otpCode.findUniqueOrThrow({ where: { id: before.id } });
      expect(after.expiresAt.getTime()).toBe(before.expiresAt.getTime());
    });

    it('does not reset the attempt count', async () => {
      const email = await seedAccount('julian');
      await enrol(email);

      const challenge = await request(harness.server)
        .post(LOGIN)
        .send({ email, password: PASSWORD, rememberMe: false });
      const { otpToken } = dataOf<{ otpToken: string }>(challenge);

      await request(harness.server).post(OTP_VERIFY).send({ otpToken, code: '000000' });
      const row = await harness.prisma.otpCode.findFirstOrThrow({ where: { user: { email } } });
      await harness.prisma.otpCode.update({
        where: { id: row.id },
        data: { createdAt: new Date(Date.now() - 31_000) },
      });

      await request(harness.server).post(OTP_RESEND).send({ otpToken });

      // Otherwise "resend" would be an unlimited-guesses button.
      const after = await harness.prisma.otpCode.findUniqueOrThrow({ where: { id: row.id } });
      expect(after.attempts).toBe(1);
    });
  });
});

/**
 * The OTP challenge lifetime (owner decision 2026-11-06): ten minutes,
 * absolute from issue (C-11). Resend never extends it, and an expired
 * challenge needs a new sign-in. The deadline is moved into the past in
 * the database rather than waited for, the way the cooldown tests above
 * rewind `created_at`.
 */
describe('the ten-minute absolute challenge lifetime', () => {
  const TEN_MINUTES_MS = 10 * 60 * 1_000;

  beforeEach(() => {
    // An earlier suite lowers the attempt limit and leaves it set.
    harness.policy.overrides = {};
  });

  async function challengeFor(email: string): Promise<string> {
    const response = await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false });
    return dataOf<{ otpToken: string }>(response).otpToken;
  }

  function tokenClaims(otpToken: string): { iat: number; exp: number } {
    const payload = otpToken.split('.')[1] ?? '';
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
      iat: number;
      exp: number;
    };
  }

  /** Lets the next resend past the 30-second cooldown. */
  async function passCooldown(id: string): Promise<void> {
    await harness.prisma.otpCode.update({
      where: { id },
      data: { createdAt: new Date(Date.now() - 31_000) },
    });
  }

  it('issues a deadline ten minutes after issue, in the row and in the token', async () => {
    const email = await seedAccount('julian');
    await enrol(email);
    const issuedAt = Date.now();

    const otpToken = await challengeFor(email);

    const row = await harness.prisma.otpCode.findFirstOrThrow({ where: { user: { email } } });
    // `created_at` is the database's clock and `expires_at` the server's, so
    // they are compared with a tolerance rather than to the millisecond.
    expect(Math.abs(row.expiresAt.getTime() - row.createdAt.getTime() - TEN_MINUTES_MS)).toBeLessThan(2_000);
    expect(Math.abs(row.expiresAt.getTime() - (issuedAt + TEN_MINUTES_MS))).toBeLessThan(5_000);

    const claims = tokenClaims(otpToken);
    expect(claims.exp - claims.iat).toBe(600);
    expect(Math.abs(claims.exp * 1_000 - row.expiresAt.getTime())).toBeLessThan(2_000);
  });

  it('accepts a correct code just before the deadline', async () => {
    const email = await seedAccount('julian');
    const { secret } = await enrol(email);
    const otpToken = await challengeFor(email);
    const row = await harness.prisma.otpCode.findFirstOrThrow({ where: { user: { email } } });
    await harness.prisma.otpCode.update({
      where: { id: row.id },
      data: { expiresAt: new Date(Date.now() + 5_000) },
    });

    const response = await request(harness.server)
      .post(OTP_VERIFY)
      .send({ otpToken, code: currentCode(secret) });

    expect(response.status).toBe(200);
  });

  it('rejects a correct code after the deadline, and issues nothing', async () => {
    const email = await seedAccount('julian');
    const { secret } = await enrol(email);
    const otpToken = await challengeFor(email);
    const row = await harness.prisma.otpCode.findFirstOrThrow({ where: { user: { email } } });
    await harness.prisma.otpCode.update({
      where: { id: row.id },
      data: { expiresAt: new Date(Date.now() - 1) },
    });

    const response = await request(harness.server)
      .post(OTP_VERIFY)
      .send({ otpToken, code: currentCode(secret) });

    expect(response.status).toBe(401);
    expect(errorBody(response).code).toBe('otp_invalid');
    expect(await harness.prisma.session.count({ where: { user: { email } } })).toBe(0);
  });

  it('never moves the deadline across repeated resends', async () => {
    const email = await seedAccount('julian');
    await enrol(email);
    const otpToken = await challengeFor(email);
    const issued = await harness.prisma.otpCode.findFirstOrThrow({ where: { user: { email } } });

    for (let resend = 0; resend < 4; resend += 1) {
      await passCooldown(issued.id);
      expect((await request(harness.server).post(OTP_RESEND).send({ otpToken })).status).toBe(204);
      const row = await harness.prisma.otpCode.findUniqueOrThrow({ where: { id: issued.id } });
      expect(row.expiresAt.getTime()).toBe(issued.expiresAt.getTime());
    }
  });

  it('allows a resend just before the deadline without extending it, and refuses one after', async () => {
    const email = await seedAccount('julian');
    await enrol(email);
    const otpToken = await challengeFor(email);
    const row = await harness.prisma.otpCode.findFirstOrThrow({ where: { user: { email } } });
    const nearDeadline = new Date(Date.now() + 5_000);
    await harness.prisma.otpCode.update({
      where: { id: row.id },
      data: { expiresAt: nearDeadline, createdAt: new Date(Date.now() - 31_000) },
    });

    expect((await request(harness.server).post(OTP_RESEND).send({ otpToken })).status).toBe(204);
    const afterResend = await harness.prisma.otpCode.findUniqueOrThrow({ where: { id: row.id } });
    expect(afterResend.expiresAt.getTime()).toBe(nearDeadline.getTime());

    await harness.prisma.otpCode.update({
      where: { id: row.id },
      data: { expiresAt: new Date(Date.now() - 1), createdAt: new Date(Date.now() - 31_000) },
    });
    const late = await request(harness.server).post(OTP_RESEND).send({ otpToken });
    expect(late.status).toBe(401);
    expect(errorBody(late).code).toBe('otp_invalid');
  });

  it('leaves a still-valid challenge usable after a resend', async () => {
    const email = await seedAccount('julian');
    const { secret } = await enrol(email);
    const otpToken = await challengeFor(email);
    const row = await harness.prisma.otpCode.findFirstOrThrow({ where: { user: { email } } });
    await passCooldown(row.id);

    expect((await request(harness.server).post(OTP_RESEND).send({ otpToken })).status).toBe(204);
    const verified = await request(harness.server)
      .post(OTP_VERIFY)
      .send({ otpToken, code: currentCode(secret) });

    expect(verified.status).toBe(200);
  });

  it('gives a new sign-in a new challenge with its own ten minutes', async () => {
    const email = await seedAccount('julian');
    const { secret } = await enrol(email);
    const expiredToken = await challengeFor(email);
    const expired = await harness.prisma.otpCode.findFirstOrThrow({ where: { user: { email } } });
    await harness.prisma.otpCode.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(Date.now() - 1) },
    });
    expect(
      (
        await request(harness.server)
          .post(OTP_VERIFY)
          .send({ otpToken: expiredToken, code: currentCode(secret) })
      ).status,
    ).toBe(401);

    const issuedAt = Date.now();
    const freshToken = await challengeFor(email);
    const fresh = await harness.prisma.otpCode.findFirstOrThrow({
      where: { user: { email }, id: { not: expired.id } },
    });

    expect(fresh.id).not.toBe(expired.id);
    expect(Math.abs(fresh.expiresAt.getTime() - (issuedAt + TEN_MINUTES_MS))).toBeLessThan(5_000);
    expect(
      (
        await request(harness.server)
          .post(OTP_VERIFY)
          .send({ otpToken: freshToken, code: currentCode(secret) })
      ).status,
    ).toBe(200);
  });

  it('keeps the attempt bound across a resend', async () => {
    const email = await seedAccount('julian');
    await enrol(email);
    harness.policy.overrides = { loginAttemptLimit: 3 };
    const otpToken = await challengeFor(email);
    const row = await harness.prisma.otpCode.findFirstOrThrow({ where: { user: { email } } });

    const statuses: number[] = [];
    statuses.push((await request(harness.server).post(OTP_VERIFY).send({ otpToken, code: '000000' })).status);
    statuses.push((await request(harness.server).post(OTP_VERIFY).send({ otpToken, code: '000000' })).status);
    await passCooldown(row.id);
    await request(harness.server).post(OTP_RESEND).send({ otpToken });
    statuses.push((await request(harness.server).post(OTP_VERIFY).send({ otpToken, code: '000000' })).status);

    expect(statuses).toEqual([401, 401, 429]);
    harness.policy.overrides = {};
  });
});

/**
 * Owner decisions D1 and D2 of 2026-11-14
 * (`docs/mfa-recovery/addenda/2026-11-14_OWNER_DECISION_ADDENDUM_D1_D2.md`).
 */
describe('the shared password guess budget (D1) and setup (D2)', () => {
  const CHANGE_PASSWORD = '/api/v1/me/password';

  async function credentialsOf(email: string) {
    return harness.prisma.userCredential.findFirstOrThrow({ where: { user: { email } } });
  }

  it('setup without a password is 422 and stores no secret', async () => {
    const email = await seedAccount('d2-missing');
    const token = await accessTokenFor(email);

    const response = await request(harness.server)
      .post(SETUP)
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(422);
    expect((await credentialsOf(email)).totpSecretEnc).toBeNull();
  });

  it('setup with a wrong password is 401, counted, and issues nothing', async () => {
    const email = await seedAccount('d2-wrong');
    const token = await accessTokenFor(email);

    const response = await request(harness.server)
      .post(SETUP)
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'Wrong123!' });

    expect(response.status).toBe(401);
    expect(errorBody(response).code).toBe('invalid_credentials');
    expect(JSON.stringify(response.body)).not.toMatch(/secret|otpauth|recoveryCodes/);
    const credentials = await credentialsOf(email);
    expect(credentials.totpSecretEnc).toBeNull();
    expect(credentials.recoveryCodesEnc).toBeNull();
    expect(credentials.failedAttempts).toBe(1);
  });

  it('setup with the right password clears the counter and enrols as before', async () => {
    const email = await seedAccount('d2-right');
    const token = await accessTokenFor(email);
    await request(harness.server)
      .post(SETUP)
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'Wrong123!' });

    const response = await request(harness.server)
      .post(SETUP)
      .set('Authorization', `Bearer ${token}`)
      .send({ password: PASSWORD });

    expect(response.status).toBe(200);
    expect(dataOf<Enrolment>(response).recoveryCodes).toHaveLength(10);
    expect((await credentialsOf(email)).failedAttempts).toBe(0);
  });

  it('a patient enrols through the same rule', async () => {
    const email = testEmail('d2-patient');
    await request(harness.server)
      .post(REGISTER)
      .send(registrationBody({ email, role: 'patient' }));
    await markVerified(harness.prisma, email);
    const token = await accessTokenFor(email);

    const wrong = await request(harness.server)
      .post(SETUP)
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'Wrong123!' });
    const right = await request(harness.server)
      .post(SETUP)
      .set('Authorization', `Bearer ${token}`)
      .send({ password: PASSWORD });

    expect(wrong.status).toBe(401);
    expect(right.status).toBe(200);
  });

  /** The refresh cookie and the `sessions` row a signed-in response belongs to. */
  function sessionOf(response: { body: unknown; headers: Record<string, unknown> }) {
    const { accessToken } = dataOf<SessionPayload>(response);
    const raw = response.headers['set-cookie'];
    const cookies = Array.isArray(raw) ? (raw as string[]) : [];
    const cookie = cookies.find((value) => value.startsWith('medora_rt='))?.split(';')[0] ?? '';
    const claims = JSON.parse(
      Buffer.from(accessToken.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as { sid: string };
    return { accessToken, cookie, sessionId: claims.sid };
  }

  /**
   * A fresh two-factor sign-in, so the token belongs to a session row that
   * exists when the lockout happens. `enrol()` deletes the rows its own
   * setup created, so its token has none left to revoke.
   */
  async function signInWithSecondFactor(email: string, secret: string) {
    const challenge = await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false });
    const { otpToken } = dataOf<{ otpToken: string }>(challenge);
    const verified = await request(harness.server)
      .post(OTP_VERIFY)
      .send({ otpToken, code: currentCode(secret) });
    expect(verified.status).toBe(200);
    return sessionOf(verified);
  }

  async function expectSessionEnded(session: { cookie: string; sessionId: string }) {
    const row = await harness.prisma.session.findUniqueOrThrow({
      where: { id: session.sessionId },
    });
    expect(row.revokedAt).not.toBeNull();
    const refreshed = await request(harness.server).post(REFRESH).set('Cookie', session.cookie);
    expect(refreshed.status).toBe(401);
  }

  it('/me/password, /me/2fa/disable and sign-in spend one budget; the limit ends the session', async () => {
    harness.policy.overrides = { loginAttemptLimit: 3 };
    const email = await seedAccount('d1-shared');
    const { secret } = await enrol(email);
    const session = await signInWithSecondFactor(email, secret);
    expect(session.cookie).not.toBe('');

    const change = await request(harness.server)
      .post(CHANGE_PASSWORD)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ currentPassword: 'Wrong123!', newPassword: 'Another123!' });
    expect(change.status).toBe(401);
    expect(errorBody(change).code).toBe('invalid_credentials');

    const failedLogin = await request(harness.server)
      .post(LOGIN)
      .send({ email, password: 'Wrong123!', rememberMe: false });
    expect(failedLogin.status).toBe(401);

    const locking = await request(harness.server)
      .post(DISABLE)
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ password: 'Wrong123!' });
    expect(locking.status).toBe(429);
    expect(errorBody(locking).code).toBe('rate_limited');
    expect(Number(locking.headers['retry-after'])).toBeGreaterThan(0);

    const credentials = await credentialsOf(email);
    expect(credentials.failedAttempts).toBe(3);
    expect(credentials.lockedUntil).not.toBeNull();
    const user = await harness.prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.twoFactorEnabled).toBe(true);

    // The session behind the request that reached the limit is over …
    await expectSessionEnded(session);

    // … and sign-in is locked too: one budget, not three.
    const login = await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false });
    expect(login.status).toBe(429);
  });

  it('/me/password at the limit ends its session and changes nothing', async () => {
    harness.policy.overrides = { loginAttemptLimit: 2 };
    const email = await seedAccount('d1-change');
    const { secret } = await enrol(email);
    const session = await signInWithSecondFactor(email, secret);
    const before = (await credentialsOf(email)).passwordHash;

    const attempt = (currentPassword: string) =>
      request(harness.server)
        .post(CHANGE_PASSWORD)
        .set('Authorization', `Bearer ${session.accessToken}`)
        .send({ currentPassword, newPassword: 'Another123!' });

    expect((await attempt('Wrong123!')).status).toBe(401);
    expect((await attempt('Wrong456!')).status).toBe(429);

    expect((await credentialsOf(email)).passwordHash).toBe(before);
    await expectSessionEnded(session);
  });

  it('first-time setup at the limit ends its session and issues no secret (D2)', async () => {
    harness.policy.overrides = { loginAttemptLimit: 2 };
    const email = await seedAccount('d2-limit');
    // Not enrolled, so a password-only sign-in yields a session and a cookie.
    // Two of them: the second is a device still signed in when the first
    // reaches the limit, and is how "while locked" is reached below.
    const signIn = async () => {
      const response = await request(harness.server)
        .post(LOGIN)
        .send({ email, password: PASSWORD, rememberMe: false });
      expect(response.status).toBe(200);
      return sessionOf(response);
    };
    const session = await signIn();
    const otherDevice = await signIn();

    const attemptAs = (accessToken: string, password: string) =>
      request(harness.server)
        .post(SETUP)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ password });
    const attempt = (password: string) => attemptAs(session.accessToken, password);

    expect((await attempt('Wrong123!')).status).toBe(401);
    const locking = await attempt('Wrong456!');
    expect(locking.status).toBe(429);
    expect(errorBody(locking).code).toBe('rate_limited');
    expect(JSON.stringify(locking.body)).not.toMatch(/secret|otpauth|recoveryCodes/);

    const credentials = await credentialsOf(email);
    expect(credentials.totpSecretEnc).toBeNull();
    expect(credentials.recoveryCodesEnc).toBeNull();
    expect(credentials.lockedUntil).not.toBeNull();
    await expectSessionEnded(session);

    // PRE-01: the ended session's access token is refused at the guard
    // from the next request on — it no longer reaches the handler.
    const ended = await attempt(PASSWORD);
    expect(ended.status).toBe(401);
    expect(errorBody(ended).code).toBe('unauthorized');

    // While locked, even the right password from a session that is still
    // live issues nothing — and that session ends too.
    const locked = await attemptAs(otherDevice.accessToken, PASSWORD);
    expect(locked.status).toBe(429);
    expect(JSON.stringify(locked.body)).not.toMatch(/secret|otpauth|recoveryCodes/);
    expect((await credentialsOf(email)).totpSecretEnc).toBeNull();
    await expectSessionEnded(otherDevice);
  });
});
