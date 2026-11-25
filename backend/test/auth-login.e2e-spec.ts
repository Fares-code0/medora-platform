import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  makeClinicalDoctor,
  markVerified,
  registrationBody,
  testEmail,
  grantPlatformAdmin,
} from './support/auth-app';

/**
 * `POST /auth/login` (RM M6.2, API §1.2).
 *
 * The roadmap asks for "every branch of the mock service (success,
 * invalid_credentials, email_unverified, lockout→429)", each carrying the
 * `code` the frontend branches on. The mock is
 * `features/auth/mock/mock-auth-service.ts`; its `login()` has exactly
 * four outcomes plus the 2FA step-up, and each has a `describe` here.
 */
let harness: AuthHarness;
const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const PASSWORD = 'Medora123!';

interface SessionPayload {
  user: { id: string; name: string; email: string; role: string; permissions: string[] };
  accessToken: string;
  expiresIn: number;
}

/** Registers and verifies, so a login can succeed. */
async function seedAccount(local: string, overrides: Record<string, unknown> = {}): Promise<string> {
  const email = testEmail(local);
  await request(harness.server)
    .post(REGISTER)
    .send(registrationBody({ email, ...overrides }));
  await markVerified(harness.prisma, email);
  return email;
}

function decodeClaims(accessToken: string): Record<string, unknown> {
  const payload = accessToken.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}

function setCookies(response: { headers: Record<string, unknown> }): string[] {
  // Node types this as `string | string[]` depending on how many cookies
  // were set; narrowing both arms keeps the type-checked lint rules happy
  // without an assertion that would hide a shape change.
  const raw: unknown = response.headers['set-cookie'];
  if (Array.isArray(raw)) return raw.filter((value): value is string => typeof value === 'string');
  return typeof raw === 'string' ? [raw] : [];
}

function refreshCookie(response: { headers: Record<string, unknown> }): string | undefined {
  return setCookies(response).find((cookie) => cookie.startsWith('medora_rt='));
}

beforeAll(async () => {
  harness = await createAuthHarness('login');
});

afterAll(async () => {
  await harness.reset();
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
});

describe('sign-in', () => {
  describe('success', () => {
    it('returns the SessionUser shape the frontend renders', async () => {
      const email = await seedAccount('amelia');

      const response = await request(harness.server)
        .post(LOGIN)
        .send({ email, password: PASSWORD, rememberMe: false });

      expect(response.status).toBe(200);
      const payload = dataOf<SessionPayload>(response);

      // `SessionUser.id` is the `usr_…` public id, not the row's uuid.
      expect(payload.user.id.startsWith('usr_')).toBe(true);
      expect(payload.user.name).toBe('Dr. Priya Nair');
      expect(payload.user.email).toBe(email);
      expect(payload.user.role).toBe('doctor');
      expect(payload.accessToken.split('.')).toHaveLength(3);
      // API §1.2's example, and MG §11.1-1's ceiling.
      expect(payload.expiresIn).toBe(900);
    });

    it('grants the doctor role bundle the frontend hands out at login', async () => {
      const email = await seedAccount('amelia');
      // A doctor holds the bundle only in clinical standing (§2.6).
      await makeClinicalDoctor(harness.prisma, email);

      const payload = dataOf<SessionPayload>(
        await request(harness.server).post(LOGIN).send({ email, password: PASSWORD, rememberMe: false }),
      );

      // `features/auth/mock/users.ts` — DOCTOR_PERMISSIONS, seeded into
      // `role_permissions` by M5.1 and resolved here.
      expect(payload.user.permissions).toContain('patients.view');
      expect(payload.user.permissions).toContain('prescriptions.create');
      expect(payload.user.permissions).toContain('ai.use');
      // A doctor holds none of the administration capabilities.
      expect(payload.user.permissions).not.toContain('roles.manage');
      expect(payload.user.permissions).not.toContain('logs.export');
    });

    it('mints an access token carrying sub, role, permissions and sid', async () => {
      const email = await seedAccount('amelia');
      // A doctor holds the bundle only in clinical standing (§2.6).
      await makeClinicalDoctor(harness.prisma, email);

      const payload = dataOf<SessionPayload>(
        await request(harness.server).post(LOGIN).send({ email, password: PASSWORD, rememberMe: false }),
      );
      const claims = decodeClaims(payload.accessToken);

      const session = await harness.prisma.session.findFirstOrThrow({
        where: { user: { email } },
      });
      const user = await harness.prisma.user.findUniqueOrThrow({ where: { email } });

      expect(claims['sub']).toBe(user.id);
      expect(claims['pid']).toBe(user.publicId);
      expect(claims['role']).toBe('doctor');
      expect(claims['sid']).toBe(session.id);
      expect(claims['permissions']).toEqual(payload.user.permissions);

      const ttl = Number(claims['exp']) - Number(claims['iat']);
      expect(ttl).toBe(900);
    });

    it('sets the refresh cookie with every attribute the contract fixes', async () => {
      const email = await seedAccount('amelia');

      const cookie = refreshCookie(
        await request(harness.server).post(LOGIN).send({ email, password: PASSWORD, rememberMe: false }),
      );

      expect(cookie).toBeDefined();
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('SameSite=Strict');
      // ADR-011 — scoped wrongly, the browser sends nothing and silent
      // refresh fails for every user with no error anywhere.
      expect(cookie).toContain('Path=/api/v1/auth');
    });

    it('stores only the hash of the refresh token', async () => {
      const email = await seedAccount('amelia');
      const cookie = refreshCookie(
        await request(harness.server).post(LOGIN).send({ email, password: PASSWORD, rememberMe: false }),
      );
      const raw = /medora_rt=([^;]+)/.exec(cookie ?? '')?.[1] ?? '';

      const session = await harness.prisma.session.findFirstOrThrow({ where: { user: { email } } });

      expect(raw.length).toBeGreaterThan(20);
      expect(session.refreshTokenHash).not.toBe(raw);
      expect(session.refreshTokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(session.revokedAt).toBeNull();
    });

    it('gives rememberMe 30 days and a plain session 12 hours (API §1.2)', async () => {
      const email = await seedAccount('amelia');

      const remembered = refreshCookie(
        await request(harness.server).post(LOGIN).send({ email, password: PASSWORD, rememberMe: true }),
      );
      const plain = refreshCookie(
        await request(harness.server).post(LOGIN).send({ email, password: PASSWORD, rememberMe: false }),
      );

      expect(remembered).toContain('Max-Age=2592000');
      expect(plain).toContain('Max-Age=43200');
    });

    it('records a success in login_events', async () => {
      const email = await seedAccount('amelia');
      await request(harness.server).post(LOGIN).send({ email, password: PASSWORD, rememberMe: false });

      const events = await harness.prisma.loginEvent.findMany({ where: { attemptedEmail: email } });

      expect(events).toHaveLength(1);
      expect(events[0]?.result).toBe('SUCCESS');
      expect(events[0]?.failureCode).toBeNull();
      expect(events[0]?.userId).not.toBeNull();
    });

    it('clears a partial failure count', async () => {
      const email = await seedAccount('amelia');
      await request(harness.server).post(LOGIN).send({ email, password: 'Wrong123!', rememberMe: false });
      await request(harness.server).post(LOGIN).send({ email, password: PASSWORD, rememberMe: false });

      const credential = await harness.prisma.userCredential.findFirstOrThrow({
        where: { user: { email } },
      });

      // On success only. Resetting on a timer would let an attacker
      // outlast the window rather than be stopped by it.
      expect(credential.failedAttempts).toBe(0);
      expect(credential.lockedUntil).toBeNull();
    });

    it('records the device and address on the session it starts', async () => {
      const email = await seedAccount('amelia');
      // Longer than the 120-character column (DB §A7), so the truncation
      // is exercised rather than assumed.
      const userAgent = `Mozilla/5.0 (Macintosh) TestAgent/1.0 ${'x'.repeat(200)}`;

      const response = await request(harness.server)
        .post(LOGIN)
        .set('User-Agent', userAgent)
        .send({ email, password: PASSWORD, rememberMe: false });
      expect(response.status).toBe(200);

      // `/me/sessions` renders these two columns; a session that dropped
      // them would list every sign-in as an unknown device.
      const session = await harness.prisma.session.findFirstOrThrow({ where: { user: { email } } });
      expect(session.device).toBe(userAgent.slice(0, 120));
      expect(session.ipAddress).not.toBeNull();
    });

    it('leaves the device empty when the client sends no User-Agent', async () => {
      const email = await seedAccount('amelia');

      await request(harness.server)
        .post(LOGIN)
        .unset('User-Agent')
        .send({ email, password: PASSWORD, rememberMe: false });

      const session = await harness.prisma.session.findFirstOrThrow({ where: { user: { email } } });
      expect(session.device).toBeNull();
    });
  });

  describe('invalid_credentials', () => {
    it('answers the same 401 for a wrong password and an unknown address', async () => {
      const email = await seedAccount('amelia');

      const wrongPassword = await request(harness.server)
        .post(LOGIN)
        .send({ email, password: 'Wrong123!', rememberMe: false });
      const unknownAddress = await request(harness.server)
        .post(LOGIN)
        .send({ email: testEmail('nobody'), password: PASSWORD, rememberMe: false });

      expect(wrongPassword.status).toBe(401);
      expect(unknownAddress.status).toBe(401);
      expect(errorBody(wrongPassword).code).toBe('invalid_credentials');
      // Identical shape: anything that differs is an enumeration oracle.
      expect(errorBody(unknownAddress)).toEqual(errorBody(wrongPassword));
    });

    it('sets no cookie and creates no session', async () => {
      const email = await seedAccount('amelia');
      const response = await request(harness.server)
        .post(LOGIN)
        .send({ email, password: 'Wrong123!', rememberMe: false });

      expect(refreshCookie(response)).toBeUndefined();
      expect(await harness.prisma.session.count({ where: { user: { email } } })).toBe(0);
    });

    it('records the failed attempt against an address with no account', async () => {
      const email = testEmail('nobody');
      await request(harness.server).post(LOGIN).send({ email, password: PASSWORD, rememberMe: false });

      const event = await harness.prisma.loginEvent.findFirstOrThrow({
        where: { attemptedEmail: email },
      });

      // Someone working through a list of addresses produces no `users`
      // rows at all — dropping these would hide the pattern worth seeing.
      expect(event.userId).toBeNull();
      expect(event.result).toBe('FAILED');
      expect(event.failureCode).toBe('invalid_credentials');
    });

    it('records the device and address of an attempt', async () => {
      const email = await seedAccount('amelia');
      await request(harness.server)
        .post(LOGIN)
        .set('User-Agent', 'Mozilla/5.0 (Macintosh) TestAgent/1.0')
        .send({ email, password: 'Wrong123!', rememberMe: false });

      const event = await harness.prisma.loginEvent.findFirstOrThrow({
        where: { attemptedEmail: email },
      });

      expect(event.device).toContain('TestAgent/1.0');
      expect(event.ipAddress).not.toBeNull();
    });
  });

  describe('email_unverified', () => {
    it('answers 403 with the code the verify-email page routes on', async () => {
      const email = testEmail('unverified');
      await request(harness.server).post(REGISTER).send(registrationBody({ email }));

      const response = await request(harness.server)
        .post(LOGIN)
        .send({ email, password: PASSWORD, rememberMe: false });

      expect(response.status).toBe(403);
      expect(errorBody(response).code).toBe('email_unverified');
      expect(await harness.prisma.session.count({ where: { user: { email } } })).toBe(0);
    });

    it('is checked after the password, not before', async () => {
      // Answering it first would let anyone discover which addresses have
      // unverified accounts without knowing a password (API §1.2).
      const email = testEmail('unverified');
      await request(harness.server).post(REGISTER).send(registrationBody({ email }));

      const response = await request(harness.server)
        .post(LOGIN)
        .send({ email, password: 'Wrong123!', rememberMe: false });

      expect(response.status).toBe(401);
      expect(errorBody(response).code).toBe('invalid_credentials');
    });
  });

  describe('account status (ADR-035 §6)', () => {
    it.each(['SUSPENDED', 'INACTIVE', 'LOCKED'] as const)(
      'refuses a %s account with account_inactive',
      async (status) => {
        const email = await seedAccount('amelia');
        await harness.prisma.user.update({ where: { email }, data: { status } });

        const response = await request(harness.server)
          .post(LOGIN)
          .send({ email, password: PASSWORD, rememberMe: false });

        // Before ADR-035 nothing read `users.status`, so an administrator
        // who suspended an account was changing a value that stopped
        // nothing and the sign-in succeeded.
        expect(response.status).toBe(403);
        expect(errorBody(response).code).toBe('account_inactive');
        expect(await harness.prisma.session.count({ where: { user: { email } } })).toBe(0);
      },
    );

    it('is checked after the password, not before', async () => {
      // Same reasoning as `email_unverified`: answering it to an
      // unauthenticated caller would let anyone enumerate which of a
      // clinic's staff have been suspended.
      const email = await seedAccount('amelia');
      await harness.prisma.user.update({ where: { email }, data: { status: 'SUSPENDED' } });

      const response = await request(harness.server)
        .post(LOGIN)
        .send({ email, password: 'Wrong123!', rememberMe: false });

      expect(response.status).toBe(401);
      expect(errorBody(response).code).toBe('invalid_credentials');
    });

    it('records the refusal in login_events', async () => {
      const email = await seedAccount('amelia');
      await harness.prisma.user.update({ where: { email }, data: { status: 'SUSPENDED' } });

      await request(harness.server)
        .post(LOGIN)
        .send({ email, password: PASSWORD, rememberMe: false });

      const event = await harness.prisma.loginEvent.findFirstOrThrow({
        where: { attemptedEmail: email },
        orderBy: { occurredAt: 'desc' },
      });
      expect(event.result).toBe('FAILED');
      expect(event.failureCode).toBe('account_inactive');
    });

    it('lets an ACTIVE account through unchanged', async () => {
      const email = await seedAccount('amelia');

      const response = await request(harness.server)
        .post(LOGIN)
        .send({ email, password: PASSWORD, rememberMe: false });

      expect(response.status).toBe(200);
    });
  });

  describe('mandatory administrator MFA (ADR-035 §7)', () => {
    /** An ACTIVE admin account that never enrolled a second factor. */
    async function seedUnenrolledAdmin(local: string): Promise<string> {
      const email = await seedAccount(local);
      const adminRole = await harness.prisma.role.findUniqueOrThrow({
        where: { code: 'admin' },
      });
      await harness.prisma.user.update({ where: { email }, data: { roleId: adminRole.id } });
      await grantPlatformAdmin(harness.prisma, email);
      return email;
    }

    it('refuses an administrator with no enrolled second factor', async () => {
      const email = await seedUnenrolledAdmin('marcus');

      const response = await request(harness.server)
        .post(LOGIN)
        .send({ email, password: PASSWORD, rememberMe: false });

      // A refusal rather than a challenge: there is no secret to
      // challenge against, so a step-up would mint a code nobody can
      // produce. The invitation flow makes this state unreachable for
      // accounts created the supported way; this is the backstop for a
      // role changed after the fact.
      expect(response.status).toBe(403);
      expect(errorBody(response).code).toBe('two_factor_required');
      expect(await harness.prisma.session.count({ where: { user: { email } } })).toBe(0);
    });

    it('does not impose the same rule on a doctor', async () => {
      // ADR-035 §7 has MFA strongly recommended for clinicians, not
      // required — requiring it would lock out every doctor who has not
      // enrolled, which is a platform-wide outage delivered as a
      // security improvement.
      const email = await seedAccount('amelia');

      const response = await request(harness.server)
        .post(LOGIN)
        .send({ email, password: PASSWORD, rememberMe: false });

      expect(response.status).toBe(200);
    });

    it('is checked after the password', async () => {
      const email = await seedUnenrolledAdmin('marcus');

      const response = await request(harness.server)
        .post(LOGIN)
        .send({ email, password: 'Wrong123!', rememberMe: false });

      expect(response.status).toBe(401);
      expect(errorBody(response).code).toBe('invalid_credentials');
    });
  });

  describe('lockout', () => {
    it('answers 429 rate_limited once the attempt limit is reached', async () => {
      const email = await seedAccount('amelia');

      const responses = [];
      for (let attempt = 0; attempt < 5; attempt += 1) {
        responses.push(
          await request(harness.server).post(LOGIN).send({ email, password: 'Wrong123!', rememberMe: false }),
        );
      }

      // The seeded `loginAttemptLimit` is 5 (MG §11.1-8), so the first
      // four are ordinary failures and the fifth locks the account.
      expect(responses.slice(0, 4).map((r) => r.status)).toEqual([401, 401, 401, 401]);
      expect(responses[4]?.status).toBe(429);
      expect(errorBody(responses[4]!).code).toBe('rate_limited');
      // API §0.3 — a 429 always carries `Retry-After`.
      expect(Number(responses[4]?.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('refuses the correct password while the lock holds', async () => {
      const email = await seedAccount('amelia');
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await request(harness.server).post(LOGIN).send({ email, password: 'Wrong123!', rememberMe: false });
      }

      const response = await request(harness.server)
        .post(LOGIN)
        .send({ email, password: PASSWORD, rememberMe: false });

      expect(response.status).toBe(429);
      expect(await harness.prisma.session.count({ where: { user: { email } } })).toBe(0);
    });

    it('costs no password verification while locked', async () => {
      // Checked before the hash, so a locked account is cheap to refuse.
      const email = await seedAccount('amelia');
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await request(harness.server).post(LOGIN).send({ email, password: 'Wrong123!', rememberMe: false });
      }

      const before = await harness.prisma.userCredential.findFirstOrThrow({
        where: { user: { email } },
      });
      await request(harness.server).post(LOGIN).send({ email, password: 'Wrong123!', rememberMe: false });
      const after = await harness.prisma.userCredential.findFirstOrThrow({
        where: { user: { email } },
      });

      // The counter does not keep climbing once the lock is set: the
      // request never reaches the verification that would increment it.
      expect(after.failedAttempts).toBe(before.failedAttempts);
    });

    it('honours a limit an administrator lowers', async () => {
      const email = await seedAccount('amelia');
      harness.policy.overrides = { loginAttemptLimit: 2 };

      const first = await request(harness.server)
        .post(LOGIN)
        .send({ email, password: 'Wrong123!', rememberMe: false });
      const second = await request(harness.server)
        .post(LOGIN)
        .send({ email, password: 'Wrong123!', rememberMe: false });

      expect(first.status).toBe(401);
      expect(second.status).toBe(429);
    });

    it('lets the lock expire', async () => {
      const email = await seedAccount('amelia');
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await request(harness.server).post(LOGIN).send({ email, password: 'Wrong123!', rememberMe: false });
      }

      // Rewinding the stored deadline rather than waiting fifteen minutes:
      // what is under test is that an elapsed lock stops applying.
      await harness.prisma.userCredential.updateMany({
        where: { user: { email } },
        data: { lockedUntil: new Date(Date.now() - 1_000) },
      });

      const response = await request(harness.server)
        .post(LOGIN)
        .send({ email, password: PASSWORD, rememberMe: false });

      expect(response.status).toBe(200);
    });

    it('records each failure with its own code', async () => {
      const email = await seedAccount('amelia');
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await request(harness.server).post(LOGIN).send({ email, password: 'Wrong123!', rememberMe: false });
      }

      const events = await harness.prisma.loginEvent.findMany({
        where: { attemptedEmail: email },
        orderBy: { occurredAt: 'asc' },
      });

      expect(events).toHaveLength(5);
      expect(events.map((event) => event.failureCode)).toEqual([
        'invalid_credentials',
        'invalid_credentials',
        'invalid_credentials',
        'invalid_credentials',
        'rate_limited',
      ]);
    });
  });

  describe('the single-session policy', () => {
    it('revokes the other sessions when an administrator turns it on', async () => {
      const email = await seedAccount('amelia');
      await request(harness.server).post(LOGIN).send({ email, password: PASSWORD, rememberMe: false });

      harness.policy.overrides = { singleSessionPerUser: true };
      await request(harness.server).post(LOGIN).send({ email, password: PASSWORD, rememberMe: false });

      const sessions = await harness.prisma.session.findMany({ where: { user: { email } } });
      expect(sessions).toHaveLength(2);
      expect(sessions.filter((session) => session.revokedAt === null)).toHaveLength(1);
    });

    it('leaves both alive when it is off', async () => {
      const email = await seedAccount('amelia');
      await request(harness.server).post(LOGIN).send({ email, password: PASSWORD, rememberMe: false });
      await request(harness.server).post(LOGIN).send({ email, password: PASSWORD, rememberMe: false });

      const live = await harness.prisma.session.count({
        where: { user: { email }, revokedAt: null },
      });
      expect(live).toBe(2);
    });
  });

  describe('the second-factor step-up', () => {
    it('returns requiresOtp and no session when 2FA is enabled', async () => {
      const email = await seedAccount('julian');
      await harness.prisma.user.update({ where: { email }, data: { twoFactorEnabled: true } });

      const response = await request(harness.server)
        .post(LOGIN)
        .send({ email, password: PASSWORD, rememberMe: false });

      expect(response.status).toBe(200);
      const payload = dataOf<{ requiresOtp: boolean; otpToken: string }>(response);
      expect(payload.requiresOtp).toBe(true);
      expect(payload.otpToken.length).toBeGreaterThan(0);

      // "no session yet" (API §1.2) — a cookie here would be a session
      // by another name.
      expect(refreshCookie(response)).toBeUndefined();
      expect(await harness.prisma.session.count({ where: { user: { email } } })).toBe(0);
    });

    it('steps up an enrolled account when the policy requires two factors', async () => {
      const email = await seedAccount('amelia');
      await harness.prisma.user.update({ where: { email }, data: { twoFactorEnabled: true } });
      harness.policy.overrides = { twoFactorRequired: true };

      const response = await request(harness.server)
        .post(LOGIN)
        .send({ email, password: PASSWORD, rememberMe: false });

      expect(dataOf<{ requiresOtp: boolean }>(response).requiresOtp).toBe(true);
    });

    it('refuses an unenrolled account under the policy rather than challenge it', async () => {
      // ADR-035 §7: an account that never enrolled has no secret, so a
      // challenge would be a code screen no code can pass. The policy
      // used to issue one anyway, and every attempt answered otp_invalid.
      const email = await seedAccount('amelia');
      harness.policy.overrides = { twoFactorRequired: true };

      const response = await request(harness.server)
        .post(LOGIN)
        .send({ email, password: PASSWORD, rememberMe: false });

      expect(response.status).toBe(403);
      expect(errorBody(response).code).toBe('two_factor_required');
      const user = { email };
      expect(await harness.prisma.otpCode.count({ where: { user } })).toBe(0);
      expect(await harness.prisma.session.count({ where: { user } })).toBe(0);
    });

    it('checks the password before refusing for the policy', async () => {
      // Otherwise the 403 tells anyone which addresses have accounts.
      const email = await seedAccount('amelia');
      harness.policy.overrides = { twoFactorRequired: true };

      const response = await request(harness.server)
        .post(LOGIN)
        .send({ email, password: 'Wrong123!', rememberMe: false });

      expect(response.status).toBe(401);
      expect(errorBody(response).code).toBe('invalid_credentials');
    });

    it('still refuses a wrong password before offering the step-up', async () => {
      const email = await seedAccount('julian');
      await harness.prisma.user.update({ where: { email }, data: { twoFactorEnabled: true } });

      const response = await request(harness.server)
        .post(LOGIN)
        .send({ email, password: 'Wrong123!', rememberMe: false });

      expect(response.status).toBe(401);
      expect(errorBody(response).code).toBe('invalid_credentials');
    });
  });

  describe('validation', () => {
    it('does not apply the signup password policy to a sign-in', async () => {
      // Rejecting a short password with a 422 would answer differently
      // for a wrong password — an enumeration oracle by another route.
      const response = await request(harness.server)
        .post(LOGIN)
        .send({ email: testEmail('amelia'), password: 'x', rememberMe: false });

      expect(response.status).toBe(401);
    });

    it('rejects a malformed address with 422 and fieldErrors', async () => {
      const response = await request(harness.server)
        .post(LOGIN)
        .send({ email: 'not-an-email', password: PASSWORD, rememberMe: false });

      expect(response.status).toBe(422);
      expect(Object.keys(errorBody(response).fieldErrors ?? {})).toContain('email');
    });
  });
});

describe('the global access-token guard', () => {
  it('leaves the health probes reachable', async () => {
    // A probe that requires a token cannot report that auth is down, and
    // an orchestrator has no credentials to offer.
    expect((await request(harness.server).get('/api/v1/health')).status).toBe(200);
  });

  it('refuses an unknown route with 404, not 401', async () => {
    // The guard runs before routing resolves in some frameworks; here it
    // must not turn a typo into a login prompt.
    expect((await request(harness.server).get('/api/v1/nope')).status).toBe(404);
  });
});
