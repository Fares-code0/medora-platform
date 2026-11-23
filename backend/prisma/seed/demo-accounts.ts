import { Secret } from 'otpauth';

import type { Prisma } from '../../src/generated/prisma/client';
import { passwordPolicyErrors } from '../../src/modules/auth/dto/password.schema';
import type { PasswordService } from '../../src/modules/auth/services/password.service';
import type { EnvelopeService } from '../../src/shared/crypto/envelope.service';

/**
 * Sign-in credentials for the local demo accounts — **development
 * only**. The account list, the passwords and how to change them are
 * documented in `backend/docs/LOCAL_DEMO_ACCOUNTS.md`, which must be kept
 * in step with `DEMO_ACCOUNTS` below.
 *
 * ## Why this exists
 *
 * `seedDemo` creates the demo doctors and the administrator with no
 * `user_credentials` row, deliberately (its own comment). Every read path
 * treats a missing credential as "no password set", so those accounts
 * could never sign in: `POST /auth/login` answered 401 for all of them,
 * and nothing in the stack could make them usable — `admin:bootstrap`
 * refuses because an administrator exists, and password reset could not
 * create the row it updates.
 *
 * ## The boundaries, and where each is enforced
 *
 * - **Never production, never staging, never the test database.**
 *   `seedDemo` also runs on staging; this does not. A known password in a
 *   staging database is a known password wherever that database is
 *   restored. The test database is refused for a different reason: the
 *   e2e suite asserts what the seed leaves there — no demo credential
 *   (`schema-platform`), no `nurse` account (`authz-repositories`), no
 *   seeded record linked to an account (`patient-identity`) — so
 *   provisioning there would break the suite for whoever seeded with
 *   `APP_ENV=test`. `APP_ENV` must be *explicitly* `development`; unlike
 *   the demo clinical data, an unset `APP_ENV` does not count.
 *   `provisionDemoAccounts` refuses on its own as well as at its call
 *   site, as `seedDemo` does. Its spec runs it inside rolled-back
 *   transactions, and against suite-scoped copies of the accounts.
 * - **Never overwrites a password.** A credential row that exists is left
 *   exactly as it is, however it got there — a password changed through
 *   the app survives every later seed. The insert is
 *   `ON CONFLICT DO NOTHING`, so two seeds racing cannot both write one.
 * - **Never changes an account it did not create.** An existing account
 *   with a different role, a non-ACTIVE status or a soft delete is
 *   reported and skipped, not repaired: re-activating or re-roling a user
 *   is an administrator's decision, not a seed's.
 * - **Hashed by the application's own `PasswordService`** (Argon2id,
 *   MG §11.1). No plaintext is stored and none is logged; the summary
 *   counts accounts, it never prints a password.
 * - **Grants nothing beyond the role.** Permissions come from the seeded
 *   role bundles (`permissions.ts`) and nothing else. `nurse` and
 *   `patient` hold empty bundles by design, and their accounts get no
 *   per-user grants to make up for it.
 *
 * ## The administrator's second factor
 *
 * ADR-035 §7: an administrator signs in with a second factor or not at
 * all, and `LoginService` refuses an admin without one
 * (`two_factor_required`). A password alone would therefore still leave
 * the seeded administrator unable to sign in. Rather than weaken that
 * rule, the demo administrator is enrolled with a **known TOTP secret**,
 * envelope-encrypted with the deployment's `DATA_ENCRYPTION_KEY` exactly
 * as `TwoFactorService.setup` stores one. `npm run demo:totp` prints the
 * current code; the secret can also be added to any authenticator app. A
 * secret already on the account is never replaced.
 */

/**
 * The local demo password, unless `DEMO_ACCOUNT_PASSWORD` says otherwise.
 *
 * The same value the frontend's mock backend has always used
 * (`frontend/src/features/auth/mock/users.ts`), so one documented pair —
 * `doctor@medora.health` / this — works in mock mode and against the real
 * API alike. **Local only. Never a production credential.**
 */
export const DEFAULT_DEMO_PASSWORD = 'Medora123!';

/**
 * The demo administrator's TOTP secret (base32), unless
 * `DEMO_ADMIN_TOTP_SECRET` says otherwise. 32 characters, 160 bits — the
 * size `TotpService.enrol` generates. **Local only.**
 */
export const DEFAULT_DEMO_ADMIN_TOTP_SECRET = 'MEDORALOCALDEMOADMINTOTPSECRET23';

/** The role-specific record an account needs to be usable for its role. */
export type DemoProfile =
  /** A `doctors` row — created by `seedDemo`, verified here. */
  | { readonly kind: 'doctor' }
  /** A `staff_members` row, linked to the account. */
  | {
      readonly kind: 'staff';
      readonly staffRole: 'NURSE' | 'RECEPTIONIST' | 'LABORATORY' | 'PHARMACY';
      readonly title: string;
    }
  /** The demo patient record (by MRN) this account owns (ADR-030 §1). */
  | { readonly kind: 'patient'; readonly mrn: string }
  /** No profile: the administrator. */
  | { readonly kind: 'none' };

export interface DemoAccountSeed {
  readonly email: string;
  /** A `roles.code` from `permissions.ts` — never invented here. */
  readonly roleCode: string;
  readonly displayName: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly publicId: string;
  readonly profile: DemoProfile;
}

/**
 * One account per role that signs in, plus the four further demo doctors
 * `seedDemo` creates (so every seeded user has a usable credential).
 *
 * The administrator and the doctors are `seedDemo`'s accounts, reused
 * here by email; the staff and patient accounts are created here. The
 * `publicId`s of the reused ones match what `seedDemo` writes.
 */
export const DEMO_ACCOUNTS: readonly DemoAccountSeed[] = [
  {
    email: 'admin@medora.health',
    roleCode: 'admin',
    displayName: 'Marcus Reed',
    firstName: 'Marcus',
    lastName: 'Reed',
    publicId: 'usr_demo_admin',
    profile: { kind: 'none' },
  },
  {
    email: 'doctor@medora.health',
    roleCode: 'doctor',
    displayName: 'Dr. Amelia Chen',
    firstName: 'Amelia',
    lastName: 'Chen',
    publicId: 'usr_demo_1',
    profile: { kind: 'doctor' },
  },
  {
    email: 'omar.khalil@medora.health',
    roleCode: 'doctor',
    displayName: 'Dr. Omar Khalil',
    firstName: 'Omar',
    lastName: 'Khalil',
    publicId: 'usr_demo_2',
    profile: { kind: 'doctor' },
  },
  {
    email: 'salma.ibrahim@medora.health',
    roleCode: 'doctor',
    displayName: 'Dr. Salma Ibrahim',
    firstName: 'Salma',
    lastName: 'Ibrahim',
    publicId: 'usr_demo_3',
    profile: { kind: 'doctor' },
  },
  {
    email: 'youssef.nabil@medora.health',
    roleCode: 'doctor',
    displayName: 'Dr. Youssef Nabil',
    firstName: 'Youssef',
    lastName: 'Nabil',
    publicId: 'usr_demo_4',
    profile: { kind: 'doctor' },
  },
  {
    email: 'amira.hassan@medora.health',
    roleCode: 'doctor',
    displayName: 'Dr. Amira Hassan',
    firstName: 'Amira',
    lastName: 'Hassan',
    publicId: 'usr_demo_5',
    profile: { kind: 'doctor' },
  },
  {
    email: 'reception@medora.health',
    roleCode: 'reception',
    displayName: 'Rana Fathy',
    firstName: 'Rana',
    lastName: 'Fathy',
    publicId: 'usr_demo_reception',
    profile: { kind: 'staff', staffRole: 'RECEPTIONIST', title: 'Front desk coordinator' },
  },
  {
    email: 'lab@medora.health',
    roleCode: 'laboratory',
    displayName: 'Karim Mostafa',
    firstName: 'Karim',
    lastName: 'Mostafa',
    publicId: 'usr_demo_laboratory',
    profile: { kind: 'staff', staffRole: 'LABORATORY', title: 'Laboratory technologist' },
  },
  {
    email: 'pharmacy@medora.health',
    roleCode: 'pharmacy',
    displayName: 'Nour El-Sayed',
    firstName: 'Nour',
    lastName: 'El-Sayed',
    publicId: 'usr_demo_pharmacy',
    profile: { kind: 'staff', staffRole: 'PHARMACY', title: 'Clinical pharmacist' },
  },
  {
    email: 'nurse@medora.health',
    roleCode: 'nurse',
    displayName: 'Heba Youssef',
    firstName: 'Heba',
    lastName: 'Youssef',
    publicId: 'usr_demo_nurse',
    profile: { kind: 'staff', staffRole: 'NURSE', title: 'Registered nurse' },
  },
  {
    email: 'patient@medora.health',
    roleCode: 'patient',
    displayName: 'Mona Adel',
    firstName: 'Mona',
    lastName: 'Adel',
    publicId: 'usr_demo_patient',
    // PT-1002 in `DEMO_PATIENTS`, assigned to the primary demo doctor.
    profile: { kind: 'patient', mrn: '4436-58' },
  },
];

/** Where the staff accounts' `staff_members` rows sit: the demo doctors' department. */
const STAFF_DEPARTMENT = 'Internal Medicine';

/**
 * Whether this environment may hold demo credentials at all.
 *
 * Explicit `development` only. Staging, test and production are refused
 * (see the header), and so is an unset `APP_ENV`, which `db:seed`
 * otherwise reads as development: a known password must never depend on
 * a default.
 */
export function demoCredentialsPermitted(appEnv: string | undefined): boolean {
  return appEnv === 'development';
}

export interface DemoCredentialSettings {
  readonly password: string;
  readonly adminTotpSecret: string;
}

/**
 * The password and TOTP secret to provision, from `DEMO_ACCOUNT_PASSWORD`
 * and `DEMO_ADMIN_TOTP_SECRET` or the local defaults.
 *
 * Both are validated before anything is written: a configured password
 * the application's own policy would refuse at sign-up, or a secret no
 * authenticator could load, fails the seed rather than seeding an
 * account nobody can use.
 */
export function demoCredentialSettings(
  source: Readonly<Record<string, string | undefined>>,
): DemoCredentialSettings {
  const password = nonEmpty(source['DEMO_ACCOUNT_PASSWORD']) ?? DEFAULT_DEMO_PASSWORD;
  const failures = passwordPolicyErrors(password);
  if (failures.length > 0) {
    throw new Error(
      `DEMO_ACCOUNT_PASSWORD does not meet the password policy: ${failures.join('; ')}`,
    );
  }

  const adminTotpSecret = (
    nonEmpty(source['DEMO_ADMIN_TOTP_SECRET']) ?? DEFAULT_DEMO_ADMIN_TOTP_SECRET
  ).toUpperCase();
  if (
    !/^[A-Z2-7]{16,}=*$/.test(adminTotpSecret) ||
    Secret.fromBase32(adminTotpSecret).bytes.length < 10
  ) {
    throw new Error(
      'DEMO_ADMIN_TOTP_SECRET must be base32 of at least 80 bits (16+ characters, A–Z and 2–7)',
    );
  }

  return { password, adminTotpSecret };
}

export interface DemoAccountServices {
  readonly passwords: PasswordService;
  readonly envelope: EnvelopeService;
}

export type DemoAccountOutcome =
  | 'created'
  | 'credential-added'
  | 'unchanged'
  | 'skipped-role-mismatch'
  | 'skipped-inactive'
  | 'skipped-missing-profile'
  | 'skipped-profile-conflict';

export interface DemoAccountReport {
  readonly email: string;
  readonly roleCode: string;
  readonly outcome: DemoAccountOutcome;
  /** Set when this run enrolled the account's second factor. */
  readonly secondFactorAdded: boolean;
}

/**
 * Makes every `DEMO_ACCOUNTS` entry a usable account. Idempotent: a second
 * run reports `unchanged` for every account the first one provisioned.
 *
 * Runs after `seedDemo`, whose doctors, administrator and patients it
 * reuses. Takes a transaction client so a spec can run it inside a
 * transaction that is rolled back.
 */
export async function provisionDemoAccounts(
  prisma: Prisma.TransactionClient,
  services: DemoAccountServices,
  settings: DemoCredentialSettings,
  /**
   * Required, with no default: a default would read `process.env`, and an
   * explicit `undefined` would then silently mean "whatever the process
   * says" — the caller states the environment it is provisioning for.
   */
  appEnv: string | undefined,
  /** `DEMO_ACCOUNTS` unless a spec passes suite-scoped copies of them. */
  accounts: readonly DemoAccountSeed[] = DEMO_ACCOUNTS,
): Promise<readonly DemoAccountReport[]> {
  if (!demoCredentialsPermitted(appEnv)) {
    throw new Error(
      `Refusing to provision demo credentials (APP_ENV=${appEnv ?? 'unset'}); ` +
        'only an explicit development environment may hold them',
    );
  }

  const department = await prisma.department.findUniqueOrThrow({
    where: { name: STAFF_DEPARTMENT },
  });
  const reports: DemoAccountReport[] = [];

  for (const seed of accounts) {
    reports.push(await provisionOne(prisma, services, settings, seed, department.id));
  }

  return reports;
}

async function provisionOne(
  prisma: Prisma.TransactionClient,
  services: DemoAccountServices,
  settings: DemoCredentialSettings,
  seed: DemoAccountSeed,
  departmentId: string,
): Promise<DemoAccountReport> {
  const report = (outcome: DemoAccountOutcome, secondFactorAdded = false): DemoAccountReport => ({
    email: seed.email,
    roleCode: seed.roleCode,
    outcome,
    secondFactorAdded,
  });

  const role = await prisma.role.findUniqueOrThrow({ where: { code: seed.roleCode } });

  // The base client, deliberately: a soft-deleted account still holds the
  // address, and must be reported rather than shadowed by a second row.
  let user = await prisma.user.findUnique({
    where: { email: seed.email },
    include: { credentials: { select: { userId: true, totpSecretEnc: true } } },
  });
  let created = false;

  if (user === null) {
    const now = new Date();
    user = await prisma.user.create({
      data: {
        publicId: seed.publicId,
        firstName: seed.firstName,
        lastName: seed.lastName,
        displayName: seed.displayName,
        email: seed.email,
        phone: '+20 100 000 0000',
        roleId: role.id,
        status: 'ACTIVE',
        // Legitimate seed state, as `seedDemo` sets for its accounts: the
        // demo addresses are verified and both consents are recorded.
        emailVerifiedAt: now,
        termsAcceptedAt: now,
        privacyAcceptedAt: now,
      },
      include: { credentials: { select: { userId: true, totpSecretEnc: true } } },
    });
    created = true;
  } else if (user.roleId !== role.id) {
    return report('skipped-role-mismatch');
  } else if (user.deletedAt !== null || user.status !== 'ACTIVE' || user.emailVerifiedAt === null) {
    return report('skipped-inactive');
  }

  if (!(await ensureProfile(prisma, seed, user.id, departmentId))) {
    return report(
      seed.profile.kind === 'patient' ? 'skipped-profile-conflict' : 'skipped-missing-profile',
    );
  }

  await ensureClinicalStanding(prisma, seed, user.id);

  let credentialAdded = false;
  if (user.credentials === null) {
    // Hashed only when needed — Argon2id is the slow part of this file —
    // and inserted ON CONFLICT DO NOTHING, so a concurrent seed that won
    // the race keeps its row and this one reports what actually happened.
    const passwordHash = await services.passwords.hash(settings.password);
    const inserted = await prisma.userCredential.createMany({
      data: [{ userId: user.id, passwordHash }],
      skipDuplicates: true,
    });
    credentialAdded = inserted.count === 1;
  }

  const secondFactorAdded =
    seed.roleCode === 'admin' && !user.twoFactorEnabled
      ? await enrolAdminSecondFactor(prisma, services, settings, user.id)
      : false;

  if (created) return report('created', secondFactorAdded);
  if (credentialAdded) return report('credential-added', secondFactorAdded);
  return report('unchanged', secondFactorAdded);
}

/**
 * The role-specific row, created when missing. `false` when the account
 * cannot be made usable for its role without overriding someone else's
 * data — a doctor with no `doctors` row (that is `seedDemo`'s to create),
 * or a demo patient record already owned by another account.
 */
/**
 * Multi-hospital §2.5–§2.6: a doctor or staff account holds no capability
 * without an active employment or affiliation at an ACTIVE hospital. A demo
 * account that has never had one is given one at the development demo
 * hospital; an account with any history (active or ended) is left as it is,
 * so the provisioner never overrides a real lifecycle decision. The demo
 * administrator is deliberately given no Platform Admin grant (owner
 * decision: dev/test administrator accounts are not reclassified).
 */
async function ensureClinicalStanding(
  prisma: Prisma.TransactionClient,
  seed: DemoAccountSeed,
  userId: string,
): Promise<void> {
  if (seed.profile.kind !== 'doctor' && seed.profile.kind !== 'staff') return;
  const hospital = await prisma.hospital.upsert({
    where: { publicId: 'hsp_demo_development' },
    create: { publicId: 'hsp_demo_development', name: 'Medora Demo Hospital (development)' },
    update: {},
    select: { id: true },
  });

  if (seed.profile.kind === 'doctor') {
    const doctor = await prisma.doctor.findUnique({
      where: { userId },
      select: { id: true, _count: { select: { employments: true } } },
    });
    if (doctor === null || doctor._count.employments > 0) return;
    await prisma.doctorEmployment.create({ data: { doctorId: doctor.id, hospitalId: hospital.id } });
    return;
  }

  const staff = await prisma.staffMember.findFirst({
    where: { userId },
    select: { id: true, _count: { select: { hospitalAffiliations: true } } },
  });
  if (staff === null || staff._count.hospitalAffiliations > 0) return;
  await prisma.hospitalStaffAffiliation.create({ data: { staffId: staff.id, hospitalId: hospital.id } });
}

async function ensureProfile(
  prisma: Prisma.TransactionClient,
  seed: DemoAccountSeed,
  userId: string,
  departmentId: string,
): Promise<boolean> {
  const profile = seed.profile;

  switch (profile.kind) {
    case 'none':
      return true;

    case 'doctor':
      return (await prisma.doctor.findUnique({ where: { userId }, select: { id: true } })) !== null;

    case 'staff': {
      const existing = await prisma.staffMember.findUnique({ where: { email: seed.email } });
      if (existing === null) {
        await prisma.staffMember.create({
          data: {
            userId,
            name: seed.displayName,
            role: profile.staffRole,
            title: profile.title,
            departmentId,
            phone: '+20 100 000 0000',
            email: seed.email,
            workingHours: 'Sun–Thu 09:00–17:00',
          },
        });
        return true;
      }
      if (existing.userId === null) {
        await prisma.staffMember.update({ where: { id: existing.id }, data: { userId } });
        return true;
      }
      return existing.userId === userId;
    }

    case 'patient': {
      const patient = await prisma.patient.findUnique({
        where: { mrn: profile.mrn },
        select: { id: true, userId: true },
      });
      if (patient === null) return false;
      if (patient.userId === userId) return true;
      if (patient.userId !== null) return false;

      // Conditional on the record still being unclaimed, so a claim that
      // landed in between is not overwritten.
      const linked = await prisma.patient.updateMany({
        where: { id: patient.id, userId: null },
        data: { userId },
      });
      return linked.count === 1;
    }
  }
}

/**
 * Stores the known TOTP secret and turns the flag on — only if the
 * account has no secret yet, so a factor enrolled through the app is
 * never replaced. `TwoFactorService.setup` + `enable`, minus the round
 * trip a human would prove, because the secret is not random.
 */
async function enrolAdminSecondFactor(
  prisma: Prisma.TransactionClient,
  services: DemoAccountServices,
  settings: DemoCredentialSettings,
  userId: string,
): Promise<boolean> {
  const stored = await prisma.userCredential.updateMany({
    where: { userId, totpSecretEnc: null },
    data: { totpSecretEnc: services.envelope.encrypt(settings.adminTotpSecret) },
  });
  if (stored.count !== 1) return false;

  await prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: true } });
  return true;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === undefined || value.trim().length === 0 ? undefined : value;
}

/** One line for the seed summary. Counts only — never a password. */
export function describeDemoAccounts(reports: readonly DemoAccountReport[]): string {
  const counts = new Map<DemoAccountOutcome, number>();
  for (const entry of reports) counts.set(entry.outcome, (counts.get(entry.outcome) ?? 0) + 1);

  const parts = [...counts.entries()].map(([outcome, count]) => `${outcome} ${String(count)}`);
  const skipped = reports.filter((entry) => entry.outcome.startsWith('skipped'));
  const detail =
    skipped.length === 0
      ? ''
      : ` Skipped: ${skipped.map((entry) => `${entry.email} (${entry.outcome})`).join(', ')}.`;

  return `Demo accounts — ${parts.join(' · ')}. See backend/docs/LOCAL_DEMO_ACCOUNTS.md.${detail}`;
}

/** The two numbers the seed's one-line table summary carries. */
export function demoCredentialCountsFor(
  reports: readonly DemoAccountReport[],
): Record<string, number> {
  return {
    demoAccounts: reports.filter((entry) => !entry.outcome.startsWith('skipped')).length,
    demoCredentialsAdded: reports.filter(
      (entry) => entry.outcome === 'created' || entry.outcome === 'credential-added',
    ).length,
  };
}
