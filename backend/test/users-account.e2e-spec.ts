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
 * `/me/account`, `/me/activity` and `/admin/users`
 * (RM M8.1, M8.2, M8.6 — API §2.1, §2.2, §2.8, §2.10).
 *
 * The milestone's verify steps, executable:
 *
 *  · M8.2 "deactivated user's login → 401; row not deleted". The status
 *    code is **403 `account_inactive`** and not 401: ADR-035 §6 landed
 *    after the roadmap line was written and made a non-ACTIVE account a
 *    distinct, coded refusal rather than a generic credential failure.
 *    The property the line was after — the account cannot sign in, and
 *    the row survives — is asserted here, at the status code the
 *    platform actually answers.
 *  · M8.6 "a password change produces an activity row of kind
 *    `password`" — driven through `POST /me/password`, not by writing a
 *    row.
 *
 * The admin cases are the ones worth reading. Every refusal below is a
 * way the Users panel could otherwise lock the platform out of its own
 * administration, and each is proved to leave the row unchanged rather
 * than merely to return a 4xx.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const ACCOUNT = '/api/v1/me/account';
const ACTIVITY = '/api/v1/me/activity';
const PASSWORD_ROUTE = '/api/v1/me/password';
const ADMIN_USERS = '/api/v1/admin/users';
const PASSWORD = 'Medora123!';

interface SessionPayload {
  user: { id: string; name: string; email: string; role: string; permissions: string[] };
  accessToken: string;
  expiresIn: number;
}

interface AccountView {
  email: string;
  username: string | null;
  phone: string;
  passwordUpdatedAt: string;
  twoFactorEnabled: boolean;
  emailVerified: boolean;
}

interface ActivityEntryView {
  id: string;
  at: string;
  kind: string;
  summary: string;
  detail: string | null;
}

interface PlatformUserView {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  lastActiveAt: string | null;
  createdAt: string;
}

interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

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

  return dataOf<SessionPayload>(response).accessToken;
}

async function seedAndSignIn(local: string): Promise<{ email: string; token: string }> {
  const email = await seedAccount(local);
  return { email, token: await tokenFor(email) };
}

/**
 * A working administrator token.
 *
 * Built the only way the platform allows one to exist (ADR-035 §7): the
 * account enrols a second factor while it is still doctor-shaped, is
 * then given the admin role, and signs in through the step-up its factor
 * now requires. `auth-admin-invitation.e2e-spec.ts` does the same, and
 * the awkwardness is the point — there is no endpoint that creates the
 * first administrator.
 */
async function adminToken(local: string): Promise<{ email: string; token: string }> {
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
  const otpToken = dataOf<{ otpToken: string }>(login).otpToken;

  const verified = await request(harness.server)
    .post('/api/v1/auth/otp/verify')
    .send({ otpToken, code: currentCode(secret) });

  return { email, token: dataOf<SessionPayload>(verified).accessToken };
}

async function publicIdOf(email: string): Promise<string> {
  const user = await harness.prisma.user.findUniqueOrThrow({
    where: { email },
    select: { publicId: true },
  });
  return user.publicId;
}

beforeAll(async () => {
  harness = await createAuthHarness('users-account');
}, 60_000);

afterAll(async () => {
  // Reset *before* closing, not only in `beforeEach`. This suite
  // promotes fixture accounts to `admin`, and a file that ends without
  // cleaning up leaves them in a database other suites make assertions
  // about — `schema-platform.e2e-spec.ts` counts administrators.
  await harness.reset();
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
});

describe('GET /me/account (§2.1)', () => {
  it('returns the account document without a single credential field', async () => {
    const session = await seedAndSignIn('account');

    const response = await request(harness.server)
      .get(ACCOUNT)
      .set('Authorization', `Bearer ${session.token}`);

    expect(response.status).toBe(200);

    const account = dataOf<AccountView>(response);
    expect(Object.keys(account).sort()).toEqual([
      'email',
      'emailVerified',
      'passwordUpdatedAt',
      'phone',
      'twoFactorEnabled',
      'username',
    ]);
    expect(account.email).toBe(session.email);
    expect(account.emailVerified).toBe(true);
    expect(account.twoFactorEnabled).toBe(false);
    // The frontend mock carries a `mockPassword`; the real API must not.
    const raw = JSON.stringify(response.body);
    expect(raw).not.toContain('mockPassword');
    expect(raw).not.toContain('passwordHash');
    expect(raw).not.toContain('totpSecret');
    expect(raw).not.toContain('failedAttempts');
  });

  it('refuses an unauthenticated caller', async () => {
    const response = await request(harness.server).get(ACCOUNT);
    expect(response.status).toBe(401);
  });
});

describe('PATCH /me/account (§2.2)', () => {
  it('updates the username lower-cased and the phone', async () => {
    const session = await seedAndSignIn('patch');

    const response = await request(harness.server)
      .patch(ACCOUNT)
      .set('Authorization', `Bearer ${session.token}`)
      .send({ username: 'Amelia.Chen', phone: '+20 100 999 0000' });

    expect(response.status).toBe(200);

    const account = dataOf<AccountView>(response);
    // `users.username` is a plain varchar with a case-sensitive unique
    // index, unlike the citext email — normalising is what stops
    // `Amelia` and `amelia` being two accounts.
    expect(account.username).toBe('amelia.chen');
    expect(account.phone).toBe('+20 100 999 0000');
  });

  it('rejects a username outside the contract character class', async () => {
    const session = await seedAndSignIn('badname');

    const response = await request(harness.server)
      .patch(ACCOUNT)
      .set('Authorization', `Bearer ${session.token}`)
      .send({ username: 'amelia chen!' });

    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors?.['username']).toBeDefined();
  });

  it('answers 409 when the username is already claimed', async () => {
    const first = await seedAndSignIn('claimer');
    const second = await seedAndSignIn('latecomer');

    await request(harness.server)
      .patch(ACCOUNT)
      .set('Authorization', `Bearer ${first.token}`)
      .send({ username: 'shared.handle' });

    const response = await request(harness.server)
      .patch(ACCOUNT)
      .set('Authorization', `Bearer ${second.token}`)
      .send({ username: 'shared.handle' });

    expect(response.status).toBe(409);
    expect(errorBody(response).detail).toBeDefined();
  });

  it('lets a user re-save their own unchanged username', async () => {
    const session = await seedAndSignIn('idempotent');

    await request(harness.server)
      .patch(ACCOUNT)
      .set('Authorization', `Bearer ${session.token}`)
      .send({ username: 'steady.hand' });

    // Pressing Save twice is not an error, and must not 409 against the
    // caller's own row.
    const again = await request(harness.server)
      .patch(ACCOUNT)
      .set('Authorization', `Bearer ${session.token}`)
      .send({ username: 'steady.hand' });

    expect(again.status).toBe(200);
  });

  it('ignores an email in the body rather than moving the sign-in address', async () => {
    const session = await seedAndSignIn('nomove');

    const response = await request(harness.server)
      .patch(ACCOUNT)
      .set('Authorization', `Bearer ${session.token}`)
      .send({ email: 'attacker@elsewhere.test', phone: '+20 100 111 2222' });

    expect(response.status).toBe(200);
    // Unknown keys are stripped, not rejected — but the address must not
    // have moved, or a borrowed session becomes an account takeover
    // through the password-reset flow.
    expect(dataOf<AccountView>(response).email).toBe(session.email);
  });

  it('writes a profile activity entry naming the field, never the number', async () => {
    const session = await seedAndSignIn('feed');

    await request(harness.server)
      .patch(ACCOUNT)
      .set('Authorization', `Bearer ${session.token}`)
      .send({ phone: '+20 100 765 4321' });

    // Filtered to `profile`. Signing in writes a `login` row since
    // M29.1, so the feed's length is no longer this test's to assert —
    // what it is about is the profile entry and what it says.
    const response = await request(harness.server)
      .get(`${ACTIVITY}?kind=profile`)
      .set('Authorization', `Bearer ${session.token}`);

    const page = dataOf<Page<ActivityEntryView>>(response);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.kind).toBe('profile');
    expect(page.items[0]?.summary).toContain('Phone');
    // The value is contact data; the feed names what changed, not what to.
    expect(JSON.stringify(page.items[0])).not.toContain('765 4321');
  });

  it('writes no activity entry for a save that changed nothing', async () => {
    const session = await seedAndSignIn('nochange');
    const before = await request(harness.server)
      .get(ACCOUNT)
      .set('Authorization', `Bearer ${session.token}`);

    await request(harness.server)
      .patch(ACCOUNT)
      .set('Authorization', `Bearer ${session.token}`)
      .send({ phone: dataOf<AccountView>(before).phone });

    // `kind=profile`: the claim is that a no-op save writes no *profile*
    // entry, not that the account has no history — it signed in to get
    // here, and since M29.1 that is a row.
    const response = await request(harness.server)
      .get(`${ACTIVITY}?kind=profile`)
      .set('Authorization', `Bearer ${session.token}`);

    expect(dataOf<Page<ActivityEntryView>>(response).totalItems).toBe(0);
  });
});

describe('GET /me/activity (§2.8, M8.6)', () => {
  it('records a password change as kind `password`', async () => {
    const session = await seedAndSignIn('pwfeed');

    const changed = await request(harness.server)
      .post(PASSWORD_ROUTE)
      .set('Authorization', `Bearer ${session.token}`)
      .send({ currentPassword: PASSWORD, newPassword: 'Medora456!' });

    expect(changed.status).toBe(204);

    // Changing a password revokes every session, so a fresh token is
    // needed to read the feed — which is itself the M6.5 behaviour.
    const response = await request(harness.server)
      .get(ACTIVITY)
      .set('Authorization', `Bearer ${await tokenFor2(session.email, 'Medora456!')}`);

    const page = dataOf<Page<ActivityEntryView>>(response);
    expect(page.items.some((entry) => entry.kind === 'password')).toBe(true);
  });

  it('filters by kind and pages', async () => {
    const session = await seedAndSignIn('filter');

    await request(harness.server)
      .patch(ACCOUNT)
      .set('Authorization', `Bearer ${session.token}`)
      .send({ username: 'filter.one' });
    await request(harness.server)
      .post('/api/v1/me/devices')
      .set('Authorization', `Bearer ${session.token}`)
      .send({ name: 'Laptop', platform: 'mac' });

    // Three, not two: the profile edit, the trusted device, and the
    // sign-in that M29.1 started recording. Stated as the three kinds
    // rather than as a bare count, so the next writer hook changes this
    // assertion's *list* instead of silently making its number wrong.
    const all = await request(harness.server)
      .get(ACTIVITY)
      .set('Authorization', `Bearer ${session.token}`);
    const everything = dataOf<Page<ActivityEntryView>>(all);
    expect(everything.totalItems).toBe(3);
    expect([...everything.items.map((entry) => entry.kind)].sort()).toEqual([
      'login',
      'profile',
      'security',
    ]);

    const filtered = await request(harness.server)
      .get(`${ACTIVITY}?kind=security`)
      .set('Authorization', `Bearer ${session.token}`);

    const page = dataOf<Page<ActivityEntryView>>(filtered);
    expect(page.totalItems).toBe(1);
    expect(page.items[0]?.kind).toBe('security');
  });

  it('rejects an unknown kind', async () => {
    const session = await seedAndSignIn('badkind');

    const response = await request(harness.server)
      .get(`${ACTIVITY}?kind=telepathy`)
      .set('Authorization', `Bearer ${session.token}`);

    expect(response.status).toBe(422);
  });

  it("shows only the caller's own entries", async () => {
    const noisy = await seedAndSignIn('noisyfeed');
    await request(harness.server)
      .patch(ACCOUNT)
      .set('Authorization', `Bearer ${noisy.token}`)
      .send({ username: 'noisy.one' });

    const quiet = await seedAndSignIn('quietfeed');

    const response = await request(harness.server)
      .get(ACTIVITY)
      .set('Authorization', `Bearer ${quiet.token}`);

    // The quiet account has exactly its own sign-in (M29.1) and nothing
    // else — in particular, none of the noisy account's profile edit.
    // Asserting "zero rows" would have stopped being a test of scoping
    // the moment any account got a row of its own for existing.
    const page = dataOf<Page<ActivityEntryView>>(response);
    expect(page.items.map((entry) => entry.kind)).toEqual(['login']);
    expect(JSON.stringify(page)).not.toContain('noisy.one');
  });
});

describe('GET /admin/users (§2.10)', () => {
  it('refuses a doctor, who holds no roles.manage', async () => {
    const session = await seedAndSignIn('notadmin');

    const response = await request(harness.server)
      .get(ADMIN_USERS)
      .set('Authorization', `Bearer ${session.token}`);

    expect(response.status).toBe(403);
  });

  it('lists accounts in the PlatformUser shape', async () => {
    const admin = await adminToken('lister');
    const subject = await seedAccount('listed');

    const response = await request(harness.server)
      .get(`${ADMIN_USERS}?q=${encodeURIComponent(subject)}`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(response.status).toBe(200);

    const page = dataOf<Page<PlatformUserView>>(response);
    expect(page.totalItems).toBe(1);
    expect(Object.keys(page.items[0] ?? {}).sort()).toEqual([
      'active',
      'createdAt',
      'email',
      'id',
      'lastActiveAt',
      'name',
      'role',
    ]);
    expect(page.items[0]?.id).toMatch(/^usr_/);
    expect(page.items[0]?.role).toBe('doctor');
    expect(page.items[0]?.active).toBe(true);
  });

  it('filters by role and by active', async () => {
    const admin = await adminToken('filterer');
    const subject = await seedAccount('suspendee');
    await harness.prisma.user.update({ where: { email: subject }, data: { status: 'INACTIVE' } });

    const inactive = await request(harness.server)
      .get(`${ADMIN_USERS}?role=doctor&active=false&pageSize=100`)
      .set('Authorization', `Bearer ${admin.token}`);

    const emails = dataOf<Page<PlatformUserView>>(inactive).items.map((row) => row.email);
    expect(emails).toContain(subject);

    const active = await request(harness.server)
      .get(`${ADMIN_USERS}?role=doctor&active=true&pageSize=100`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(dataOf<Page<PlatformUserView>>(active).items.map((row) => row.email)).not.toContain(
      subject,
    );
  });

  it('never carries a credential or a clinical field', async () => {
    const admin = await adminToken('nocreds');
    await seedAccount('scanned');

    const response = await request(harness.server)
      .get(`${ADMIN_USERS}?pageSize=100`)
      .set('Authorization', `Bearer ${admin.token}`);

    const raw = JSON.stringify(response.body);
    for (const forbidden of ['passwordHash', 'totpSecret', 'licenseNumber', 'dateOfBirth']) {
      expect(raw).not.toContain(forbidden);
    }
  });
});

describe('PATCH /admin/users/{id} (§2.10)', () => {
  it('deactivates softly: login refused, row intact, sessions ended', async () => {
    const admin = await adminToken('deactivator');
    const victim = await seedAndSignIn('deactivated');

    const response = await request(harness.server)
      .patch(`${ADMIN_USERS}/${await publicIdOf(victim.email)}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ active: false });

    expect(response.status).toBe(200);
    expect(dataOf<PlatformUserView>(response).active).toBe(false);

    // The row is still there — API §2.10: "never delete users with
    // clinical trails".
    const row = await harness.prisma.user.findUnique({ where: { email: victim.email } });
    expect(row).not.toBeNull();
    expect(row?.deletedAt).toBeNull();
    expect(row?.status).toBe('INACTIVE');

    // Sign-in is refused, with ADR-035 §6's coded answer.
    const login = await request(harness.server)
      .post(LOGIN)
      .send({ email: victim.email, password: PASSWORD, rememberMe: false });

    expect(login.status).toBe(403);
    expect(errorBody(login).code).toBe('account_inactive');

    // And the session that was already open is gone.
    const live = await harness.prisma.session.count({
      where: { user: { email: victim.email }, revokedAt: null },
    });
    expect(live).toBe(0);
  });

  it('reactivates, and the account can sign in again', async () => {
    const admin = await adminToken('reactivator');
    const victim = await seedAccount('revived');
    const publicId = await publicIdOf(victim);

    await request(harness.server)
      .patch(`${ADMIN_USERS}/${publicId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ active: false });

    await request(harness.server)
      .patch(`${ADMIN_USERS}/${publicId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ active: true });

    const login = await request(harness.server)
      .post(LOGIN)
      .send({ email: victim, password: PASSWORD, rememberMe: false });

    expect(login.status).toBe(200);
  });

  it('changes a role and tells the subject in their own feed', async () => {
    const admin = await adminToken('promoter');
    const subject = await seedAndSignIn('promoted');

    const response = await request(harness.server)
      .patch(`${ADMIN_USERS}/${await publicIdOf(subject.email)}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ role: 'nurse' });

    expect(response.status).toBe(200);
    expect(dataOf<PlatformUserView>(response).role).toBe('nurse');

    // ADR-046: the subject's token was minted for the old role and is now
    // refused; their next token (here a fresh sign-in) carries `nurse`.
    const stale = await request(harness.server)
      .get(ACTIVITY)
      .set('Authorization', `Bearer ${subject.token}`);
    expect(stale.status).toBe(401);

    const feed = await request(harness.server)
      .get(ACTIVITY)
      .set('Authorization', `Bearer ${await tokenFor(subject.email)}`);

    // Newest first: the sign-in that minted the new token, then the role
    // change it follows.
    const entries = dataOf<Page<ActivityEntryView>>(feed).items;
    expect(entries[0]?.kind).toBe('login');
    expect(entries[1]?.kind).toBe('security');
    expect(entries[1]?.summary).toContain('role');
  });

  it('refuses to promote anyone to admin through this route', async () => {
    const admin = await adminToken('escalator');
    const subject = await seedAccount('wouldbeadmin');

    const response = await request(harness.server)
      .patch(`${ADMIN_USERS}/${await publicIdOf(subject)}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ role: 'admin' });

    // ADR-035 §7: an admin account with no enrolled factor can never
    // sign in, so this route would create a bricked administrator. The
    // invitation flow enrols the factor as part of the flow.
    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('two_factor_required');

    const row = await harness.prisma.user.findFirstOrThrow({
      where: { email: subject },
      select: { role: { select: { code: true } } },
    });
    expect(row.role.code).toBe('doctor');
  });

  it('refuses an administrator changing their own role or status', async () => {
    const admin = await adminToken('selfedit');
    const publicId = await publicIdOf(admin.email);

    for (const body of [{ role: 'doctor' }, { active: false }]) {
      const response = await request(harness.server)
        .patch(`${ADMIN_USERS}/${publicId}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send(body);

      expect(response.status).toBe(403);
    }

    const row = await harness.prisma.user.findFirstOrThrow({
      where: { email: admin.email },
      select: { status: true, role: { select: { code: true } } },
    });
    expect(row.role.code).toBe('admin');
    expect(row.status).toBe('ACTIVE');
  });

  it('rejects an unknown role code with 422', async () => {
    const admin = await adminToken('badrole');
    const subject = await seedAccount('rolesubject');

    const response = await request(harness.server)
      .patch(`${ADMIN_USERS}/${await publicIdOf(subject)}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ role: 'wizard' });

    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors?.['role']).toBeDefined();
  });

  it('rejects an empty patch', async () => {
    const admin = await adminToken('emptypatch');
    const subject = await seedAccount('untouched');

    const response = await request(harness.server)
      .patch(`${ADMIN_USERS}/${await publicIdOf(subject)}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({});

    expect(response.status).toBe(422);
  });

  it('answers 404 for an unknown user id', async () => {
    const admin = await adminToken('ghost');

    const response = await request(harness.server)
      .patch(`${ADMIN_USERS}/usr_does_not_exist`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ active: false });

    expect(response.status).toBe(404);
  });

  it('never accepts a password from an administrator', async () => {
    const admin = await adminToken('nopassword');
    const subject = await seedAccount('victimpw');

    await request(harness.server)
      .patch(`${ADMIN_USERS}/${await publicIdOf(subject)}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ password: 'Attacker123!', active: true });

    // Unknown keys are stripped. The subject's own password still works.
    const login = await request(harness.server)
      .post(LOGIN)
      .send({ email: subject, password: PASSWORD, rememberMe: false });

    expect(login.status).toBe(200);
  });
});

/** A token from a sign-in with a password other than the fixture's. */
async function tokenFor2(email: string, password: string): Promise<string> {
  const response = await request(harness.server)
    .post(LOGIN)
    .send({ email, password, rememberMe: false });

  return dataOf<SessionPayload>(response).accessToken;
}
