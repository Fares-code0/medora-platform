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
 * AUTH-07 (audit B-09): the second-factor guess budget is the account's,
 * not the challenge's.
 *
 * Before, each challenge allowed `loginAttemptLimit` guesses and a correct
 * password cleared the account's counter, so anybody holding the password
 * could start challenge after challenge and guess the six digits without
 * end. Now a wrong authenticator or recovery code spends from the same
 * `failed_attempts / locked_until` as a wrong password; a correct password
 * does not reset it for a 2FA account; only a proved second factor does.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const SETUP = '/api/v1/me/2fa/setup';
const ENABLE = '/api/v1/me/2fa/enable';
const OTP_VERIFY = '/api/v1/auth/otp/verify';
const OTP_RECOVERY = '/api/v1/auth/otp/recovery';
const PASSWORD = 'Medora123!';
const LIMIT = 3;

interface Enrolment {
  secret: string;
  recoveryCodes: string[];
}

function totp(secret: string): TOTP {
  return new TOTP({ algorithm: 'SHA1', digits: 6, period: 30, secret: Secret.fromBase32(secret) });
}

function currentCode(secret: string): string {
  return totp(secret).generate();
}

/** Six digits that are none of the codes the ±1-step window accepts now. */
function wrongCode(secret: string): string {
  const generator = totp(secret);
  const now = Date.now();
  const accepted = new Set(
    [-30_000, 0, 30_000].map((offset) => generator.generate({ timestamp: now + offset })),
  );
  let candidate = Number(currentCode(secret));
  do {
    candidate = (candidate + 1) % 1_000_000;
  } while (accepted.has(String(candidate).padStart(6, '0')));
  return String(candidate).padStart(6, '0');
}

async function seedTwoFactorAccount(local: string): Promise<{ email: string } & Enrolment> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  const login = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });
  const { accessToken } = dataOf<{ accessToken: string }>(login);
  const enrolment = dataOf<Enrolment>(
    await request(harness.server)
      .post(SETUP)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ password: PASSWORD }),
  );
  const enabled = await request(harness.server)
    .post(ENABLE)
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ code: currentCode(enrolment.secret) });
  expect(enabled.status).toBeLessThan(300);
  await harness.prisma.session.deleteMany({ where: { user: { email } } });

  return { email, ...enrolment };
}

/** A fresh challenge, re-entering the correct password each time. */
async function challengeFor(email: string): Promise<string> {
  const response = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });
  expect(response.status).toBe(200);
  return dataOf<{ otpToken: string }>(response).otpToken;
}

function verify(otpToken: string, code: string) {
  return request(harness.server).post(OTP_VERIFY).send({ otpToken, code });
}

function redeem(otpToken: string, recoveryCode: string) {
  return request(harness.server).post(OTP_RECOVERY).send({ otpToken, recoveryCode });
}

function credentialsOf(email: string) {
  return harness.prisma.userCredential.findFirstOrThrow({ where: { user: { email } } });
}

beforeAll(async () => {
  harness = await createAuthHarness('otpbudget');
});

afterAll(async () => {
  await harness.reset();
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
  harness.policy.overrides = { loginAttemptLimit: LIMIT };
});

describe('the per-account second-factor budget (AUTH-07)', () => {
  it('survives fresh challenges and the correct password, then locks the account', async () => {
    const { email, secret } = await seedTwoFactorAccount('budget-span');

    // One wrong guess per fresh challenge, the password re-entered each time.
    const statuses: number[] = [];
    for (let attempt = 0; attempt < LIMIT; attempt += 1) {
      statuses.push((await verify(await challengeFor(email), wrongCode(secret))).status);
    }
    expect(statuses).toEqual([401, 401, 429]);

    const credentials = await credentialsOf(email);
    expect(credentials.failedAttempts).toBe(LIMIT);
    expect(credentials.lockedUntil).not.toBeNull();

    // The account is in the ordinary lockout: the correct password is refused.
    const login = await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false });
    expect(login.status).toBe(429);
    expect(errorBody(login).code).toBe('rate_limited');
  });

  it('refuses a correct code on a still-open challenge once the budget is spent', async () => {
    const { email, secret } = await seedTwoFactorAccount('budget-open');
    // Opened before the budget runs out, so it is live when it is used.
    const held = await challengeFor(email);

    for (let attempt = 0; attempt < LIMIT; attempt += 1) {
      await verify(await challengeFor(email), wrongCode(secret));
    }

    const refused = await verify(held, currentCode(secret));
    expect(refused.status).toBe(429);
    expect(errorBody(refused).code).toBe('rate_limited');
    expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
    expect(await harness.prisma.session.count({ where: { user: { email } } })).toBe(0);
    // The refusal was not counted against the challenge either.
    const row = await harness.prisma.otpCode.findFirstOrThrow({
      where: { user: { email } },
      orderBy: { createdAt: 'asc' },
    });
    expect(row.attempts).toBe(0);
    expect(row.consumedAt).toBeNull();
  });

  it('lets one try through once the lock has ended, and a success resets the budget', async () => {
    const { email, secret } = await seedTwoFactorAccount('budget-ends');
    for (let attempt = 0; attempt < LIMIT; attempt += 1) {
      await verify(await challengeFor(email), wrongCode(secret));
    }
    await harness.prisma.userCredential.updateMany({
      where: { user: { email } },
      data: { lockedUntil: new Date(Date.now() - 1_000) },
    });

    const verified = await verify(await challengeFor(email), currentCode(secret));
    expect(verified.status).toBe(200);

    const credentials = await credentialsOf(email);
    expect(credentials.failedAttempts).toBe(0);
    expect(credentials.lockedUntil).toBeNull();
  });

  it('re-locks on the first wrong guess after the lock ends', async () => {
    const { email, secret } = await seedTwoFactorAccount('budget-relock');
    for (let attempt = 0; attempt < LIMIT; attempt += 1) {
      await verify(await challengeFor(email), wrongCode(secret));
    }
    await harness.prisma.userCredential.updateMany({
      where: { user: { email } },
      data: { lockedUntil: new Date(Date.now() - 1_000) },
    });

    const again = await verify(await challengeFor(email), wrongCode(secret));
    expect(again.status).toBe(429);
    expect((await credentialsOf(email)).lockedUntil?.getTime()).toBeGreaterThan(Date.now());
  });

  it('a success before the limit resets the count', async () => {
    const { email, secret } = await seedTwoFactorAccount('budget-reset');
    await verify(await challengeFor(email), wrongCode(secret));
    await verify(await challengeFor(email), wrongCode(secret));
    expect((await credentialsOf(email)).failedAttempts).toBe(2);

    expect((await verify(await challengeFor(email), currentCode(secret))).status).toBe(200);
    expect((await credentialsOf(email)).failedAttempts).toBe(0);

    // A full budget again: LIMIT - 1 wrong guesses leave the account unlocked.
    for (let attempt = 0; attempt < LIMIT - 1; attempt += 1) {
      expect((await verify(await challengeFor(email), wrongCode(secret))).status).toBe(401);
    }
    expect((await credentialsOf(email)).lockedUntil).toBeNull();
  });

  it('a correct password does not reset second-factor failures on a 2FA account', async () => {
    const { email, secret } = await seedTwoFactorAccount('budget-password');
    await verify(await challengeFor(email), wrongCode(secret));
    // challengeFor re-enters the correct password.
    await challengeFor(email);
    expect((await credentialsOf(email)).failedAttempts).toBe(1);
  });

  it('wrong passwords and wrong codes spend one budget', async () => {
    const { email, secret } = await seedTwoFactorAccount('budget-mixed');
    const wrongPassword = await request(harness.server)
      .post(LOGIN)
      .send({ email, password: 'Wrong123!', rememberMe: false });
    expect(wrongPassword.status).toBe(401);

    expect((await verify(await challengeFor(email), wrongCode(secret))).status).toBe(401);
    expect((await verify(await challengeFor(email), wrongCode(secret))).status).toBe(429);
  });

  it('recovery codes spend from the same budget, across challenges', async () => {
    const { email, secret, recoveryCodes } = await seedTwoFactorAccount('budget-recovery');

    expect((await redeem(await challengeFor(email), 'aaaaa-bbbbb')).status).toBe(401);
    expect((await verify(await challengeFor(email), wrongCode(secret))).status).toBe(401);
    const held = await challengeFor(email);
    expect((await redeem(await challengeFor(email), 'aaaaa-bbbbb')).status).toBe(429);

    // A valid recovery code is refused while locked, and is not spent.
    const refused = await redeem(held, recoveryCodes[0]!);
    expect(refused.status).toBe(429);
    await harness.prisma.userCredential.updateMany({
      where: { user: { email } },
      data: { lockedUntil: new Date(Date.now() - 1_000) },
    });
    expect((await redeem(await challengeFor(email), recoveryCodes[0]!)).status).toBe(200);
    expect((await credentialsOf(email)).failedAttempts).toBe(0);
  });

  it('parallel wrong guesses across challenges never exceed the budget', async () => {
    const { email, secret } = await seedTwoFactorAccount('budget-parallel');
    // More challenges than the budget, all opened before any guess, and at
    // most two guesses each so that no single challenge runs out of its own
    // attempts (that would answer 401 for a reason other than the budget).
    const tokens: string[] = [];
    for (let index = 0; index < 6; index += 1) tokens.push(await challengeFor(email));
    const wrong = wrongCode(secret);

    const guesses = Array.from({ length: 12 }, (_, index) =>
      verify(tokens[index % tokens.length]!, wrong),
    );
    const statuses = (await Promise.all(guesses)).map((response) => response.status);

    // Exactly LIMIT guesses reached the code check; every other was refused.
    const rows = await harness.prisma.otpCode.findMany({ where: { user: { email } } });
    expect(rows.reduce((sum, row) => sum + row.attempts, 0)).toBe(LIMIT);
    expect((await credentialsOf(email)).failedAttempts).toBe(LIMIT);
    // A guess that reached the check answers 401, or 429 if the lock was set
    // by a parallel guess before it answered; nothing else, and never more
    // 401s than the budget leaves before the lock.
    expect(statuses.every((status) => status === 401 || status === 429)).toBe(true);
    expect(statuses.filter((status) => status === 401).length).toBeLessThanOrEqual(LIMIT - 1);

    // And the correct code is refused afterwards.
    expect((await verify(tokens[tokens.length - 1]!, currentCode(secret))).status).toBe(429);
  });
});
