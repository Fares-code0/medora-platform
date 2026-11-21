import { Secret, TOTP } from 'otpauth';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Prisma } from '../src/generated/prisma/client';
import { PasswordService } from '../src/modules/auth/services/password.service';
import { EnvelopeService } from '../src/shared/crypto/envelope.service';
import {
  DEFAULT_DEMO_ADMIN_TOTP_SECRET,
  DEFAULT_DEMO_PASSWORD,
  DEMO_ACCOUNTS,
  type DemoAccountSeed,
  type DemoAccountServices,
  type DemoCredentialSettings,
  demoCredentialSettings,
  demoCredentialsPermitted,
  provisionDemoAccounts,
} from '../prisma/seed/demo-accounts';
import { ROLES } from '../prisma/seed/permissions';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  testEmail,
} from './support/auth-app';
import { createTestDoctor, destroyTestDoctor } from './support/doctor-fixture';
import { createPatientRecords, destroyPatientRecords } from './support/patient-fixture';

/**
 * The local demo accounts (`prisma/seed/demo-accounts.ts`,
 * `docs/LOCAL_DEMO_ACCOUNTS.md`).
 *
 * Two halves. **Provisioning** runs inside transactions that are always
 * rolled back, starting each from the state `seedDemo` alone leaves — demo
 * users with no credential rows — so the cases hold whatever an earlier
 * seed left in this database, and no other suite ever sees them.
 * **Sign-in** provisions *suite-scoped copies* of the accounts — the same
 * roles and profiles, through the same provisioner, at this suite's own
 * addresses — and signs each in through `POST /auth/login`.
 *
 * Why copies and never the documented addresses: the test database is the
 * one other suites assert about. `schema-platform` asserts no demo account
 * holds a credential, `patient-identity` that no seeded record is linked,
 * `authz-repositories` that nobody holds `nurse` — and Vitest runs files
 * in parallel, so committing the real accounts here would fail those
 * suites, which is why the seed provisions them in development only. The
 * same reason keeps `nurse` out of the sign-in half: its sign-in is the
 * same code path as every other role, and the rolled-back half proves the
 * nurse account is provisioned. The documented accounts were signed in
 * against a real development database when this was written (see
 * `docs/LOCAL_DEMO_ACCOUNTS.md`).
 *
 * Depends on `seedDemo` having run (CI's `npm run db:seed` does): the
 * doctors, the administrator and the demo patients are its rows.
 */
let harness: AuthHarness;
let services: DemoAccountServices;
const settings: DemoCredentialSettings = {
  password: DEFAULT_DEMO_PASSWORD,
  adminTotpSecret: DEFAULT_DEMO_ADMIN_TOTP_SECRET,
};
const EMAILS = DEMO_ACCOUNTS.map((account) => account.email);

class Rollback extends Error {}

async function inRolledBackTransaction(
  body: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<void> {
  await expect(
    harness.prisma.$transaction(
      async (tx) => {
        await body(tx);
        throw new Rollback();
      },
      { timeout: 60_000 },
    ),
  ).rejects.toBeInstanceOf(Rollback);
}

/** Back to what `seedDemo` alone writes: the demo users, no credentials. */
async function withoutCredentials(tx: Prisma.TransactionClient): Promise<void> {
  await tx.userCredential.deleteMany({ where: { user: { email: { in: EMAILS } } } });
  await tx.user.updateMany({ where: { email: { in: EMAILS } }, data: { twoFactorEnabled: false } });
}

function currentCode(secret: string): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

beforeAll(async () => {
  harness = await createAuthHarness('demo-accounts');
  services = {
    passwords: harness.app.get(PasswordService),
    envelope: harness.app.get(EnvelopeService),
  };
});

afterAll(async () => {
  await harness.reset();
  await harness.close();
});

describe('where demo credentials may exist', () => {
  it('only in an explicit development environment', () => {
    expect(demoCredentialsPermitted('development')).toBe(true);
    // The test database: other suites assert it holds no demo credential.
    expect(demoCredentialsPermitted('test')).toBe(false);
    expect(demoCredentialsPermitted('staging')).toBe(false);
    expect(demoCredentialsPermitted('production')).toBe(false);
    // `db:seed` reads an unset APP_ENV as development for the clinical
    // data; a known password must not depend on that default.
    expect(demoCredentialsPermitted(undefined)).toBe(false);
    expect(demoCredentialsPermitted('')).toBe(false);
  });

  it.each(['production', 'staging', 'test', undefined])(
    'refuses to provision with APP_ENV=%s, and writes nothing',
    async (appEnv) => {
      await inRolledBackTransaction(async (tx) => {
        await withoutCredentials(tx);

        await expect(provisionDemoAccounts(tx, services, settings, appEnv)).rejects.toThrow(
          /Refusing to provision demo credentials/,
        );
        expect(await tx.userCredential.count({ where: { user: { email: { in: EMAILS } } } })).toBe(
          0,
        );
      });
    },
  );

  it('validates a configured password against the application policy', () => {
    expect(demoCredentialSettings({}).password).toBe(DEFAULT_DEMO_PASSWORD);
    expect(demoCredentialSettings({ DEMO_ACCOUNT_PASSWORD: 'Another1!' }).password).toBe(
      'Another1!',
    );
    expect(() => demoCredentialSettings({ DEMO_ACCOUNT_PASSWORD: 'password' })).toThrow(
      /password policy/,
    );
  });

  it('validates a configured TOTP secret as usable base32', () => {
    expect(demoCredentialSettings({}).adminTotpSecret).toBe(DEFAULT_DEMO_ADMIN_TOTP_SECRET);
    expect(() => demoCredentialSettings({ DEMO_ADMIN_TOTP_SECRET: 'not-base32!' })).toThrow(
      /base32/,
    );
    expect(() => demoCredentialSettings({ DEMO_ADMIN_TOTP_SECRET: 'ABCDEFG' })).toThrow(/base32/);
  });
});

describe('provisionDemoAccounts', () => {
  it('covers every seeded role with at least one account', () => {
    const covered = new Set(DEMO_ACCOUNTS.map((account) => account.roleCode));
    expect([...covered].sort()).toEqual(ROLES.map((role) => role.code).sort());
  });

  it('gives every demo account a usable identity, credential and role profile', async () => {
    await inRolledBackTransaction(async (tx) => {
      await withoutCredentials(tx);

      const reports = await provisionDemoAccounts(tx, services, settings, 'development');

      expect(reports.map((report) => report.email)).toEqual(EMAILS);
      expect(
        reports.every(
          (report) => report.outcome === 'created' || report.outcome === 'credential-added',
        ),
      ).toBe(true);

      for (const seed of DEMO_ACCOUNTS) {
        const user = await tx.user.findUniqueOrThrow({
          where: { email: seed.email },
          include: { role: true, credentials: true, permissions: true, patient: true },
        });

        expect(user.role.code).toBe(seed.roleCode);
        expect(user.status).toBe('ACTIVE');
        expect(user.deletedAt).toBeNull();
        expect(user.emailVerifiedAt).not.toBeNull();
        // The role bundle and nothing else — no per-user grants.
        expect(user.permissions).toHaveLength(0);

        const credential = user.credentials;
        expect(credential).not.toBeNull();
        expect(credential!.passwordHash.startsWith('$argon2id$')).toBe(true);
        expect(credential!.passwordHash).not.toContain(settings.password);
        expect(await services.passwords.verify(credential!.passwordHash, settings.password)).toBe(
          true,
        );
        expect(await services.passwords.verify(credential!.passwordHash, 'Wrong123!')).toBe(false);
        expect(credential!.failedAttempts).toBe(0);
        expect(credential!.lockedUntil).toBeNull();

        switch (seed.profile.kind) {
          case 'doctor':
            expect(await tx.doctor.count({ where: { userId: user.id } })).toBe(1);
            break;
          case 'staff': {
            const staff = await tx.staffMember.findUniqueOrThrow({ where: { email: seed.email } });
            expect(staff.userId).toBe(user.id);
            expect(staff.role).toBe(seed.profile.staffRole);
            break;
          }
          case 'patient':
            expect(user.patient?.mrn).toBe(seed.profile.mrn);
            break;
          case 'none':
            break;
        }
      }
    });
  });

  it("enrols the administrator's second factor with the known secret, and only the administrator's", async () => {
    await inRolledBackTransaction(async (tx) => {
      await withoutCredentials(tx);

      const reports = await provisionDemoAccounts(tx, services, settings, 'development');

      expect(
        reports.filter((report) => report.secondFactorAdded).map((report) => report.email),
      ).toEqual(['admin@medora.health']);
      const admin = await tx.user.findUniqueOrThrow({
        where: { email: 'admin@medora.health' },
        include: { credentials: true },
      });
      expect(admin.twoFactorEnabled).toBe(true);
      expect(services.envelope.decrypt(admin.credentials!.totpSecretEnc!)).toBe(
        settings.adminTotpSecret,
      );
    });
  });

  it('is idempotent: a second run changes nothing', async () => {
    await inRolledBackTransaction(async (tx) => {
      await withoutCredentials(tx);
      await provisionDemoAccounts(tx, services, settings, 'development');

      // Scoped to the demo accounts: under READ COMMITTED a global count
      // would also see whatever a parallel suite committed meanwhile.
      const mine = { user: { email: { in: EMAILS } } };
      const counts = async () => ({
        users: await tx.user.count({ where: { email: { in: EMAILS } } }),
        credentials: await tx.userCredential.count({ where: mine }),
        staff: await tx.staffMember.count({ where: { email: { in: EMAILS } } }),
        linkedPatients: await tx.patient.count({ where: mine }),
        hashes: (
          await tx.userCredential.findMany({
            where: mine,
            select: { passwordHash: true },
            orderBy: { userId: 'asc' },
          })
        ).map((row) => row.passwordHash),
      });
      const before = await counts();

      const second = await provisionDemoAccounts(tx, services, settings, 'development');

      expect(
        second.every((report) => report.outcome === 'unchanged' && !report.secondFactorAdded),
      ).toBe(true);
      expect(await counts()).toEqual(before);
    });
  });

  it('never overwrites a password that already exists', async () => {
    await inRolledBackTransaction(async (tx) => {
      await withoutCredentials(tx);
      const doctor = await tx.user.findUniqueOrThrow({ where: { email: 'doctor@medora.health' } });
      const ownHash = await services.passwords.hash('Changed123!');
      await tx.userCredential.create({ data: { userId: doctor.id, passwordHash: ownHash } });

      const reports = await provisionDemoAccounts(tx, services, settings, 'development');

      expect(reports.find((report) => report.email === 'doctor@medora.health')?.outcome).toBe(
        'unchanged',
      );
      const credential = await tx.userCredential.findUniqueOrThrow({
        where: { userId: doctor.id },
      });
      expect(credential.passwordHash).toBe(ownHash);
    });
  });

  it('never replaces a second factor that already exists', async () => {
    await inRolledBackTransaction(async (tx) => {
      await withoutCredentials(tx);
      const admin = await tx.user.findUniqueOrThrow({ where: { email: 'admin@medora.health' } });
      const own = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
      await tx.userCredential.create({
        data: {
          userId: admin.id,
          passwordHash: await services.passwords.hash('Changed123!'),
          totpSecretEnc: services.envelope.encrypt(own),
        },
      });

      const reports = await provisionDemoAccounts(tx, services, settings, 'development');

      expect(
        reports.find((report) => report.email === 'admin@medora.health')?.secondFactorAdded,
      ).toBe(false);
      const credential = await tx.userCredential.findUniqueOrThrow({ where: { userId: admin.id } });
      expect(services.envelope.decrypt(credential.totpSecretEnc!)).toBe(own);
    });
  });

  it('skips, without repairing, an account whose role or status it does not own', async () => {
    await inRolledBackTransaction(async (tx) => {
      await withoutCredentials(tx);
      await provisionDemoAccounts(tx, services, settings, 'development');

      const doctorRole = await tx.role.findUniqueOrThrow({ where: { code: 'doctor' } });
      await tx.user.update({
        where: { email: 'reception@medora.health' },
        data: { roleId: doctorRole.id },
      });
      await tx.user.update({
        where: { email: 'nurse@medora.health' },
        data: { status: 'SUSPENDED' },
      });
      await tx.userCredential.deleteMany({
        where: { user: { email: { in: ['reception@medora.health', 'nurse@medora.health'] } } },
      });

      const reports = await provisionDemoAccounts(tx, services, settings, 'development');
      const outcome = (email: string) => reports.find((report) => report.email === email)?.outcome;

      expect(outcome('reception@medora.health')).toBe('skipped-role-mismatch');
      expect(outcome('nurse@medora.health')).toBe('skipped-inactive');
      expect(
        await tx.userCredential.count({
          where: { user: { email: { in: ['reception@medora.health', 'nurse@medora.health'] } } },
        }),
      ).toBe(0);
      const nurse = await tx.user.findUniqueOrThrow({ where: { email: 'nurse@medora.health' } });
      expect(nurse.status).toBe('SUSPENDED');
    });
  });
});

describe('provisioned accounts sign in through the real API', () => {
  const LOGIN = '/api/v1/auth/login';
  const OTP_VERIFY = '/api/v1/auth/otp/verify';
  const REFRESH = '/api/v1/auth/refresh';
  const TAG = 'demoacct';

  interface SessionBody {
    user: { email: string; role: string; permissions: string[] };
    accessToken: string;
  }

  /** A route each role is admitted to, and one it is refused (`authz-route-matrix.snapshot.txt`). */
  const ROUTES: Record<string, { readonly allowed: string; readonly denied: string }> = {
    admin: { allowed: '/api/v1/admin/users', denied: '/api/v1/ai/model' },
    doctor: { allowed: '/api/v1/ai/model', denied: '/api/v1/admin/users' },
    reception: { allowed: '/api/v1/administration/queue', denied: '/api/v1/lab-orders' },
    laboratory: { allowed: '/api/v1/lab-tests/catalogue', denied: '/api/v1/appointments' },
    pharmacy: { allowed: '/api/v1/patients', denied: '/api/v1/lab-orders' },
    patient: { allowed: '/api/v1/me/profile', denied: '/api/v1/patients' },
  };

  let accounts: DemoAccountSeed[] = [];

  /** The documented account for `role`, moved to an address this suite owns. */
  function copyOf(
    roleCode: string,
    email: string,
    profile?: DemoAccountSeed['profile'],
  ): DemoAccountSeed {
    const seed = DEMO_ACCOUNTS.find((account) => account.roleCode === roleCode)!;
    return {
      ...seed,
      email,
      publicId: `usr_t_${TAG}_${roleCode}`.slice(0, 40),
      ...(profile === undefined ? {} : { profile }),
    };
  }

  beforeAll(async () => {
    // The doctor profile is `seedDemo`'s to create, so the fixture creates
    // it here, verified the way `seedDemo` leaves its doctors.
    const doctor = await createTestDoctor(harness.prisma, TAG);
    await harness.prisma.user.update({
      where: { id: doctor.userId },
      data: { emailVerifiedAt: new Date() },
    });
    const [record] = await createPatientRecords(harness.prisma, 'DA', 1);
    const patient = await harness.prisma.patient.findUniqueOrThrow({ where: { id: record!.id } });

    accounts = [
      copyOf('admin', testEmail('admin')),
      copyOf('doctor', doctor.contactEmail),
      copyOf('reception', testEmail('reception')),
      copyOf('laboratory', testEmail('lab')),
      copyOf('pharmacy', testEmail('pharmacy')),
      copyOf('patient', testEmail('patient'), { kind: 'patient', mrn: patient.mrn }),
    ];

    const reports = await provisionDemoAccounts(
      harness.prisma,
      services,
      settings,
      'development',
      accounts,
    );
    expect(reports.map((report) => report.outcome)).toEqual([
      'created',
      'credential-added',
      'created',
      'created',
      'created',
      'created',
    ]);
  });

  afterAll(async () => {
    await harness.prisma.staffMember.deleteMany({
      where: { email: { in: accounts.map((account) => account.email) } },
    });
    await destroyPatientRecords(harness.prisma, 'DA');
    await destroyTestDoctor(harness.prisma, TAG);
  });

  async function signIn(email: string): Promise<request.Response> {
    const response = await request(harness.server)
      .post(LOGIN)
      .send({ email, password: settings.password, rememberMe: false });
    const body = dataOf<{ requiresOtp?: boolean; otpToken?: string }>(response);
    if (body.requiresOtp !== true) return response;

    return request(harness.server)
      .post(OTP_VERIFY)
      .send({ otpToken: body.otpToken, code: currentCode(settings.adminTotpSecret) });
  }

  it.each(Object.keys(ROUTES))('%s: login, role bundle, RBAC, refresh', async (roleCode) => {
    const email = accounts.find((account) => account.roleCode === roleCode)!.email;
    const response = await signIn(email);
    expect(response.status).toBe(200);

    const session = dataOf<SessionBody>(response);
    expect(session.user.email).toBe(email);
    expect(session.user.role).toBe(roleCode);
    const bundle = ROLES.find((role) => role.code === roleCode)!.permissions;
    expect([...session.user.permissions].sort()).toEqual([...bundle].sort());

    const routes = ROUTES[roleCode]!;
    const bearer = `Bearer ${session.accessToken}`;
    expect(
      (await request(harness.server).get(routes.allowed).set('Authorization', bearer)).status,
    ).toBe(200);
    expect(
      (await request(harness.server).get(routes.denied).set('Authorization', bearer)).status,
    ).toBe(403);

    const cookie = response.headers['set-cookie'] as unknown as string[];
    expect(cookie.some((value) => value.startsWith('medora_rt=') && /HttpOnly/i.test(value))).toBe(
      true,
    );
    const refreshed = await request(harness.server).post(REFRESH).set('Cookie', cookie);
    expect(refreshed.status).toBe(200);
    expect(dataOf<SessionBody>(refreshed).user.role).toBe(roleCode);
  });

  it('refuses a wrong password', async () => {
    const response = await request(harness.server)
      .post(LOGIN)
      .send({ email: testEmail('reception'), password: 'Wrong123!', rememberMe: false });

    expect(response.status).toBe(401);
    expect(errorBody(response).code).toBe('invalid_credentials');
  });

  it('still makes the administrator prove a second factor', async () => {
    const response = await request(harness.server)
      .post(LOGIN)
      .send({ email: testEmail('admin'), password: settings.password, rememberMe: false });

    expect(response.status).toBe(200);
    expect(dataOf<{ requiresOtp: boolean }>(response).requiresOtp).toBe(true);
    expect(response.headers['set-cookie']).toBeUndefined();
  });
});
