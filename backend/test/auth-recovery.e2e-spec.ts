import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PasswordService } from '../src/modules/auth/services/password.service';
import { SessionService } from '../src/modules/auth/services/session.service';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  markVerified,
  registrationBody,
  testEmail,
  tokenFromLink,
} from './support/auth-app';
import { body as mailBody, header } from './support/smtp-sink';

/**
 * The password flows and email verification
 * (RM M6.5–M6.6, API §1.7–1.10, §2.3).
 *
 * The roadmap's verifications: "forgot for unknown email returns
 * identical 202", "reset with used token → 422 `token_invalid`", and
 * "verify → 204 and login unblocked". The anti-enumeration cases get the
 * most attention here, because they are the ones a reasonable
 * implementation gets wrong by being helpful.
 */
let harness: AuthHarness;
const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const FORGOT = '/api/v1/auth/forgot-password';
const RESET = '/api/v1/auth/reset-password';
const VERIFY_EMAIL = '/api/v1/auth/verify-email';
const RESEND_VERIFICATION = '/api/v1/auth/verification/resend';
const CHANGE_PASSWORD = '/api/v1/me/password';
const PASSWORD = 'Medora123!';
const NEW_PASSWORD = 'Medora456?';

interface SessionPayload {
  user: { id: string; email: string };
  accessToken: string;
}

/** Registers; leaves the address unverified. */
async function registerAccount(local: string): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  return email;
}

async function verifiedAccount(local: string): Promise<string> {
  const email = await registerAccount(local);
  await markVerified(harness.prisma, email);
  return email;
}

async function signIn(email: string, password = PASSWORD): Promise<string> {
  const response = await request(harness.server)
    .post(LOGIN)
    .send({ email, password, rememberMe: false });
  return dataOf<SessionPayload>(response).accessToken;
}

/** The reset link's token, taken from the message that was delivered. */
function resetTokenFor(email: string): string {
  const mail = harness.sink.lastTo(email);
  if (mail === undefined) throw new Error(`No mail delivered to ${email}`);
  return tokenFromLink(mailBody(mail));
}

beforeAll(async () => {
  harness = await createAuthHarness('recovery');
});

afterAll(async () => {
  await harness.reset();
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
});

describe('forgot password', () => {
  it('answers 202 and sends a reset link', async () => {
    const email = await verifiedAccount('amelia');
    harness.sink.clear();

    const response = await request(harness.server).post(FORGOT).send({ email });

    expect(response.status).toBe(202);
    expect(dataOf<{ accepted: boolean }>(response)).toEqual({ accepted: true });

    const mail = harness.sink.lastTo(email);
    expect(mail).toBeDefined();
    expect(header(mail!, 'Subject')).toBe('Reset your Medora password');
    expect(mailBody(mail!)).toContain('http://localhost:5173/reset-password?token=');
  });

  it('answers identically for an address with no account', async () => {
    const known = await verifiedAccount('amelia');
    harness.sink.clear();

    const forKnown = await request(harness.server).post(FORGOT).send({ email: known });
    const forUnknown = await request(harness.server)
      .post(FORGOT)
      .send({ email: testEmail('nobody') });

    // Byte-identical: in a clinic, "does this person have an account
    // here" is a question about employment.
    expect(forUnknown.status).toBe(forKnown.status);
    expect(forUnknown.body).toEqual(forKnown.body);
    expect(harness.sink.lastTo(testEmail('nobody'))).toBeUndefined();
  });

  it('answers identically for a deactivated account', async () => {
    const email = await verifiedAccount('amelia');
    await harness.prisma.user.update({ where: { email }, data: { deletedAt: new Date() } });
    harness.sink.clear();

    const response = await request(harness.server).post(FORGOT).send({ email });

    expect(response.status).toBe(202);
    expect(harness.sink.lastTo(email)).toBeUndefined();
  });

  it('enforces the cooldown by not sending, never by answering differently', async () => {
    const email = await verifiedAccount('amelia');
    harness.sink.clear();

    const first = await request(harness.server).post(FORGOT).send({ email });
    const second = await request(harness.server).post(FORGOT).send({ email });

    // A 429 here would leak exactly what the 202 exists to hide.
    expect(second.status).toBe(first.status);
    expect(second.body).toEqual(first.body);
    expect(harness.sink.messages.filter((mail) => mail.recipients.includes(email))).toHaveLength(1);
  });

  it('stores only the hash of the reset token', async () => {
    const email = await verifiedAccount('amelia');
    harness.sink.clear();
    await request(harness.server).post(FORGOT).send({ email });

    const raw = resetTokenFor(email);
    const stored = await harness.prisma.verificationToken.findFirstOrThrow({
      where: { user: { email }, kind: 'PASSWORD_RESET' },
    });

    expect(stored.tokenHash).not.toBe(raw);
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("gives the reset link an hour, not the verification link's day", async () => {
    const email = await verifiedAccount('amelia');
    harness.sink.clear();
    const before = Date.now();
    await request(harness.server).post(FORGOT).send({ email });

    const stored = await harness.prisma.verificationToken.findFirstOrThrow({
      where: { user: { email }, kind: 'PASSWORD_RESET' },
    });

    // A verification link proves an address; a reset link *is* an
    // account takeover in one click, so it sits in an inbox for less time.
    const ttlMs = stored.expiresAt.getTime() - before;
    expect(ttlMs).toBeLessThanOrEqual(60 * 60 * 1_000 + 5_000);
    expect(ttlMs).toBeGreaterThan(55 * 60 * 1_000);
  });
});

describe('reset password', () => {
  async function requestReset(local: string): Promise<{ email: string; token: string }> {
    const email = await verifiedAccount(local);
    harness.sink.clear();
    await request(harness.server).post(FORGOT).send({ email });
    return { email, token: resetTokenFor(email) };
  }

  it('sets the new password and answers 204', async () => {
    const { email, token } = await requestReset('amelia');

    const response = await request(harness.server)
      .post(RESET)
      .send({ token, password: NEW_PASSWORD });

    expect(response.status).toBe(204);
    expect(
      (await request(harness.server).post(LOGIN).send({ email, password: NEW_PASSWORD, rememberMe: false })).status,
    ).toBe(200);
    expect(
      (await request(harness.server).post(LOGIN).send({ email, password: PASSWORD, rememberMe: false })).status,
    ).toBe(401);
  });

  it('refuses a token that has already been used', async () => {
    const { token } = await requestReset('amelia');
    await request(harness.server).post(RESET).send({ token, password: NEW_PASSWORD });

    const response = await request(harness.server)
      .post(RESET)
      .send({ token, password: 'Medora789!' });

    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('token_invalid');
  });

  it('refuses an expired token', async () => {
    const { email, token } = await requestReset('amelia');
    // `created_at` moves too: DB §9's `verification_tokens_expires_after_creation`
    // CHECK refuses a token that expires before it was issued.
    const past = Date.now() - 60_000;
    await harness.prisma.verificationToken.updateMany({
      where: { user: { email } },
      data: { createdAt: new Date(past), expiresAt: new Date(past + 1_000) },
    });

    const response = await request(harness.server)
      .post(RESET)
      .send({ token, password: NEW_PASSWORD });

    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('token_invalid');
  });

  it('refuses a token that was never issued', async () => {
    const response = await request(harness.server)
      .post(RESET)
      .send({ token: 'invalid', password: NEW_PASSWORD });

    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('token_invalid');
  });

  it('refuses a verification token used as a reset token', async () => {
    // Both live in `verification_tokens`; only `kind` separates them, and
    // without that check a link that merely proves an address would be a
    // password reset.
    const email = await registerAccount('priya');
    const verificationToken = resetTokenFor(email);

    const response = await request(harness.server)
      .post(RESET)
      .send({ token: verificationToken, password: NEW_PASSWORD });

    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('token_invalid');
  });

  it('applies the password policy with weak_password', async () => {
    const { token } = await requestReset('amelia');

    const response = await request(harness.server).post(RESET).send({ token, password: 'weak' });

    expect(response.status).toBe(422);
    expect(Object.keys(errorBody(response).fieldErrors ?? {})).toContain('password');
  });

  it('does not spend the token on a policy failure', async () => {
    const { token } = await requestReset('amelia');
    await request(harness.server).post(RESET).send({ token, password: 'weak' });

    // Validation runs in the pipe, before the service sees the token —
    // otherwise a typo would burn the link and force another email.
    expect((await request(harness.server).post(RESET).send({ token, password: NEW_PASSWORD })).status).toBe(204);
  });

  it("revokes every session, including the attacker's", async () => {
    const { email, token } = await requestReset('amelia');
    await signIn(email);
    await signIn(email);

    await request(harness.server).post(RESET).send({ token, password: NEW_PASSWORD });

    // A reset that left a session running would be a reset in name only.
    const live = await harness.prisma.session.count({
      where: { user: { email }, revokedAt: null },
    });
    expect(live).toBe(0);
  });

  it('clears a lockout', async () => {
    const { email, token } = await requestReset('amelia');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(harness.server).post(LOGIN).send({ email, password: 'Wrong123!', rememberMe: false });
    }

    await request(harness.server).post(RESET).send({ token, password: NEW_PASSWORD });

    // The person who proved they can reset it is not the person being
    // locked out.
    const response = await request(harness.server)
      .post(LOGIN)
      .send({ email, password: NEW_PASSWORD, rememberMe: false });
    expect(response.status).toBe(200);
  });

  it('writes a password entry to the activity feed', async () => {
    const { email, token } = await requestReset('amelia');
    await request(harness.server).post(RESET).send({ token, password: NEW_PASSWORD });

    const activity = await harness.prisma.userActivityLog.findMany({ where: { user: { email } } });
    expect(activity).toHaveLength(1);
    expect(activity[0]?.kind).toBe('PASSWORD');
  });
});

/**
 * The P2025 regression and the reset's transaction boundary.
 *
 * A reset for an account with no `user_credentials` row — the seeded demo
 * accounts, before provisioning existed — used to `update` a row that was
 * not there: P2025, a 500, and a link that had already been spent. The
 * token is now checked first and claimed in the transaction that writes
 * the password and revokes the sessions, so all three commit or none do.
 */
describe('reset password — missing credential and atomicity', () => {
  async function requestReset(local: string): Promise<{ email: string; token: string }> {
    const email = await verifiedAccount(local);
    harness.sink.clear();
    await request(harness.server).post(FORGOT).send({ email });
    return { email, token: resetTokenFor(email) };
  }

  const reset = (token: string, password = NEW_PASSWORD) =>
    request(harness.server).post(RESET).send({ token, password });

  const login = (email: string, password: string) =>
    request(harness.server).post(LOGIN).send({ email, password, rememberMe: false });

  async function tokenSpent(email: string): Promise<boolean> {
    const row = await harness.prisma.verificationToken.findFirstOrThrow({
      where: { user: { email }, kind: 'PASSWORD_RESET' },
      orderBy: { createdAt: 'desc' },
    });
    return row.usedAt !== null;
  }

  it('creates the credential for an account that has none, instead of answering 500', async () => {
    const { email, token } = await requestReset('nocred');
    await harness.prisma.userCredential.deleteMany({ where: { user: { email } } });
    expect((await login(email, PASSWORD)).status).toBe(401);

    const response = await reset(token);

    expect(response.status).toBe(204);
    const credential = await harness.prisma.userCredential.findFirstOrThrow({ where: { user: { email } } });
    // A hash, from the application's own Argon2id service — never the plaintext.
    expect(credential.passwordHash.startsWith('$argon2id$')).toBe(true);
    expect(credential.passwordHash).not.toContain(NEW_PASSWORD);
    expect(await harness.app.get(PasswordService).verify(credential.passwordHash, NEW_PASSWORD)).toBe(true);
    expect(credential.failedAttempts).toBe(0);
    expect(credential.lockedUntil).toBeNull();
    expect(credential.totpSecretEnc).toBeNull();
    expect((await login(email, NEW_PASSWORD)).status).toBe(200);
    expect(await tokenSpent(email)).toBe(true);
  });

  it('updates an existing credential in place — one row, never a second', async () => {
    const { email, token } = await requestReset('hascred');
    const before = await harness.prisma.userCredential.findFirstOrThrow({ where: { user: { email } } });

    expect((await reset(token)).status).toBe(204);

    const rows = await harness.prisma.userCredential.findMany({ where: { user: { email } } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.passwordHash).not.toBe(before.passwordHash);
    expect(rows[0]!.passwordUpdatedAt.getTime()).toBeGreaterThanOrEqual(before.passwordUpdatedAt.getTime());
  });

  it('leaves the token, the password and the sessions untouched when the write fails', async () => {
    const { email, token } = await requestReset('rollback');
    await signIn(email);

    // A failure *inside* the transaction, after the claim and the credential
    // write have both run — the last statement before commit.
    const sessions = harness.app.get(SessionService);
    const spy = vi.spyOn(sessions, 'revokeAllFor').mockRejectedValueOnce(new Error('injected failure'));
    try {
      expect((await reset(token)).status).toBe(500);
    } finally {
      spy.mockRestore();
    }

    expect(await tokenSpent(email)).toBe(false);
    expect((await login(email, PASSWORD)).status).toBe(200);
    expect((await login(email, NEW_PASSWORD)).status).toBe(401);
    expect(
      await harness.prisma.session.count({ where: { user: { email }, revokedAt: null } }),
    ).toBeGreaterThan(0);

    // And the same link still works once the failure has passed.
    expect((await reset(token)).status).toBe(204);
    expect((await login(email, NEW_PASSWORD)).status).toBe(200);
  });

  it('lets exactly one of several concurrent resets with one token succeed', async () => {
    const { email, token } = await requestReset('race');

    const responses = await Promise.all([reset(token), reset(token, 'Medora789!'), reset(token)]);
    const statuses = responses.map((response) => response.status).sort();

    expect(statuses).toEqual([204, 422, 422]);
    for (const response of responses.filter((r) => r.status === 422)) {
      expect(errorBody(response).code).toBe('token_invalid');
    }
    expect(await harness.prisma.userCredential.count({ where: { user: { email } } })).toBe(1);
  });

  it('records the reset in the audit trail', async () => {
    const { email, token } = await requestReset('audited');
    const user = await harness.prisma.user.findFirstOrThrow({ where: { email } });

    expect((await reset(token)).status).toBe(204);

    await vi.waitFor(async () => {
      const row = await harness.prisma.auditEvent.findFirst({
        where: { eventType: 'auth.password_reset', actorId: user.id },
      });
      expect(row).not.toBeNull();
    });
  });

  it('records nothing in the audit trail or the activity feed for a refused token', async () => {
    const { email, token } = await requestReset('refused');
    await reset(token);
    const user = await harness.prisma.user.findFirstOrThrow({ where: { email } });
    const audits = () =>
      harness.prisma.auditEvent.count({ where: { eventType: 'auth.password_reset', actorId: user.id } });
    await vi.waitFor(async () => expect(await audits()).toBe(1));

    expect((await reset(token, 'Medora789!')).status).toBe(422);

    expect(await audits()).toBe(1);
    expect(await harness.prisma.userActivityLog.count({ where: { userId: user.id } })).toBe(1);
  });
});

describe('change password', () => {
  it('changes it and answers 204', async () => {
    const email = await verifiedAccount('amelia');
    const token = await signIn(email);

    const response = await request(harness.server)
      .post(CHANGE_PASSWORD)
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });

    expect(response.status).toBe(204);
    expect(
      (await request(harness.server).post(LOGIN).send({ email, password: NEW_PASSWORD, rememberMe: false })).status,
    ).toBe(200);
  });

  it('refuses a wrong current password', async () => {
    const email = await verifiedAccount('amelia');
    const token = await signIn(email);

    const response = await request(harness.server)
      .post(CHANGE_PASSWORD)
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'Wrong123!', newPassword: NEW_PASSWORD });

    expect(response.status).toBe(401);
    expect(errorBody(response).code).toBe('invalid_credentials');
  });

  it('refuses a new password identical to the current one', async () => {
    const email = await verifiedAccount('amelia');
    const token = await signIn(email);

    const response = await request(harness.server)
      .post(CHANGE_PASSWORD)
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: PASSWORD, newPassword: PASSWORD });

    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('weak_password');
  });

  it('applies the password policy to the new password only', async () => {
    const email = await verifiedAccount('amelia');
    const token = await signIn(email);

    const response = await request(harness.server)
      .post(CHANGE_PASSWORD)
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: PASSWORD, newPassword: 'weak' });

    expect(response.status).toBe(422);
    expect(Object.keys(errorBody(response).fieldErrors ?? {})).toContain('newPassword');
  });

  it('keeps the current session and ends the others', async () => {
    const email = await verifiedAccount('amelia');
    const other = await signIn(email);
    const current = await signIn(email);

    await request(harness.server)
      .post(CHANGE_PASSWORD)
      .set('Authorization', `Bearer ${current}`)
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });

    // The user is present and signed in; ending the page they are
    // standing on would punish a good habit.
    const live = await harness.prisma.session.findMany({
      where: { user: { email }, revokedAt: null },
    });
    expect(live).toHaveLength(1);
    expect(other).not.toBe(current);
  });

  it('requires authentication', async () => {
    const response = await request(harness.server)
      .post(CHANGE_PASSWORD)
      .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });

    expect(response.status).toBe(401);
  });
});

describe('email verification', () => {
  it('verifies the address and unblocks sign-in', async () => {
    const email = await registerAccount('priya');
    const token = resetTokenFor(email);

    const blocked = await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false });
    expect(blocked.status).toBe(403);

    const verified = await request(harness.server).post(VERIFY_EMAIL).send({ token });
    expect(verified.status).toBe(204);

    const allowed = await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false });
    expect(allowed.status).toBe(200);
  });

  it('stamps the account', async () => {
    const email = await registerAccount('priya');
    await request(harness.server).post(VERIFY_EMAIL).send({ token: resetTokenFor(email) });

    const user = await harness.prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.emailVerifiedAt).toBeInstanceOf(Date);
  });

  it('refuses the same link twice', async () => {
    const email = await registerAccount('priya');
    const token = resetTokenFor(email);
    await request(harness.server).post(VERIFY_EMAIL).send({ token });

    const second = await request(harness.server).post(VERIFY_EMAIL).send({ token });

    // `VerifyEmailPage` fires from an effect on mount, so a refresh after
    // a successful verification lands here. The account stays verified.
    expect(second.status).toBe(422);
    expect(errorBody(second).code).toBe('token_invalid');
    const user = await harness.prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.emailVerifiedAt).not.toBeNull();
  });

  it('refuses a reset token used as a verification token', async () => {
    const email = await verifiedAccount('amelia');
    harness.sink.clear();
    await request(harness.server).post(FORGOT).send({ email });

    const response = await request(harness.server)
      .post(VERIFY_EMAIL)
      .send({ token: resetTokenFor(email) });

    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('token_invalid');
  });

  describe('resend', () => {
    it('sends a second, independently valid link', async () => {
      const email = await registerAccount('priya');
      const first = resetTokenFor(email);
      harness.sink.clear();

      // The cooldown is real; rewinding rather than waiting for it.
      await harness.prisma.verificationToken.updateMany({
        where: { user: { email } },
        data: { createdAt: new Date(Date.now() - 31_000) },
      });

      const response = await request(harness.server).post(RESEND_VERIFICATION).send({ email });
      expect(response.status).toBe(202);

      const second = resetTokenFor(email);
      expect(second).not.toBe(first);

      // Both work until one is used: DB §A10 inserts a new row rather
      // than mutating the old, which is what a user expects when the
      // first mail arrives late and they have already clicked resend.
      expect((await request(harness.server).post(VERIFY_EMAIL).send({ token: first })).status).toBe(204);
    });

    it('answers identically for an unknown address', async () => {
      const known = await registerAccount('priya');
      const forKnown = await request(harness.server).post(RESEND_VERIFICATION).send({ email: known });
      const forUnknown = await request(harness.server)
        .post(RESEND_VERIFICATION)
        .send({ email: testEmail('nobody') });

      expect(forUnknown.status).toBe(forKnown.status);
      expect(forUnknown.body).toEqual(forKnown.body);
    });

    it('answers identically for an already-verified address, and sends nothing', async () => {
      const email = await verifiedAccount('amelia');
      harness.sink.clear();

      const response = await request(harness.server).post(RESEND_VERIFICATION).send({ email });

      // "That address is already verified" would say the account exists.
      expect(response.status).toBe(202);
      expect(harness.sink.lastTo(email)).toBeUndefined();
    });

    it('honours the cooldown silently', async () => {
      const email = await registerAccount('priya');
      harness.sink.clear();

      const response = await request(harness.server).post(RESEND_VERIFICATION).send({ email });

      expect(response.status).toBe(202);
      expect(harness.sink.lastTo(email)).toBeUndefined();
    });
  });
});
