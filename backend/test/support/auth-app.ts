import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';

import { AppModule } from '../../src/app.module';
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
import { PrismaService } from '../../src/shared/database';
import { MAILER } from '../../src/shared/mail';
import { SmtpMailer } from '../../src/shared/mail/smtp.mailer';

import { SmtpSink } from './smtp-sink';
import {
  createTestHospital,
  destroyTestHospitals,
  employUser,
  releaseOwnership,
  type TestHospital,
} from './hospital-fixture';

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
  /**
   * The suite's own `ACTIVE` hospital (S3/S4), created on first use and
   * removed, with everything it owns, by `close()`. `suffix` names a second
   * hospital, for cross-hospital negatives.
   */
  hospital(suffix?: string): Promise<TestHospital>;
  /**
   * Makes the doctor account with this email clinically usable (S3/S4,
   * #18): verified and employed at the suite's hospital (or `suffix`'s).
   * Returns the employment id.
   */
  employ(email: string, suffix?: string): Promise<string>;
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
  /**
   * S3/S4: every doctor account this suite verifies with `markVerified` is
   * made **clinically usable** — its practice `VERIFIED` and an active
   * employment at the suite's hospital — so the charts, records, orders and
   * bookings it creates through the API are owned by that hospital, as they
   * are in production. Off by default: suites about the doctor lifecycle
   * itself (verification, employment) keep full control of those states.
   */
  readonly clinicalDoctors?: boolean;
}

/** The harness whose doctors `markVerified` employs (`clinicalDoctors`). */
let clinicalHarness: AuthHarness | null = null;

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

  const prisma = app.get(PrismaService);
  // `hospitals.public_id` is VarChar(40): the suite name, shortened.
  const hospitalTag = suite.replace(/[^a-z0-9]/gi, '').slice(0, 28);
  const hospitals = new Map<string, Promise<TestHospital>>();

  const harness: AuthHarness = {
    domain,
    app,
    server: app.getHttpServer(),
    prisma,
    sink,
    policy,
    hospital(suffix = 'a'): Promise<TestHospital> {
      let hospital = hospitals.get(suffix);
      if (hospital === undefined) {
        hospital = createTestHospital(prisma, hospitalTag, suffix);
        hospitals.set(suffix, hospital);
      }
      return hospital;
    },
    async employ(email: string, suffix = 'a'): Promise<string> {
      const hospital = await harness.hospital(suffix);
      const user = await prisma.user.findUniqueOrThrow({ where: { email }, select: { id: true } });
      return employUser(prisma, user.id, hospital.id);
    },
    async close(): Promise<void> {
      if (clinicalHarness === harness) clinicalHarness = null;
      if (hospitals.size > 0) await destroyTestHospitals(prisma, hospitalTag);
      await app.close();
      await sink.stop();
    },
    async reset(): Promise<void> {
      // `deleteMany` on the base client, not `db`: a soft-deleted row is
      // still a row holding the unique email, and leaving it behind
      // would make the next run's registration a 409.
      // Hospital employments restrict `doctors` (S3/S4), so the suite's
      // doctors give up their hospital-owned rows before the cascade.
      const doctors = await prisma.doctor.findMany({
        where: { user: { email: { endsWith: `@${domain}` } } },
        select: { id: true },
      });
      await releaseOwnership(prisma, { doctorIds: doctors.map((doctor) => doctor.id) });
      await prisma.user.deleteMany({ where: { email: { endsWith: `@${domain}` } } });
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
  if (options.clinicalDoctors === true) clinicalHarness = harness;
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

  // `clinicalDoctors` suites: a doctor is verified and employed at the
  // suite's hospital (S3/S4). Non-doctor accounts are left as they are.
  if (clinicalHarness !== null) {
    const doctor = await prisma.doctor.findFirst({
      where: { user: { email } },
      select: { id: true },
    });
    if (doctor !== null) await clinicalHarness.employ(email);
  }
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
