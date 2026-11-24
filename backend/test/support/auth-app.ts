import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';

import { AppModule } from '../../src/app.module';
import { loadEnv } from '../../src/config/env';
import { applyBodyLimits } from '../../src/common/http/body-limits';
import { applyCachePolicy } from '../../src/common/http/cache-policy';
import { applyCompression } from '../../src/common/http/compression';
import { applyCors, applySecurityHeaders } from '../../src/common/http/security-headers';
import { applyTrustProxy } from '../../src/common/http/trust-proxy';
import { applyHttpMetrics } from '../../src/shared/metrics';
import {
  ConfigService,
  PLATFORM_POLICY_SOURCE,
  type PlatformPolicySource,
  type PolicyOverrides,
} from '../../src/config';
import { type HospitalStamp, hospitalStampFor, PrismaService, runAsSystem } from '../../src/shared/database';
import { MAILER } from '../../src/shared/mail';
import { SmtpMailer } from '../../src/shared/mail/smtp.mailer';

import { SmtpSink } from './smtp-sink';

/**
 * A booted application for the M6 auth specs.
 *
 * Three things make this worth sharing rather than repeating per file.
 *
 * **The global prefix is set.** Production serves at `/api/v1`
 * (ADR-011), and the refresh cookie is scoped `Path=/api/v1/auth`. A
 * test that mounted the routes at the root would send that cookie
 * nowhere and would pass while the real client failed — the exact bug
 * ADR-011 exists to prevent.
 *
 * **Mail goes to a real SMTP server.** `MAILER` is overridden with an
 * `SmtpMailer` pointed at an in-process `SmtpSink`, not with a stub, so
 * the assertions about verification and reset links are about a message
 * that was genuinely delivered over a socket.
 *
 * **The identity tables are cleaned by email suffix**, and each spec file
 * passes its own suffix. Two things follow: these specs cannot delete the
 * seeded demo accounts other suites rely on, and — because Vitest runs
 * files in parallel — one auth spec cannot delete another's fixtures
 * mid-run, which is a failure that only appears in a full-suite run and
 * never when the file is run alone.
 *
 * **The security policy is steerable.** `PLATFORM_POLICY_SOURCE` is
 * overridden with a mutable object, so a test that needs
 * `singleSessionPerUser: true` sets it the way an administrator will,
 * rather than by restarting the process with a different environment.
 * M24.6 filled that seam from `platform_settings`, and this override
 * stays: the rows are **global** and Vitest runs files in parallel, so a
 * suite steering the real table would be steering every other suite's
 * login policy at the same time. `realPolicySource` opts back in, and
 * exactly one spec — the one that is about the layering — does.
 */
/** The parent domain; each spec file gets a subdomain of it. */
export const TEST_EMAIL_DOMAIN = 'm6.test';

/**
 * The domain of the harness this file created.
 *
 * Module-level state is safe here and nowhere else: Vitest isolates each
 * spec file in its own module registry, so "the harness this file
 * created" is exactly what a module-level variable holds. It exists so
 * `testEmail()` reads as a plain helper rather than threading the
 * harness through every call.
 */
let suiteDomain = TEST_EMAIL_DOMAIN;

export interface AuthHarness {
  /** This suite's email suffix, e.g. `login.m6.test`. */
  readonly domain: string;
  readonly app: INestApplication;
  readonly server: Server;
  readonly prisma: PrismaService;
  readonly sink: SmtpSink;
  /** Mutate to steer the effective policy, as M24's panel will. */
  readonly policy: { overrides: PolicyOverrides };
  close(): Promise<void>;
  /** Removes every account this suite created, and its cascade. */
  reset(): Promise<void>;
}

/**
 * A provider a suite wants replaced on top of the three this harness
 * already overrides.
 *
 * Added at M24 for the integration probe: `test-connection` makes an
 * outbound request, and a test that needed the network would be a test
 * of the network. `token` is `unknown` because Nest's injection tokens
 * are symbols, strings and classes alike.
 */
export interface HarnessOverride {
  readonly token: unknown;
  readonly value: unknown;
}

export interface HarnessOptions {
  readonly overrides?: readonly HarnessOverride[];
  /**
   * Leaves `PLATFORM_POLICY_SOURCE` bound to whatever the application
   * binds — the database-backed source from M24.6.
   *
   * Off by default, and that default is the important one: an auth spec
   * steering the policy must not be steering a shared `platform_settings`
   * row that another suite is reading at the same time. Only a spec that
   * is *about* the layering turns this on.
   */
  readonly realPolicySource?: boolean;
}

export async function createAuthHarness(
  suite: string,
  options: HarnessOptions = {},
): Promise<AuthHarness> {
  const domain = `${suite}.${TEST_EMAIL_DOMAIN}`;
  suiteDomain = domain;
  const sink = await SmtpSink.start();

  const policy: { overrides: PolicyOverrides } = { overrides: {} };
  const policySource: PlatformPolicySource = { load: () => Promise.resolve(policy.overrides) };

  let builder = Test.createTestingModule({ imports: [AppModule] });

  // The runtime-role mode (multi-hospital §2.15; final verification): the
  // application connects as the provisioned restricted role, with tenant
  // context on, while fixtures, cleanup and assertions keep the owner
  // connection below. `npm run test:e2e:runtime-role` sets it.
  const ownerEnv = loadEnv();
  // Only on the database the role was provisioned in: a suite that builds a
  // database of its own (a fresh deployment, an isolated copy) has no
  // runtime role there and keeps the owner connection.
  const runtimeUrl = sameDatabase(process.env['E2E_RUNTIME_DATABASE_URL'], ownerEnv.DATABASE_URL)
    ? process.env['E2E_RUNTIME_DATABASE_URL']
    : undefined;
  if (runtimeUrl !== undefined && runtimeUrl !== '') {
    builder = builder.overrideProvider(ConfigService).useValue(
      new ConfigService({ ...ownerEnv, DATABASE_URL: runtimeUrl, DATABASE_TENANT_CONTEXT: true }),
    );
  }

  if (options.realPolicySource !== true) {
    builder = builder.overrideProvider(PLATFORM_POLICY_SOURCE).useValue(policySource);
  }

  for (const override of options.overrides ?? []) {
    builder = builder.overrideProvider(override.token).useValue(override.value);
  }

  const moduleRef = await builder
    .overrideProvider(MAILER)
    .useFactory({
      inject: [ConfigService],
      factory: (config: ConfigService) =>
        new SmtpMailer(
          new ConfigService({
            ...config.env,
            SMTP_HOST: '127.0.0.1',
            SMTP_PORT: sink.port,
          }),
        ),
    })
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>();
  app.setGlobalPrefix('api/v1');
  // The header policy, CORS and parsers `main.ts` registers, in its order,
  // so the suites exercise what ships (RM M37.1, AST-G2).
  applyTrustProxy(app, app.get(ConfigService).trustProxy);
  applySecurityHeaders(app);
  applyCachePolicy(app);
  applyHttpMetrics(app);
  applyCompression(app);
  applyCors(app, app.get(ConfigService).corsOrigins);
  applyBodyLimits(app);
  await app.init();
  // Bound here, once, rather than left to supertest (RA-M10.2).
  //
  // `init()` wires the application but binds no port, so
  // `getHttpServer()` hands back an **unlistening** server — and
  // supertest, handed one of those, calls `listen(0)` itself and
  // `close()`s it again when that one request ends. Two requests in
  // flight together (`Promise.all` over two helpers) therefore share a
  // listener that the first to finish takes away: a connection still
  // sitting in the accept queue when it goes is reset by the kernel, and
  // the other request fails with `ECONNRESET` on a server that never saw
  // it.
  //
  // Binding once makes `address()` non-null for every request, so
  // supertest never starts or stops anything and the two cannot race.
  // `app.close()` in `close()` below releases the port.
  await app.listen(0, '127.0.0.1');

  // Fixtures go through the owner (RLS does not bind it, by design); in the
  // default mode that is the application's own connection.
  const ownerPrisma =
    runtimeUrl !== undefined && runtimeUrl !== ''
      ? new PrismaService(new ConfigService({ ...ownerEnv, DATABASE_TENANT_CONTEXT: false }))
      : undefined;
  if (ownerPrisma !== undefined) await ownerPrisma.$connect();
  const prisma: PrismaService = ownerPrisma === undefined ? app.get(PrismaService) : ownerPrisma;

  const harness: AuthHarness = {
    domain,
    app,
    server: app.getHttpServer(),
    prisma,
    sink,
    policy,
    async close(): Promise<void> {
      await app.close();
      await ownerPrisma?.$disconnect();
      await sink.stop();
    },
    async reset(): Promise<void> {
      // Staffing rows restrict their doctor / user (history is never
      // cascaded away in production), so a suite's own employments,
      // affiliations and hospital assignments go first.
      await removeStaffingOf(prisma, domain);
      // `deleteMany` on the base client, not `db`: a soft-deleted row is
      // still a row holding the unique email, and leaving it behind
      // would make the next run's registration a 409.
      await prisma.user.deleteMany({ where: { email: { endsWith: `@${domain}` } } });
      // `staff_members.user_id` is SET NULL, so a suite's staff rows (made by
      // `makeClinicalStaff`, keyed by the account's email) outlive it.
      await prisma.staffMember.deleteMany({ where: { email: { endsWith: `@${domain}` } } });
      // `login_events` survives its user by design (SET NULL), so the
      // rows have to go by address or they accumulate across runs and the
      // "one row per attempt" assertions start counting history.
      await prisma.loginEvent.deleteMany({
        where: { attemptedEmail: { endsWith: `@${domain}` } },
      });
      policy.overrides = {};
      sink.clear();
    },
  };

  await harness.reset();
  return harness;
}

/**
 * Typed access to a response body.
 *
 * Supertest types `body` as `any`, which the type-checked lint rules
 * reject on every property read. `transport.e2e-spec.ts` established the
 * convention of casting once through a named shape; these two helpers are
 * that convention, shared because six auth specs need it.
 */
export interface ErrorBody {
  readonly message: string;
  readonly code: string;
  readonly detail?: string;
  readonly fieldErrors?: Record<string, string[]>;
  readonly ref?: string;
}

export function errorBody(response: { body: unknown }): ErrorBody {
  return response.body as ErrorBody;
}

/** The payload inside the `{ data: … }` envelope (API §0.2). */
export function dataOf<T>(response: { body: unknown }): T {
  return (response.body as { data: T }).data;
}

/** A unique address in this spec file's own domain. */
export function testEmail(local: string): string {
  return `${local}@${suiteDomain}`;
}

/**
 * A body that satisfies `registerSchema`'s **doctor** branch, with the
 * parts under test overridable.
 *
 * The professional block is part of the default because ADR-035 §4 makes
 * it required: a doctor registration without it is a 422, so a fixture
 * that omitted it would make every unrelated test in every auth suite
 * fail on validation rather than on what it is testing.
 *
 * The registration number is derived from the address so that two
 * registrations in one test do not collide on `doctors.license_number`,
 * which is UNIQUE. A constant here would make the second registration in
 * any test a 409 for a reason the test never intended.
 */
export function registrationBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const email = (overrides['email'] as string | undefined) ?? testEmail('priya');

  return {
    firstName: 'Priya',
    lastName: 'Nair',
    email,
    phone: '+20 100 214 3387',
    password: 'Medora123!',
    confirmPassword: 'Medora123!',
    role: 'doctor',
    professionalRegistrationNumber: professionalNumberFor(email),
    professionalCategory: 'physician',
    specialty: 'Cardiology',
    acceptTerms: true,
    acceptPrivacy: true,
    ...overrides,
  };
}

/** A body that satisfies the **patient** branch: account fields only. */
export function patientRegistrationBody(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    firstName: 'Sara',
    lastName: 'Ali',
    email: testEmail('sara'),
    phone: '+20 100 555 1212',
    password: 'Medora123!',
    confirmPassword: 'Medora123!',
    role: 'patient',
    acceptTerms: true,
    acceptPrivacy: true,
    ...overrides,
  };
}

/**
 * A registration number unique to an address, within
 * `doctors.license_number`'s 40 characters.
 *
 * Non-alphanumerics are stripped rather than escaped: the column is a
 * plain varchar and the value only has to be unique and short, so the
 * simplest total function is the right one.
 */
export function professionalNumberFor(email: string): string {
  return `REG-${email.replace(/[^A-Za-z0-9]/g, '').slice(0, 30)}`;
}

/**
 * Marks an account's address verified, without going through M6.6.
 *
 * The login specs need a verified account and are not testing the
 * verification endpoint; reaching through the API for a precondition
 * would make every login case fail when that endpoint breaks.
 */
export async function markVerified(prisma: PrismaService, email: string): Promise<void> {
  await prisma.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });
}

/** Deletes the staffing rows of every account in `domain` (test cleanup only). */
async function removeStaffingOf(prisma: PrismaService, domain: string): Promise<void> {
  const users = { email: { endsWith: `@${domain}` } };
  const ids = async (rows: Promise<{ id: string }[]>) => (await rows).map((row) => row.id);
  await deleteWithDependents(
    prisma,
    'hospital_role_assignments',
    await ids(prisma.hospitalRoleAssignment.findMany({ where: { user: { is: users } }, select: { id: true } })),
  );
  await deleteWithDependents(
    prisma,
    'doctor_employments',
    await ids(
      prisma.doctorEmployment.findMany({
        where: { doctor: { is: { user: { is: users } } } },
        select: { id: true },
      }),
    ),
  );
  await deleteWithDependents(
    prisma,
    'hospital_staff_affiliations',
    await ids(
      prisma.hospitalStaffAffiliation.findMany({
        where: { staff: { is: { user: { is: users } } } },
        select: { id: true },
      }),
    ),
  );
}

/**
 * Test cleanup only: deletes rows of `table` by id after first deleting —
 * recursively — every row that references them through a RESTRICT / NO
 * ACTION foreign key (discovered from `pg_constraint`, so it stays correct
 * as hospital stamping spreads). Cascading and SET NULL references are left
 * to PostgreSQL. Stamped tenant keys cannot be nulled in place (a Phase 22
 * trigger), which is why dependents are deleted rather than detached.
 */
export async function deleteWithDependents(
  prisma: PrismaService,
  table: string,
  ids: readonly string[],
  depth = 0,
): Promise<void> {
  if (ids.length === 0) return;
  if (depth > 8) throw new Error(`deleteWithDependents: reference chain too deep at ${table}`);
  const references = await prisma.$queryRaw<{ child: string; column: string }[]>`
    SELECT c.conrelid::regclass::text AS child, a.attname AS column
      FROM pg_constraint c
      JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = ANY (c.confkey) AND pa.attname = 'id'
      JOIN pg_attribute a ON a.attrelid = c.conrelid
       AND a.attnum = c.conkey[array_position(c.confkey, pa.attnum)]
     WHERE c.contype = 'f' AND c.confrelid = ${table}::regclass AND c.confdeltype IN ('r', 'a')
       AND c.conrelid <> c.confrelid`;
  for (const { child, column } of references) {
    const rows = await prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id::text AS id FROM ${child} WHERE "${column}" = ANY($1::uuid[])`,
      ids,
    );
    await deleteWithDependents(
      prisma,
      child,
      rows.map((row) => row.id),
      depth + 1,
    );
  }
  await prisma.$executeRawUnsafe(`DELETE FROM ${table} WHERE id = ANY($1::uuid[])`, ids);
}

/**
 * An ACTIVE hospital e2e fixtures employ clinicians at, created once per
 * key. `a` is the default; a suite that proves isolation puts its second
 * clinician at `b` (DR-05: a colleague at the same hospital *does* reach
 * the chart, so "another doctor's patient" means another hospital's).
 */
export async function fixtureHospital(prisma: PrismaService, key = 'a'): Promise<string> {
  const publicId = key === 'a' ? 'hsp_e2e_fixture' : `hsp_e2e_fixture_${key}`;
  const row = await prisma.hospital.upsert({
    where: { publicId },
    create: { publicId, name: `E2E Fixture Hospital ${key.toUpperCase()}` },
    update: { status: 'ACTIVE', deletedAt: null },
    select: { id: true },
  });
  return row.id;
}

/**
 * Opens `patientId`'s Hospital Medical Record at a fixture hospital
 * (DR-05). A patient registered through the API by a clinical doctor gets
 * one automatically; a patient written straight to the database does not.
 */
export async function recordPatientAt(
  prisma: PrismaService,
  patientId: string,
  hospitalId?: string,
): Promise<string> {
  const at = hospitalId ?? (await fixtureHospital(prisma));
  const row = await prisma.hospitalMedicalRecord.upsert({
    where: { patientId_hospitalId: { patientId, hospitalId: at } },
    create: { patientId, hospitalId: at },
    update: {},
    select: { id: true },
  });
  return row.id;
}

/**
 * Puts the staff account behind `email` (reception, laboratory, pharmacy,
 * nurse) in clinical standing: a `staff_members` row and one active
 * affiliation at `hospitalId` (fixture hospital `a` by default).
 */
export async function makeClinicalStaff(
  prisma: PrismaService,
  email: string,
  hospitalId?: string,
): Promise<{ staffId: string; hospitalId: string }> {
  const at = hospitalId ?? (await fixtureHospital(prisma));
  const user = await prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true, displayName: true, phone: true, role: { select: { code: true } } },
  });
  const roleOf: Record<string, 'RECEPTIONIST' | 'LABORATORY' | 'PHARMACY' | 'NURSE'> = {
    reception: 'RECEPTIONIST',
    laboratory: 'LABORATORY',
    pharmacy: 'PHARMACY',
    nurse: 'NURSE',
  };
  const departmentId = (await prisma.department.findFirstOrThrow({ select: { id: true } })).id;
  const staff =
    (await prisma.staffMember.findFirst({ where: { userId: user.id }, select: { id: true } })) ??
    (await prisma.staffMember.create({
      data: {
        userId: user.id,
        name: user.displayName,
        role: roleOf[user.role.code] ?? 'NURSE',
        title: 'Fixture staff',
        departmentId,
        phone: user.phone,
        email,
        workingHours: '09:00-17:00',
      },
      select: { id: true },
    }));
  const active = await prisma.hospitalStaffAffiliation.findFirst({
    where: { staffId: staff.id, endedAt: null },
    select: { id: true },
  });
  if (active === null) {
    await prisma.hospitalStaffAffiliation.create({ data: { staffId: staff.id, hospitalId: at } });
  }
  await prisma.user.update({ where: { id: user.id }, data: { authzVersion: { increment: 1 } } });
  return { staffId: staff.id, hospitalId: at };
}

/**
 * Test cleanup only: removes the Hospital Medical Records of `patientIds`
 * and everything that restricts their deletion. Call it before deleting the
 * patients themselves — HMRs restrict their patient.
 */
export async function purgeHospitalRecords(
  prisma: PrismaService,
  patientIds: readonly string[],
): Promise<void> {
  if (patientIds.length === 0) return;
  const records = await prisma.hospitalMedicalRecord.findMany({
    where: { patientId: { in: [...patientIds] } },
    select: { id: true },
  });
  await deleteWithDependents(
    prisma,
    'hospital_medical_records',
    records.map((row) => row.id),
  );
}



/**
 * Puts the doctor behind `email` in clinical standing (multi-hospital §2.6,
 * DR-05): verified, ACTIVE practice, and one active employment at
 * `hospitalId` (the shared fixture hospital by default). A registered doctor
 * is otherwise unverified and unemployed, and holds no clinical capability.
 */
export async function makeClinicalDoctor(
  prisma: PrismaService,
  email: string,
  hospitalId?: string,
): Promise<{ doctorId: string; hospitalId: string }> {
  const at = hospitalId ?? (await fixtureHospital(prisma));
  const doctor = await prisma.doctor.findFirstOrThrow({
    where: { user: { is: { email } } },
    select: { id: true, userId: true },
  });
  await prisma.doctor.update({
    where: { id: doctor.id },
    data: { verificationStatus: 'VERIFIED', practiceStatus: 'ACTIVE' },
  });
  const active = await prisma.doctorEmployment.findFirst({
    where: { doctorId: doctor.id, endedAt: null },
    select: { id: true },
  });
  if (active === null) {
    await prisma.doctorEmployment.create({ data: { doctorId: doctor.id, hospitalId: at } });
  }
  await prisma.user.update({
    where: { id: doctor.userId },
    data: { authzVersion: { increment: 1 } },
  });
  return { doctorId: doctor.id, hospitalId: at };
}

/**
 * Makes `email` (already holding the `admin` role) a Platform Admin through
 * an explicit `platform_admin_grants` row (OD-07). Platform scope is never
 * inferred from a missing hospital assignment, so a fixture administrator
 * that exercises platform-wide routes needs the grant a real one would hold.
 * Idempotent.
 */
export async function grantPlatformAdmin(prisma: PrismaService, email: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
  const active = await prisma.platformAdminGrant.findFirst({
    where: { userId: user.id, revokedAt: null },
    select: { id: true },
  });
  if (active !== null) return;
  await prisma.platformAdminGrant.create({
    data: { userId: user.id, reason: 'Test fixture platform administrator' },
  });
}

/**
 * Moves every rotation of `email`'s sessions past ADR-045's 30-second
 * grace window, so a retired token re-presented afterwards is a replay
 * rather than a retry.
 *
 * The specs that assert ADR-026's reuse detection call this between the
 * rotation and the replay. Without it, the replay lands inside the window
 * and is — correctly — answered with the successor instead.
 *
 * On the database clock, which is the only clock the window is measured
 * by: an application timestamp would make this helper disagree with the
 * check it is meant to defeat whenever the two clocks drift.
 */
export async function endGraceWindow(prisma: PrismaService, email: string): Promise<void> {
  await rotatedSecondsAgo(prisma, email, 31);
}

/**
 * Sets every rotated session of `email` to have rotated `seconds` ago by
 * the database clock (`clock_timestamp()`) — the fixture ADR-045's
 * boundary specs need.
 */
export async function rotatedSecondsAgo(
  prisma: PrismaService,
  email: string,
  seconds: number,
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE sessions s
       SET rotated_at = clock_timestamp() - ${seconds}::float8 * interval '1 second'
      FROM users u
     WHERE u.id = s.user_id
       AND u.email = ${email}
       AND s.rotated_at IS NOT NULL`;
}

/** The `token` query parameter of the single link in a captured mail. */
export function tokenFromLink(text: string): string {
  const match = /[?&]token=([A-Za-z0-9_-]+)/.exec(text);
  if (match?.[1] === undefined) throw new Error(`No token in mail body:\n${text}`);
  return match[1];
}

/**
 * The hospital stamp a clinical row written by `doctorId` about `patientId`
 * carries (multi-hospital §2.7; audit F-06): the doctor's one active
 * employment, its hospital, and the patient's record there — derived exactly
 * as the application derives it. A fixture that writes clinical rows
 * straight to the database spreads this into them; an unstamped row belongs
 * to no hospital and is, correctly, invisible to every clinician.
 */
export async function clinicalStampFor(
  prisma: PrismaService,
  doctorId: string,
  patientId: string,
): Promise<HospitalStamp> {
  const stamp = await hospitalStampFor(prisma, doctorId, patientId);
  if (stamp === null) {
    throw new Error('clinicalStampFor: the doctor has no clinical hospital holding this patient’s record');
  }
  return stamp;
}

/**
 * `{ hospitalId, hospitalMedicalRecordId }` of a patient who holds exactly
 * one Hospital Medical Record — the stamp a fixture row about that patient
 * carries when it is written straight to the database (F-06).
 */
export async function soleRecordOf(
  prisma: PrismaService,
  patientId: string,
): Promise<{ hospitalId: string; hospitalMedicalRecordId: string }> {
  const records = await prisma.hospitalMedicalRecord.findMany({
    where: { patientId },
    select: { id: true, hospitalId: true },
    take: 2,
  });
  const [record] = records;
  if (record === undefined || records.length !== 1) {
    throw new Error('soleRecordOf: the patient must hold exactly one Hospital Medical Record');
  }
  return { hospitalId: record.hospitalId, hospitalMedicalRecordId: record.id };
}

/**
 * A job handler service, called the way `JobRunnerService` calls it: every
 * method runs under `system` RLS scope. Suites that drive a job's unit of
 * work directly (a sweep, a dispatcher drain, a delivery worker) wrap the
 * service in this, so they exercise what the scheduler runs — under the
 * runtime role a direct call outside any scope sees no row at all.
 */
export function asJob<T extends object>(service: T): T {
  return new Proxy(service, {
    get(target, property, receiver) {
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== 'function') return value;
      // Awaited inside the scope: a Prisma query is lazy and would otherwise
      // run when the caller awaits it, outside `system`.
      return (...args: unknown[]) =>
        runAsSystem(async () => await (value as (...a: unknown[]) => unknown).apply(target, args));
    },
  });
}

function sameDatabase(runtimeUrl: string | undefined, ownerUrl: string): boolean {
  if (runtimeUrl === undefined || runtimeUrl === '') return false;
  const a = new URL(runtimeUrl);
  const b = new URL(ownerUrl);
  return a.host === b.host && a.pathname === b.pathname;
}
