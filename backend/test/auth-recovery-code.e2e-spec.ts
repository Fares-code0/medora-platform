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
import { body as mailBody, header } from './support/smtp-sink';

/**
 * Recovery codes: redemption, the remaining count, and re-enrollment
 * (owner decisions R1–R5 and Q7 / R4, 2026-11-06; RA-025.2, RA-035.2).
 *
 * `otpauth` plays the authenticator, as in `auth-two-factor.e2e-spec.ts`.
 */
let harness: AuthHarness;
const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const SETUP = '/api/v1/me/2fa/setup';
const ENABLE = '/api/v1/me/2fa/enable';
const STATUS = '/api/v1/me/2fa';
const REENROLL = '/api/v1/me/2fa/reenroll';
const REENROLL_CONFIRM = '/api/v1/me/2fa/reenroll/confirm';
const OTP_VERIFY = '/api/v1/auth/otp/verify';
const OTP_RECOVERY = '/api/v1/auth/otp/recovery';
const PASSWORD = 'Medora123!';

interface SessionPayload {
  user: { id: string; email: string };
  accessToken: string;
  expiresIn: number;
}
interface Enrolment {
  otpauthUrl: string;
  secret: string;
  recoveryCodes: string[];
}
interface Status {
  enabled: boolean;
  recoveryCodesRemaining: number;
}

async function seedAccount(local: string): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  return email;
}

function currentCode(secret: string): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

/** Enrols and enables 2FA; returns the secret, the codes and a live token. */
async function enrol(email: string): Promise<{
  secret: string;
  codes: string[];
  accessToken: string;
}> {
  const accessToken = dataOf<SessionPayload>(
    await request(harness.server).post(LOGIN).send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;
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

  return { secret: enrolment.secret, codes: enrolment.recoveryCodes, accessToken };
}

async function challengeFor(email: string): Promise<string> {
  const response = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });
  return dataOf<{ otpToken: string }>(response).otpToken;
}

function redeem(otpToken: string, recoveryCode: string) {
  return request(harness.server).post(OTP_RECOVERY).send({ otpToken, recoveryCode });
}

async function signInWithTotp(email: string, secret: string) {
  return request(harness.server)
    .post(OTP_VERIFY)
    .send({ otpToken: await challengeFor(email), code: currentCode(secret) });
}

function bearer(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function storedCodesBlob(email: string): Promise<Buffer> {
  const credential = await harness.prisma.userCredential.findFirstOrThrow({
    where: { user: { email } },
  });
  return Buffer.from(credential.recoveryCodesEnc!);
}

beforeAll(async () => {
  harness = await createAuthHarness('recoverycode');
});

afterAll(async () => {
  await harness.reset();
  await harness.close();
});

beforeEach(async () => {
  harness.policy.overrides = {};
  harness.sink.clear();
  await harness.reset();
});

describe('POST /auth/otp/recovery (R1)', () => {
  it('completes the sign-in with a recovery code, with the ordinary session payload', async () => {
    const email = await seedAccount('rory');
    const { codes } = await enrol(email);

    const response = await redeem(await challengeFor(email), codes[0]!);

    expect(response.status).toBe(200);
    const payload = dataOf<SessionPayload & Record<string, unknown>>(response);
    expect(payload.user.email).toBe(email);
    expect(payload.expiresIn).toBe(900);
    // R2: the count is shown in the 2FA settings only, never here.
    expect(payload).not.toHaveProperty('recoveryCodesRemaining');
    expect(JSON.stringify(response.body)).not.toMatch(/remaining/i);

    const raw: unknown = response.headers['set-cookie'];
    const cookies = Array.isArray(raw) ? raw : [raw];
    expect(cookies.some((c) => typeof c === 'string' && c.startsWith('medora_rt='))).toBe(true);
  });

  it('accepts each code once', async () => {
    const email = await seedAccount('rory');
    const { codes } = await enrol(email);

    expect((await redeem(await challengeFor(email), codes[0]!)).status).toBe(200);

    const again = await redeem(await challengeFor(email), codes[0]!);
    expect(again.status).toBe(401);
    expect(errorBody(again).code).toBe('otp_invalid');
  });

  it('turns two simultaneous redemptions of one code into exactly one session', async () => {
    const email = await seedAccount('rory');
    const { codes } = await enrol(email);
    await harness.prisma.session.deleteMany({ where: { user: { email } } });
    const [first, second] = [await challengeFor(email), await challengeFor(email)];

    const responses = await Promise.all([redeem(first, codes[0]!), redeem(second, codes[0]!)]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 401]);
    expect(await harness.prisma.session.count({ where: { user: { email } } })).toBe(1);
  });

  it('accepts a code typed in upper case, with or without the dash', async () => {
    const email = await seedAccount('rory');
    const { codes } = await enrol(email);

    const typed = codes[1]!.toUpperCase().replace('-', '');
    expect((await redeem(await challengeFor(email), typed)).status).toBe(200);
  });

  it('counts a wrong code against the challenge, and gives up at the limit', async () => {
    const email = await seedAccount('rory');
    const { codes } = await enrol(email);
    harness.policy.overrides = { loginAttemptLimit: 3 };
    const otpToken = await challengeFor(email);

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      statuses.push((await redeem(otpToken, 'aaaaa-bbbbb')).status);
    }
    // The challenge is spent: even a valid code no longer completes it.
    statuses.push((await redeem(otpToken, codes[0]!)).status);

    expect(statuses).toEqual([401, 401, 429, 401]);
    // …and that valid code was not consumed by the refusal.
    expect((await redeem(await challengeFor(email), codes[0]!)).status).toBe(200);
  });

  it("refuses another account's code", async () => {
    const owner = await seedAccount('rory');
    const other = await seedAccount('tamsin');
    await enrol(owner);
    const { codes: otherCodes } = await enrol(other);

    expect((await redeem(await challengeFor(owner), otherCodes[0]!)).status).toBe(401);
  });

  it('refuses a challenge already completed with the authenticator', async () => {
    const email = await seedAccount('rory');
    const { secret, codes } = await enrol(email);
    const otpToken = await challengeFor(email);

    expect(
      (await request(harness.server).post(OTP_VERIFY).send({ otpToken, code: currentCode(secret) }))
        .status,
    ).toBe(200);
    expect((await redeem(otpToken, codes[0]!)).status).toBe(401);
  });

  it('refuses an access token presented as the challenge', async () => {
    const email = await seedAccount('rory');
    const { accessToken, codes } = await enrol(email);

    expect((await redeem(accessToken, codes[0]!)).status).toBe(401);
  });

  it('does not turn two-factor authentication off', async () => {
    const email = await seedAccount('rory');
    const { codes } = await enrol(email);

    await redeem(await challengeFor(email), codes[0]!);

    const user = await harness.prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.twoFactorEnabled).toBe(true);
    const next = await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false });
    expect(dataOf<{ requiresOtp?: boolean }>(next).requiresOtp).toBe(true);
  });

  it('never stores a code in the clear, and audits the use without the code (R5)', async () => {
    const email = await seedAccount('rory');
    const { codes } = await enrol(email);

    await redeem(await challengeFor(email), codes[2]!);

    const blob = await storedCodesBlob(email);
    for (const code of codes) {
      expect(blob.toString('utf8')).not.toContain(code);
      expect(blob.toString('base64')).not.toContain(code);
    }

    const user = await harness.prisma.user.findUniqueOrThrow({ where: { email } });
    const rows = await harness.prisma.auditEvent.findMany({
      where: { actorId: user.id, eventType: 'auth.recovery_code_used' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload).toMatchObject({ remaining: 9 });
    expect(JSON.stringify(rows[0])).not.toContain(codes[2]!);
  });

  it('emails the account holder on every use, without the remaining count (R3)', async () => {
    const email = await seedAccount('rory');
    const { codes } = await enrol(email);
    harness.sink.clear();

    await redeem(await challengeFor(email), codes[0]!);

    const mail = harness.sink.lastTo(email);
    expect(mail).toBeDefined();
    expect(header(mail!, 'Subject')).toBe('A recovery code was used on your Medora account');
    const text = mailBody(mail!);
    expect(text).not.toContain(codes[0]!);
    expect(text).not.toMatch(/\d+ (recovery )?codes? (left|remain)/i);
  });
});

describe('GET /me/2fa (R2)', () => {
  it('reports two-factor authentication off, with no codes', async () => {
    const email = await seedAccount('rory');
    const accessToken = dataOf<SessionPayload>(
      await request(harness.server)
        .post(LOGIN)
        .send({ email, password: PASSWORD, rememberMe: false }),
    ).accessToken;

    const response = await request(harness.server).get(STATUS).set(bearer(accessToken));

    expect(response.status).toBe(200);
    expect(dataOf<Status>(response)).toEqual({ enabled: false, recoveryCodesRemaining: 0 });
  });

  it('counts down as codes are used', async () => {
    const email = await seedAccount('rory');
    const { codes, accessToken } = await enrol(email);

    expect(
      dataOf<Status>(await request(harness.server).get(STATUS).set(bearer(accessToken))),
    ).toEqual({ enabled: true, recoveryCodesRemaining: 10 });

    const session = dataOf<SessionPayload>(await redeem(await challengeFor(email), codes[0]!));
    const after = await request(harness.server).get(STATUS).set(bearer(session.accessToken));

    expect(dataOf<Status>(after)).toEqual({ enabled: true, recoveryCodesRemaining: 9 });
  });

  it('requires authentication', async () => {
    expect((await request(harness.server).get(STATUS)).status).toBe(401);
  });
});

describe('re-enrollment (Q7 / R4)', () => {
  it('refuses setup on an account that already has a factor, and changes nothing', async () => {
    const email = await seedAccount('rory');
    const { accessToken } = await enrol(email);
    const before = await harness.prisma.userCredential.findFirstOrThrow({
      where: { user: { email } },
    });

    const response = await request(harness.server)
      .post(SETUP)
      .set(bearer(accessToken))
      .send({ password: PASSWORD });

    expect(response.status).toBe(409);
    const after = await harness.prisma.userCredential.findFirstOrThrow({
      where: { user: { email } },
    });
    expect(Buffer.from(after.totpSecretEnc!).equals(Buffer.from(before.totpSecretEnc!))).toBe(true);
    expect(Buffer.from(after.recoveryCodesEnc!).equals(Buffer.from(before.recoveryCodesEnc!))).toBe(
      true,
    );
  });

  it('refuses an account without a factor', async () => {
    const email = await seedAccount('rory');
    const accessToken = dataOf<SessionPayload>(
      await request(harness.server)
        .post(LOGIN)
        .send({ email, password: PASSWORD, rememberMe: false }),
    ).accessToken;

    const response = await request(harness.server)
      .post(REENROLL)
      .set(bearer(accessToken))
      .send({ password: PASSWORD, code: '123456' });

    expect(response.status).toBe(409);
  });

  it('requires the current password', async () => {
    const email = await seedAccount('rory');
    const { secret, accessToken } = await enrol(email);

    const response = await request(harness.server)
      .post(REENROLL)
      .set(bearer(accessToken))
      .send({ password: 'not-the-password', code: currentCode(secret) });

    expect(response.status).toBe(401);
    expect(errorBody(response).code).toBe('invalid_credentials');
  });

  it('requires a code from the current factor', async () => {
    const email = await seedAccount('rory');
    const { accessToken } = await enrol(email);

    const response = await request(harness.server)
      .post(REENROLL)
      .set(bearer(accessToken))
      .send({ password: PASSWORD, code: '000000' });

    expect(response.status).toBe(401);
    expect(errorBody(response).code).toBe('otp_invalid');
  });

  it('keeps the old factor and codes until the new factor is proved, then replaces both', async () => {
    const email = await seedAccount('rory');
    const { secret: oldSecret, codes: oldCodes, accessToken } = await enrol(email);

    const started = await request(harness.server)
      .post(REENROLL)
      .set(bearer(accessToken))
      .send({ password: PASSWORD, code: currentCode(oldSecret) });
    expect(started.status).toBe(200);
    const { secret: newSecret, enrolmentToken } = dataOf<{
      secret: string;
      enrolmentToken: string;
    }>(started);
    expect(dataOf<Record<string, unknown>>(started)).not.toHaveProperty('recoveryCodes');

    // Nothing has changed yet: the old factor and an old code still work.
    expect((await signInWithTotp(email, oldSecret)).status).toBe(200);
    expect((await redeem(await challengeFor(email), oldCodes[0]!)).status).toBe(200);

    // A code that the new secret did not produce proves nothing.
    const wrong = await request(harness.server)
      .post(REENROLL_CONFIRM)
      .set(bearer(accessToken))
      .send({ enrolmentToken, code: '000000' });
    expect(wrong.status).toBe(401);

    const confirmed = await request(harness.server)
      .post(REENROLL_CONFIRM)
      .set(bearer(accessToken))
      .send({ enrolmentToken, code: currentCode(newSecret) });
    expect(confirmed.status).toBe(200);
    const { recoveryCodes: newCodes } = dataOf<{ recoveryCodes: string[] }>(confirmed);
    expect(newCodes).toHaveLength(10);

    // Now the old factor and codes are gone, and the new ones work.
    expect((await signInWithTotp(email, oldSecret)).status).toBe(401);
    expect((await signInWithTotp(email, newSecret)).status).toBe(200);
    expect((await redeem(await challengeFor(email), oldCodes[1]!)).status).toBe(401);
    expect((await redeem(await challengeFor(email), newCodes[0]!)).status).toBe(200);

    const user = await harness.prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.twoFactorEnabled).toBe(true);
    expect(
      await harness.prisma.auditEvent.count({
        where: { actorId: user.id, eventType: 'auth.two_factor_reenrolled' },
      }),
    ).toBe(1);
  });

  it('applies an enrollment once', async () => {
    const email = await seedAccount('rory');
    const { secret, accessToken } = await enrol(email);
    const { secret: newSecret, enrolmentToken } = dataOf<{
      secret: string;
      enrolmentToken: string;
    }>(
      await request(harness.server)
        .post(REENROLL)
        .set(bearer(accessToken))
        .send({ password: PASSWORD, code: currentCode(secret) }),
    );
    const confirm = () =>
      request(harness.server)
        .post(REENROLL_CONFIRM)
        .set(bearer(accessToken))
        .send({ enrolmentToken, code: currentCode(newSecret) });

    expect((await confirm()).status).toBe(200);
    expect((await confirm()).status).toBe(409);
  });

  it('refuses an enrollment token presented by another session', async () => {
    const email = await seedAccount('rory');
    const { secret, accessToken } = await enrol(email);
    const { secret: newSecret, enrolmentToken } = dataOf<{
      secret: string;
      enrolmentToken: string;
    }>(
      await request(harness.server)
        .post(REENROLL)
        .set(bearer(accessToken))
        .send({ password: PASSWORD, code: currentCode(secret) }),
    );
    const otherSession = dataOf<SessionPayload>(await signInWithTotp(email, secret)).accessToken;

    const response = await request(harness.server)
      .post(REENROLL_CONFIRM)
      .set(bearer(otherSession))
      .send({ enrolmentToken, code: currentCode(newSecret) });

    expect(response.status).toBe(401);
    expect(errorBody(response).code).toBe('token_invalid');
  });

  it('requires authentication', async () => {
    expect((await request(harness.server).post(REENROLL).send({})).status).toBe(401);
    expect((await request(harness.server).post(REENROLL_CONFIRM).send({})).status).toBe(401);
  });
});
