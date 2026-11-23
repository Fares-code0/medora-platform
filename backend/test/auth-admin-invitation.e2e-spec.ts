import { Secret, TOTP } from 'otpauth';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { IdentityRepository } from '../src/modules/auth/repositories/identity.repository';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  markVerified,
  registrationBody,
  testEmail,
  grantPlatformAdmin,
} from './support/auth-app';
import { body as mailBody, header } from './support/smtp-sink';

/**
 * Administrator provisioning (ADR-035 §5).
 *
 * The suite is organised around the single property the whole change
 * exists to establish: **an account holding `roles.manage` cannot be
 * obtained by anyone who does not already hold it.** Everything else here
 * — the two phases, the token's single use, the mandatory second factor —
 * is machinery in service of that.
 *
 * `auth-register.e2e-spec.ts` owns the other half: that
 * `POST /auth/register` refuses `role: 'admin'` outright.
 */
let harness: AuthHarness;
const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const INVITE = '/api/v1/auth/admin-invitations';
const ACCEPT = '/api/v1/auth/admin-invitations/accept';
const ACTIVATE = '/api/v1/auth/admin-invitations/activate';
const PASSWORD = 'Medora123!';
const NEW_PASSWORD = 'Invited123!';

interface SessionPayload {
  user: { id: string; name: string; email: string; role: string; permissions: string[] };
  accessToken: string;
  expiresIn: number;
}

interface InvitationCreated {
  email: string;
  role: string;
  expiresAt: string;
}

interface AcceptPayload {
  nextStep: 'configure-mfa';
  email: string;
  secret: string;
  otpauthUrl: string;
  recoveryCodes: string[];
}

beforeAll(async () => {
  harness = await createAuthHarness('admin-invite');
});

afterAll(async () => {
  await harness.reset();
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
});

/** What the invitee's authenticator app would be showing right now. */
function currentCode(secret: string): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

/**
 * An administrator who can invite, built the only way the platform now
 * allows one to exist: seeded directly, then given the role and the
 * second factor its own rules require.
 *
 * This is deliberately awkward, and the awkwardness is the point — there
 * is no endpoint that creates the first administrator, because every
 * endpoint that creates one requires an administrator. A real deployment
 * bootstraps it through the seed, which is exactly what this does.
 */
async function seedAdmin(local: string): Promise<{ email: string; token: string }> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  const adminRole = await harness.prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
  await harness.prisma.user.update({
    where: { email },
    // `twoFactorEnabled` without a secret would be refused by the login
    // step-up, so this account is given the role and left with the factor
    // off — then the test below asserts it *cannot* sign in, which is the
    // backstop ADR-035 §7 describes. For the tests that need a working
    // admin token, `adminToken` enrols it properly.
    data: { roleId: adminRole.id },
  });

  return { email, token: '' };
}

/**
 * A usable access token for an administrator, second factor and all.
 *
 * Enrols through the real `me/2fa` endpoints so the account reaches the
 * state ADR-035 §7 requires, then signs in through the OTP step-up.
 */
async function adminToken(email: string): Promise<string> {
  // Sign in while the account is still a doctor-shaped one, to get a
  // token with which to enrol.
  const doctorRole = await harness.prisma.role.findUniqueOrThrow({ where: { code: 'doctor' } });
  const adminRole = await harness.prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
  await harness.prisma.user.update({ where: { email }, data: { roleId: doctorRole.id } });

  const first = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });
  const bootstrapToken = dataOf<SessionPayload>(first).accessToken;

  const setup = await request(harness.server)
    .post('/api/v1/me/2fa/setup')
    .set('Authorization', `Bearer ${bootstrapToken}`)
    .send({ password: PASSWORD });
  const secret = dataOf<{ secret: string }>(setup).secret;

  await request(harness.server)
    .post('/api/v1/me/2fa/enable')
    .set('Authorization', `Bearer ${bootstrapToken}`)
    .send({ code: currentCode(secret) });

  // Now make it an administrator and sign in properly, through the
  // step-up its enrolled factor now requires.
  await harness.prisma.user.update({ where: { email }, data: { roleId: adminRole.id } });
  await grantPlatformAdmin(harness.prisma, email);

  const login = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });
  const otpToken = dataOf<{ otpToken: string }>(login).otpToken;

  const verified = await request(harness.server)
    .post('/api/v1/auth/otp/verify')
    .send({ otpToken, code: currentCode(secret) });

  return dataOf<SessionPayload>(verified).accessToken;
}

/** The `token` query parameter of the invitation link in a captured mail. */
function invitationToken(to: string): string {
  const mail = harness.sink.lastTo(to);
  if (mail === undefined) throw new Error(`No mail sent to ${to}`);
  const match = /[?&]token=([A-Za-z0-9_-]+)/.exec(mailBody(mail));
  if (match?.[1] === undefined) throw new Error(`No token in mail body:\n${mailBody(mail)}`);
  return match[1];
}

async function inviteFrom(
  token: string,
  body: Record<string, unknown> = {},
): Promise<request.Response> {
  return request(harness.server)
    .post(INVITE)
    .set('Authorization', `Bearer ${token}`)
    .send({ email: testEmail('invitee'), role: 'admin', ...body });
}

describe('who may create an invitation', () => {
  it('refuses an unauthenticated caller', async () => {
    const response = await request(harness.server)
      .post(INVITE)
      .send({ email: testEmail('invitee'), role: 'admin' });

    // 401 and not 403: no principal at all is an authentication failure
    // (ADR-013), and the frontend reacts to the two differently.
    expect(response.status).toBe(401);
  });

  it('refuses a doctor, who holds no roles.manage', async () => {
    const email = testEmail('doctor');
    await request(harness.server).post(REGISTER).send(registrationBody({ email }));
    await markVerified(harness.prisma, email);

    const login = await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false });

    const response = await inviteFrom(dataOf<SessionPayload>(login).accessToken);

    // A doctor is authenticated and clinically privileged, and still
    // cannot mint an administrator. This is the case that would have been
    // pointless before ADR-035, when they could simply have registered
    // one from the public form.
    expect(response.status).toBe(403);
    expect(await harness.prisma.adminInvitation.count()).toBe(0);
  });

  it('refuses a patient', async () => {
    const email = testEmail('patient');
    await request(harness.server).post(REGISTER).send({
      firstName: 'Sara',
      lastName: 'Ali',
      email,
      phone: '+20 100 555 1212',
      password: PASSWORD,
      role: 'patient',
      acceptTerms: true,
      acceptPrivacy: true,
    });
    await markVerified(harness.prisma, email);

    const login = await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false });

    const response = await inviteFrom(dataOf<SessionPayload>(login).accessToken);

    // A patient resolves to zero capabilities (ADR-030 §6), so `@Can`
    // denies without a line of code.
    expect(response.status).toBe(403);
  });

  it('allows an administrator, and mails the invitee', async () => {
    const { email: adminEmail } = await seedAdmin('boss');
    const token = await adminToken(adminEmail);

    const response = await inviteFrom(token);

    expect(response.status).toBe(201);
    const created = dataOf<InvitationCreated>(response);
    expect(created.email).toBe(testEmail('invitee'));
    expect(created.role).toBe('admin');

    const mail = harness.sink.lastTo(testEmail('invitee'));
    expect(mail).toBeDefined();
    expect(header(mail!, 'Subject')).toBe('You have been invited to Medora');
    expect(mailBody(mail!)).toContain('http://localhost:5173/accept-invitation?token=');
  });

  it('never returns the token in the response body', async () => {
    const { email: adminEmail } = await seedAdmin('boss');
    const response = await inviteFrom(await adminToken(adminEmail));

    // Returning it would let anyone holding `roles.manage` provision an
    // administrator at an address they control, without the owner of that
    // address ever being involved — which removes the one out-of-band
    // step that makes this flow worth having.
    const raw = invitationToken(testEmail('invitee'));
    expect(JSON.stringify(response.body)).not.toContain(raw);
  });

  it('stores only the hash of the emailed token', async () => {
    const { email: adminEmail } = await seedAdmin('boss');
    await inviteFrom(await adminToken(adminEmail));

    const raw = invitationToken(testEmail('invitee'));
    const stored = await harness.prisma.adminInvitation.findFirstOrThrow({
      where: { email: testEmail('invitee') },
    });

    expect(stored.tokenHash).not.toBe(raw);
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored.acceptedAt).toBeNull();
    expect(stored.completedAt).toBeNull();
  });

  it('refuses an invitation to an address that already has an account', async () => {
    const { email: adminEmail } = await seedAdmin('boss');
    const token = await adminToken(adminEmail);

    const response = await inviteFrom(token, { email: adminEmail });

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('email_taken');
  });

  it('refuses a role outside the invitable set', async () => {
    const { email: adminEmail } = await seedAdmin('boss');
    const token = await adminToken(adminEmail);

    for (const role of ['doctor', 'patient', 'superuser']) {
      const response = await inviteFrom(token, { role });

      // `doctor` is excluded deliberately: this flow collects no
      // professional registration number and must not fabricate one.
      expect(response.status).toBe(422);
      expect(Object.keys(errorBody(response).fieldErrors ?? {})).toContain('role');
    }
  });

  it('refuses a capability outside the catalogue', async () => {
    const { email: adminEmail } = await seedAdmin('boss');
    const token = await adminToken(adminEmail);

    const response = await inviteFrom(token, { permissions: ['patients.view', 'nonsense.grant'] });

    expect(response.status).toBe(422);
  });

  it('supersedes an earlier unaccepted invitation to the same address', async () => {
    const { email: adminEmail } = await seedAdmin('boss');
    const token = await adminToken(adminEmail);

    await inviteFrom(token);
    const firstToken = invitationToken(testEmail('invitee'));

    await inviteFrom(token);
    const secondToken = invitationToken(testEmail('invitee'));
    expect(secondToken).not.toBe(firstToken);

    // Two live tokens for one account would mean revoking the visible one
    // does not close the other.
    const first = await request(harness.server)
      .post(ACCEPT)
      .send({ token: firstToken, password: NEW_PASSWORD });
    expect(first.status).toBe(422);
    expect(errorBody(first).code).toBe('token_invalid');

    const second = await request(harness.server)
      .post(ACCEPT)
      .send({ token: secondToken, password: NEW_PASSWORD });
    expect(second.status).toBe(200);
  });
});

describe('accepting and activating', () => {
  async function invite(body: Record<string, unknown> = {}): Promise<string> {
    const { email: adminEmail } = await seedAdmin('boss');
    await inviteFrom(await adminToken(adminEmail), body);
    return invitationToken(testEmail('invitee'));
  }

  it('creates the account INACTIVE with a second factor to enrol', async () => {
    const token = await invite();

    const response = await request(harness.server)
      .post(ACCEPT)
      .send({ token, password: NEW_PASSWORD });

    expect(response.status).toBe(200);
    const payload = dataOf<AcceptPayload>(response);
    expect(payload.nextStep).toBe('configure-mfa');
    expect(payload.secret).toMatch(/^[A-Z2-7]+$/);
    expect(payload.otpauthUrl).toContain('otpauth://totp/');
    expect(payload.recoveryCodes).toHaveLength(10);

    // No session. An administrator account with no second factor is not
    // one anybody should be signed in to.
    expect(JSON.stringify(response.body)).not.toContain('accessToken');

    const user = await harness.prisma.user.findUniqueOrThrow({
      where: { email: testEmail('invitee') },
      include: { role: true },
    });
    expect(user.role.code).toBe('admin');
    expect(user.status).toBe('INACTIVE');
    expect(user.twoFactorEnabled).toBe(false);
    // The link arrived at that inbox and was opened — the same proof
    // `verify-email` collects.
    expect(user.emailVerifiedAt).not.toBeNull();
  });

  it('cannot sign in between the two phases', async () => {
    const token = await invite();
    await request(harness.server).post(ACCEPT).send({ token, password: NEW_PASSWORD });

    const response = await request(harness.server)
      .post(LOGIN)
      .send({ email: testEmail('invitee'), password: NEW_PASSWORD, rememberMe: false });

    // The password is right. The account is not usable, because MFA
    // enrolment was abandoned — this is what makes the second phase
    // mandatory rather than merely recommended.
    expect(response.status).toBe(403);
    expect(errorBody(response).code).toBe('account_inactive');
  });

  it('activates on a valid code and then signs in through the step-up', async () => {
    const token = await invite();
    const accepted = await request(harness.server)
      .post(ACCEPT)
      .send({ token, password: NEW_PASSWORD });
    const secret = dataOf<AcceptPayload>(accepted).secret;

    const activated = await request(harness.server)
      .post(ACTIVATE)
      .send({ token, code: currentCode(secret) });

    expect(activated.status).toBe(200);
    expect(dataOf<{ nextStep: string }>(activated).nextStep).toBe('login');

    const user = await harness.prisma.user.findUniqueOrThrow({
      where: { email: testEmail('invitee') },
    });
    expect(user.status).toBe('ACTIVE');
    expect(user.twoFactorEnabled).toBe(true);

    // And the account now works, through the OTP step-up its enrolled
    // factor requires.
    const login = await request(harness.server)
      .post(LOGIN)
      .send({ email: testEmail('invitee'), password: NEW_PASSWORD, rememberMe: false });
    expect(login.status).toBe(200);

    const otpToken = dataOf<{ otpToken: string }>(login).otpToken;
    const session = await request(harness.server)
      .post('/api/v1/auth/otp/verify')
      .send({ otpToken, code: currentCode(secret) });

    expect(session.status).toBe(200);
    expect(dataOf<SessionPayload>(session).user.role).toBe('admin');
    expect(dataOf<SessionPayload>(session).user.permissions).toContain('roles.manage');
  });

  it('applies the per-user capability overrides the invitation carried', async () => {
    const token = await invite({ permissions: ['ai.use'] });
    const accepted = await request(harness.server)
      .post(ACCEPT)
      .send({ token, password: NEW_PASSWORD });
    await request(harness.server)
      .post(ACTIVATE)
      .send({ token, code: currentCode(dataOf<AcceptPayload>(accepted).secret) });

    const user = await harness.prisma.user.findUniqueOrThrow({
      where: { email: testEmail('invitee') },
      include: { permissions: { include: { permission: true } } },
    });

    expect(user.permissions.map((entry) => entry.permission.code)).toContain('ai.use');
    expect(user.permissions.every((entry) => entry.allowed)).toBe(true);
  });

  it('refuses a wrong code without activating', async () => {
    const token = await invite();
    await request(harness.server).post(ACCEPT).send({ token, password: NEW_PASSWORD });

    const response = await request(harness.server).post(ACTIVATE).send({ token, code: '000000' });

    expect(response.status).toBe(401);
    expect(errorBody(response).code).toBe('otp_invalid');

    const user = await harness.prisma.user.findUniqueOrThrow({
      where: { email: testEmail('invitee') },
    });
    expect(user.status).toBe('INACTIVE');
    expect(user.twoFactorEnabled).toBe(false);
  });

  it('refuses activation before acceptance', async () => {
    const token = await invite();

    // Phase 2 requires exactly the state phase 1 leaves behind.
    const response = await request(harness.server).post(ACTIVATE).send({ token, code: '123456' });

    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('token_invalid');
  });

  it('enforces the password policy on the password being set', async () => {
    const token = await invite();

    const response = await request(harness.server).post(ACCEPT).send({ token, password: 'weak' });

    expect(response.status).toBe(422);
    expect(Object.keys(errorBody(response).fieldErrors ?? {})).toContain('password');
    expect(await harness.prisma.user.count({ where: { email: testEmail('invitee') } })).toBe(0);
  });
});

describe('a token that must not work twice', () => {
  async function invite(): Promise<string> {
    const { email: adminEmail } = await seedAdmin('boss');
    await inviteFrom(await adminToken(adminEmail));
    return invitationToken(testEmail('invitee'));
  }

  it('refuses a second acceptance of the same invitation', async () => {
    const token = await invite();
    await request(harness.server).post(ACCEPT).send({ token, password: NEW_PASSWORD });

    const second = await request(harness.server)
      .post(ACCEPT)
      .send({ token, password: 'Different123!' });

    // Phase 1 is guarded by `accepted_at`, so a replay cannot re-set the
    // password of an account someone else now holds.
    expect(second.status).toBe(422);
    expect(errorBody(second).code).toBe('token_invalid');
  });

  it('refuses reuse after the whole flow has completed', async () => {
    const token = await invite();
    const accepted = await request(harness.server)
      .post(ACCEPT)
      .send({ token, password: NEW_PASSWORD });
    const secret = dataOf<AcceptPayload>(accepted).secret;

    await request(harness.server)
      .post(ACTIVATE)
      .send({ token, code: currentCode(secret) });

    for (const [path, body] of [
      [ACCEPT, { token, password: NEW_PASSWORD }],
      [ACTIVATE, { token, code: currentCode(secret) }],
    ] as const) {
      const response = await request(harness.server).post(path).send(body);
      expect(response.status).toBe(422);
      expect(errorBody(response).code).toBe('token_invalid');
    }

    // Exactly one account, still active — the replays changed nothing.
    expect(await harness.prisma.user.count({ where: { email: testEmail('invitee') } })).toBe(1);
  });

  it('refuses an expired invitation', async () => {
    const token = await invite();
    await harness.prisma.adminInvitation.updateMany({
      where: { email: testEmail('invitee') },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });

    const response = await request(harness.server)
      .post(ACCEPT)
      .send({ token, password: NEW_PASSWORD });

    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('token_invalid');
    expect(await harness.prisma.user.count({ where: { email: testEmail('invitee') } })).toBe(0);
  });

  it('refuses a revoked invitation', async () => {
    const token = await invite();
    await harness.prisma.adminInvitation.updateMany({
      where: { email: testEmail('invitee') },
      data: { revokedAt: new Date() },
    });

    const response = await request(harness.server)
      .post(ACCEPT)
      .send({ token, password: NEW_PASSWORD });

    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('token_invalid');
  });

  it('refuses a token that never existed, identically', async () => {
    const response = await request(harness.server)
      .post(ACCEPT)
      .send({ token: 'not-a-real-token', password: NEW_PASSWORD });

    // Unknown, expired, revoked, used and wrong-phase are one answer. A
    // caller who could tell them apart would eventually surface the
    // difference to someone holding a stolen link.
    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('token_invalid');
  });
});

/**
 * What happens in the window between reading an invitation and writing
 * the account, made deterministic.
 *
 * Both phases read the invitation, check it, and then write inside a
 * transaction whose first statement is a conditional claim. The claim is
 * what makes a revocation, a second click or a parallel activation lose,
 * and only a request that lands in that window reaches it. Here the window
 * is entered on purpose: a spy on a real collaborator changes the database
 * at the moment the service consults it, then lets the service continue.
 */
describe('the window between the check and the write', () => {
  async function invite(): Promise<string> {
    const { email: adminEmail } = await seedAdmin('boss');
    await inviteFrom(await adminToken(adminEmail));
    return invitationToken(testEmail('invitee'));
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a revocation that lands mid-acceptance wins, and leaves no account', async () => {
    const token = await invite();
    const identity = harness.app.get(IdentityRepository);
    const original = identity.findByEmail.bind(identity);
    vi.spyOn(identity, 'findByEmail').mockImplementation(async (email) => {
      await harness.prisma.adminInvitation.updateMany({
        where: { email: testEmail('invitee') },
        data: { revokedAt: new Date() },
      });
      return original(email);
    });

    const response = await request(harness.server)
      .post(ACCEPT)
      .send({ token, password: NEW_PASSWORD });

    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('token_invalid');
    // The account was created inside the transaction and rolled back with
    // the lost claim: no administrator exists that nobody invited.
    expect(await harness.prisma.user.count({ where: { email: testEmail('invitee') } })).toBe(0);
  });

  it('refuses acceptance when the address was registered after the invitation was sent', async () => {
    const token = await invite();
    await request(harness.server)
      .post(REGISTER)
      .send(registrationBody({ email: testEmail('invitee') }));

    const response = await request(harness.server)
      .post(ACCEPT)
      .send({ token, password: NEW_PASSWORD });

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('email_taken');
    // The existing account is not promoted to administrator.
    const user = await harness.prisma.user.findUniqueOrThrow({
      where: { email: testEmail('invitee') },
      include: { role: true },
    });
    expect(user.role.code).toBe('doctor');
  });

  it('answers 409, not 500, when the address is registered inside the window', async () => {
    const token = await invite();
    await request(harness.server)
      .post(REGISTER)
      .send(registrationBody({ email: testEmail('invitee') }));
    // The pre-check is told the address is free, so the insert meets the
    // unique index — the error the 7.10 adapter reports by index name.
    vi.spyOn(harness.app.get(IdentityRepository), 'findByEmail').mockResolvedValue(null);

    const response = await request(harness.server)
      .post(ACCEPT)
      .send({ token, password: NEW_PASSWORD });

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('email_taken');
    expect(await harness.prisma.user.count({ where: { email: testEmail('invitee') } })).toBe(1);
  });

  it('two simultaneous activations activate the account exactly once', async () => {
    // A genuine race, not a staged one: there is no awaited call between
    // the code check and the claim to step into. Both requests usually
    // pass the read; the conditional claim is what lets only one write.
    // Whichever way the loser is refused, the outcome below must hold.
    const token = await invite();
    const accepted = await request(harness.server)
      .post(ACCEPT)
      .send({ token, password: NEW_PASSWORD });
    const code = currentCode(dataOf<AcceptPayload>(accepted).secret);

    const responses = await Promise.all([
      request(harness.server).post(ACTIVATE).send({ token, code }),
      request(harness.server).post(ACTIVATE).send({ token, code }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([200, 422]);
    const user = await harness.prisma.user.findUniqueOrThrow({
      where: { email: testEmail('invitee') },
    });
    expect(user.status).toBe('ACTIVE');
    // One activation, so one record of it.
    expect(
      await harness.prisma.userActivityLog.count({
        where: { userId: user.id, summary: 'Account activated with two-factor authentication' },
      }),
    ).toBe(1);
  });

  it('refuses activation when the enrolment has no secret', async () => {
    const token = await invite();
    const accepted = await request(harness.server)
      .post(ACCEPT)
      .send({ token, password: NEW_PASSWORD });
    const secret = dataOf<AcceptPayload>(accepted).secret;
    await harness.prisma.userCredential.updateMany({
      where: { user: { email: testEmail('invitee') } },
      data: { totpSecretEnc: null },
    });

    const response = await request(harness.server)
      .post(ACTIVATE)
      .send({ token, code: currentCode(secret) });

    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('token_invalid');
    expect(
      (await harness.prisma.user.findUniqueOrThrow({ where: { email: testEmail('invitee') } }))
        .status,
    ).toBe('INACTIVE');
  });

  it('refuses activation when the stored secret no longer decrypts', async () => {
    const token = await invite();
    const accepted = await request(harness.server)
      .post(ACCEPT)
      .send({ token, password: NEW_PASSWORD });
    const secret = dataOf<AcceptPayload>(accepted).secret;
    // Ciphertext that does not authenticate under DATA_ENCRYPTION_KEY: a
    // corrupt row, or one written under a different key.
    await harness.prisma.userCredential.updateMany({
      where: { user: { email: testEmail('invitee') } },
      data: { totpSecretEnc: Buffer.from('not-a-valid-envelope-at-all-000000000000') },
    });

    const response = await request(harness.server)
      .post(ACTIVATE)
      .send({ token, code: currentCode(secret) });

    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('token_invalid');
    expect(
      (await harness.prisma.user.findUniqueOrThrow({ where: { email: testEmail('invitee') } }))
        .status,
    ).toBe('INACTIVE');
  });

  it('answers 503 when the roles were never seeded', async () => {
    const { email: adminEmail } = await seedAdmin('boss');
    const token = await adminToken(adminEmail);
    vi.spyOn(harness.app.get(IdentityRepository), 'findRoleByCode').mockResolvedValue(null);

    const response = await inviteFrom(token);

    expect(response.status).toBe(503);
    expect(errorBody(response).code).toBe('service_unavailable');
    expect(
      await harness.prisma.adminInvitation.count({ where: { email: testEmail('invitee') } }),
    ).toBe(0);
  });
});
