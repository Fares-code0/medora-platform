import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Secret, TOTP } from 'otpauth';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DeadLetterStore, InlineJobQueue, JobRegistry, JOB_QUEUE } from '../src/shared/jobs';
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
 * The background-job registry and its operator surface — RM M30.
 *
 * > ✅ M30.1: poisoned job lands in DLQ after N retries; board reachable
 * > only as admin.
 * > ✅ M30.2: each schedule registered and visible.
 * > 🔒 Exit gate M30: all periodic behavior runs from the registry, none
 * > ad hoc.
 *
 * ## The gate is asserted as an absence, and that is the point
 *
 * "None ad hoc" is not something a route can show. `no module starts a
 * timer of its own` below reads the module tree and asserts that nothing
 * outside the job kernel calls `setInterval` — the failure it catches is
 * the one nobody notices, where a future milestone adds a timer beside
 * its sweep and the registry silently stops being the whole picture.
 *
 * ## The schedules are listed by name, not counted
 *
 * The list is M30.2's own, transcribed, plus ADR-045's refresh-successor
 * sweep. A count would pass while a schedule was renamed or swapped, and
 * this is the assertion that says the roadmap's nine named jobs, M30.1's
 * two drains and that sweep all exist.
 *
 * ## The dead letter is planted, not provoked
 *
 * `job-runner.spec.ts` already drives a poisoned job through its retry
 * policy and asserts the entry, with instant backoff. Provoking the same
 * failure through this booted application would mean either sleeping
 * through a real 30-second backoff or registering a deliberately broken
 * job into the shipped registry — and the registry is sealed at boot,
 * precisely so that nothing can. What is untested without this file is
 * the *surface*: that the entry is listed, that replaying takes it out,
 * and that both are audited. So the entry is recorded through the
 * application's own `DeadLetterStore` and the HTTP path is exercised
 * over it.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const JOBS = '/api/v1/administration/jobs';
const PASSWORD = 'Medora123!';

let adminToken = '';
let adminUserId = '';
let doctorToken = '';

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

interface JobView {
  name: string;
  summary: string;
  schedule: string;
  state: 'runnable' | 'blocked';
  blocked?: { reason: string; unblockedBy: string };
  nextRunAt: string | null;
  retry: { attempts: number; backoff: string } | null;
  metrics: {
    started: number;
    succeeded: number;
    failedAttempts: number;
    deadLettered: number;
    lastRunAt: string | null;
    lastOutcome: Record<string, unknown> | null;
    lastError: string | null;
  };
}

interface JobsView {
  driver: string;
  enabled: boolean;
  processLocal: boolean;
  jobs: JobView[];
}

interface DeadLetterView {
  id: string;
  job: string;
  attempts: number;
  error: string;
  trigger: string;
}

/**
 * Every schedule the roadmap names, plus M30.1's two drains.
 *
 * Transcribed from M30.2 — "prescription expiry, retention purges,
 * scheduled reports, license-expiry warnings (<60/<30 days),
 * satisfaction-survey dispatch, backup trigger, orphan cleanup, malware
 * scans (M25.3), AI usage-log retention (M16.1)" — and from M30.1, which
 * owns the queue the notification pipeline was written against.
 */
const RUNNABLE = [
  'audit.retention-sweep',
  // ADR-045, RA-045.1 — not a roadmap schedule; bounds a secret at rest.
  'auth.refresh-successor-sweep',
  'doctors.license-expiry-warning',
  'files.malware-scan',
  'files.orphan-sweep',
  'idempotency.expiry-sweep',
  'notifications.delivery-run',
  'notifications.event-drain',
  'pharmacy.prescription-expiry-sweep',
] as const;

const BLOCKED = [
  'ai.usage-log-retention',
  'appointments.satisfaction-survey-dispatch',
  'platform-settings.backup-run',
  'reports.scheduled-run',
] as const;

function currentCode(secret: string): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

async function signUpDoctor(local: string): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  return dataOf<{ accessToken: string }>(
    await request(harness.server).post(LOGIN).send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;
}

/** ADR-035 §7's bootstrap: enrol a factor, take the role, step up. */
async function signUpAdmin(local: string): Promise<{ token: string; userId: string }> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  const bootstrap = dataOf<{ accessToken: string }>(
    await request(harness.server).post(LOGIN).send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;

  const secret = dataOf<{ secret: string }>(
    await request(harness.server).post('/api/v1/me/2fa/setup').set(as(bootstrap)).send({ password: PASSWORD }),
  ).secret;

  await request(harness.server)
    .post('/api/v1/me/2fa/enable')
    .set(as(bootstrap))
    .send({ code: currentCode(secret) });

  const adminRole = await harness.prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
  await harness.prisma.user.update({ where: { email }, data: { roleId: adminRole.id } });

  const otpToken = dataOf<{ otpToken: string }>(
    await request(harness.server).post(LOGIN).send({ email, password: PASSWORD }),
  ).otpToken;

  const token = dataOf<{ accessToken: string }>(
    await request(harness.server)
      .post('/api/v1/auth/otp/verify')
      .send({ otpToken, code: currentCode(secret) }),
  ).accessToken;

  const user = await harness.prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  });

  return { token, userId: user.id };
}

const overview = (): Promise<JobsView> =>
  request(harness.server)
    .get(JOBS)
    .set(as(adminToken))
    .then((response) => dataOf<JobsView>(response));

beforeAll(async () => {
  harness = await createAuthHarness('jobs-m30');

  const admin = await signUpAdmin('jobs-admin');
  adminToken = admin.token;
  adminUserId = admin.userId;
  doctorToken = await signUpDoctor('jobs-doctor');
}, 60_000);

afterAll(async () => {
  await harness.close();
});

describe('the registry holds every schedule M30 names (M30.2)', () => {
  it('registers the nine of M30.2, M30.1’s two drains and ADR-045’s sweep, and nothing else', async () => {
    const view = await overview();

    expect(view.jobs.map((job) => job.name)).toEqual([...RUNNABLE, ...BLOCKED].sort());
  });

  it('is sealed, so nothing can add a schedule after boot', () => {
    // The failure this catches: a schedule registered from a request
    // handler or a lazily-initialised module, which would never appear
    // in the boot log and was never printed on this screen.
    const registry = harness.app.get(JobRegistry);

    expect(registry.isSealed).toBe(true);
    expect(() => {
      registry.register({
        name: 'late.registration',
        summary: 'too late',
        schedule: { kind: 'every', ms: 60_000 },
        blocked: { reason: 'x', unblockedBy: 'y' },
      });
    }).toThrow(/registered after boot/);
  });

  it('gives every runnable job a next firing, a retry policy and a readable cadence', async () => {
    const view = await overview();

    for (const job of view.jobs.filter((entry) => entry.state === 'runnable')) {
      expect(job.nextRunAt, job.name).not.toBeNull();
      expect(new Date(job.nextRunAt ?? '').getTime(), job.name).toBeGreaterThan(Date.now());
      expect(job.retry?.attempts, job.name).toBeGreaterThanOrEqual(1);
      expect(job.schedule, job.name).toMatch(/^(every \d+ (min|h)|daily at \d{2}:\d{2} UTC)$/);
      expect(job.summary.length, job.name).toBeGreaterThan(20);
    }
  });

  it('shows each blocked schedule with its reason and what would unblock it', async () => {
    // The whole reason a blocked job is registered rather than omitted:
    // an operator can see that scheduled reports are declared, are not
    // running, and why — which no broker dashboard could ever show,
    // because a blocked job never reaches a broker.
    const view = await overview();
    const blocked = view.jobs.filter((entry) => entry.state === 'blocked');

    expect(blocked.map((entry) => entry.name)).toEqual([...BLOCKED]);

    for (const job of blocked) {
      expect(job.nextRunAt, job.name).toBeNull();
      expect(job.retry, job.name).toBeNull();
      expect(job.blocked?.reason.length, job.name).toBeGreaterThan(40);
      expect(job.blocked?.unblockedBy.length, job.name).toBeGreaterThan(5);
    }
  });

  it('names the driver and whether this instance fires', async () => {
    const view = await overview();

    // The suite runs with `JOBS_ENABLED=false`: the registry is built and
    // sealed, and only firing is suppressed. Reporting that distinction
    // is what stops an operator reading an idle replica as a broken one.
    expect(view.driver).toBe('inline');
    expect(view.enabled).toBe(false);
    // Stated rather than left to be inferred — RA-M30.1.
    expect(view.processLocal).toBe(true);
  });
});

describe('the exit gate: none ad hoc (M30)', () => {
  /**
   * Every `.ts` under a source root, excluding specs and the lint
   * fixtures — the same walk `audit-coverage.e2e-spec.ts` uses.
   */
  function sources(root: string): string[] {
    const found: string[] = [];

    const walk = (directory: string): void => {
      for (const entry of readdirSync(directory)) {
        const full = join(directory, entry);

        if (statSync(full).isDirectory()) {
          if (entry !== '__boundary-fixtures__') walk(full);
          continue;
        }

        if (full.endsWith('.ts') && !full.endsWith('.spec.ts')) found.push(full);
      }
    };

    walk(root);

    return found;
  }

  /**
   * Comments carry the words too — three files quote the rule verbatim
   * — so a naive grep would fail on the very headers that record it.
   */
  function withoutComments(source: string): string {
    return source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/\/\/.*$/gm, '');
  }

  /**
   * Recurring mechanisms only. A one-shot `setTimeout` is not periodic
   * behaviour — `HttpIntegrationProbe` aborts a request that hangs with a
   * one-shot timer, which is a timeout and not a schedule.
   */
  const RECURRING = /\b(setInterval|@Cron|@Interval|cron\.schedule|node-cron)\b/;

  it('finds the source tree at all', () => {
    // Without this the assertion below passes by reading nothing, which
    // is the failure mode of every source-scanning test.
    expect(sources(resolve(__dirname, '../src/modules')).length).toBeGreaterThan(100);
  });

  it('leaves the job kernel as the only place that repeats anything', () => {
    // The gate: "all periodic behavior runs from the registry, none ad
    // hoc". A future milestone adding a timer beside its own sweep is
    // exactly the change nobody would notice, and it is the change that
    // makes this screen stop being the whole picture.
    const roots = [resolve(__dirname, '../src/modules'), resolve(__dirname, '../src/shared')];
    const offenders = roots
      .flatMap((root) => sources(root))
      .filter((file) => !file.includes(join('shared', 'jobs')))
      .filter((file) => !EXEMPT.has(file))
      .filter((file) => RECURRING.test(withoutComments(readFileSync(file, 'utf8'))));

    expect(offenders).toEqual([]);
  });

  /**
   * The one exception, named rather than hidden (ADR-045, RA-045.2).
   *
   * `SuccessorRetentionService` bounds how long an encrypted live refresh
   * token stays at rest. The registry fires only where `JOBS_ENABLED` is
   * on, which may be no instance at all, so that bound cannot run from the
   * registry; the timer runs on every instance by design, and the registry
   * job `auth.refresh-successor-sweep` still runs the same sweep where jobs
   * fire. Adding a file here is an ADR decision, not a test fix.
   */
  const EXEMPT = new Set([
    resolve(__dirname, '../src/modules/auth/services/successor-retention.service.ts'),
  ]);

  it('exempts exactly the files ADR-045 names, and they really do repeat something', () => {
    for (const file of EXEMPT) {
      expect(RECURRING.test(withoutComments(readFileSync(file, 'utf8')))).toBe(true);
    }
    expect(EXEMPT.size).toBe(1);
  });
});

describe('the screen is admin-only (M30.1)', () => {
  it('refuses a doctor on every route', async () => {
    expect((await request(harness.server).get(JOBS).set(as(doctorToken))).status).toBe(403);
    expect(
      (await request(harness.server).get(`${JOBS}/dead-letters`).set(as(doctorToken))).status,
    ).toBe(403);
    expect(
      (await request(harness.server)
        .post(`${JOBS}/files.orphan-sweep/run`)
        .set(as(doctorToken))).status,
    ).toBe(403);
  });

  it('refuses an anonymous caller', async () => {
    expect((await request(harness.server).get(JOBS)).status).toBe(401);
  });
});

describe('running a job on demand (M30.1)', () => {
  it('accepts, runs it, and moves the metrics', async () => {
    const before = (await overview()).jobs.find((job) => job.name === 'files.orphan-sweep');

    const response = await request(harness.server)
      .post(`${JOBS}/files.orphan-sweep/run`)
      .set(as(adminToken));

    // 202: accepted, not completed. A retention sweep's ten-minute
    // timeout must never sit on an HTTP request (API §0's 30 s rule).
    expect(response.status).toBe(202);
    expect(dataOf<{ accepted: boolean }>(response).accepted).toBe(true);

    await harness.app.get<InlineJobQueue>(JOB_QUEUE).settle();

    const after = (await overview()).jobs.find((job) => job.name === 'files.orphan-sweep');
    expect(after?.metrics.started).toBe((before?.metrics.started ?? 0) + 1);
    expect(after?.metrics.succeeded).toBe((before?.metrics.succeeded ?? 0) + 1);
    expect(after?.metrics.lastRunAt).not.toBeNull();
    // The sweep's own result, carried through as scalars. The *keys* are
    // asserted rather than the counts: `files.e2e-spec.ts` runs in
    // parallel and soft-deletes files, so an exact `removed: 0` would be
    // an assertion about another suite's timing.
    expect(Object.keys(after?.metrics.lastOutcome ?? {}).sort()).toEqual(['failed', 'removed']);
    expect(typeof after?.metrics.lastOutcome?.['removed']).toBe('number');
  });

  it('writes an audit row for the run', async () => {
    await request(harness.server).post(`${JOBS}/audit.retention-sweep/run`).set(as(adminToken));

    const row = await harness.prisma.db.auditEvent.findFirst({
      where: { actorId: adminUserId, eventType: 'job.trigger', target: 'job:audit.retention-sweep' },
      orderBy: { occurredAt: 'desc' },
    });

    expect(row).not.toBeNull();
    // `warning`, not `info`: the registry includes a sweep whose day job
    // is to `DROP TABLE`, and an administrator running it by hand at an
    // unexpected hour is the row an investigator would want.
    expect(row?.severity).toBe('WARNING');
    expect(row?.category).toBe('ADMIN_ACTIVITY');

    await harness.app.get<InlineJobQueue>(JOB_QUEUE).settle();
  });

  it('refuses a blocked job with 409 and the reason, not 404', async () => {
    // 404 would deny that the job exists, when this very screen lists
    // it; 422 would blame the caller for asking about something the
    // platform advertises.
    const response = await request(harness.server)
      .post(`${JOBS}/reports.scheduled-run/run`)
      .set(as(adminToken));

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('job_blocked');
    expect(errorBody(response).detail).toMatch(/run_status/);
  });

  it('answers 404 for a name nobody registered', async () => {
    const response = await request(harness.server).post(`${JOBS}/no.such-job/run`).set(as(adminToken));

    expect(response.status).toBe(404);
  });
});

describe('dead letters (M30.1)', () => {
  it('lists an entry, filters by job, replays it once and audits the replay', async () => {
    const store = harness.app.get(DeadLetterStore);
    const planted = store.record({
      job: 'files.orphan-sweep',
      failedAt: new Date(),
      attempts: 3,
      error: 'store refused',
      correlationId: 'c-1',
      trigger: 'schedule',
    });

    const listed = dataOf<DeadLetterView[]>(
      await request(harness.server).get(`${JOBS}/dead-letters`).set(as(adminToken)),
    );
    expect(listed.map((entry) => entry.id)).toContain(planted.id);

    const filtered = dataOf<DeadLetterView[]>(
      await request(harness.server)
        .get(`${JOBS}/dead-letters?job=notifications.event-drain`)
        .set(as(adminToken)),
    );
    expect(filtered.map((entry) => entry.id)).not.toContain(planted.id);

    const replay = await request(harness.server)
      .post(`${JOBS}/dead-letters/${planted.id}/replay`)
      .set(as(adminToken));
    expect(replay.status).toBe(202);

    // Taken, not copied: a second operator looking at the same screen a
    // moment later must not be able to replay it again.
    const second = await request(harness.server)
      .post(`${JOBS}/dead-letters/${planted.id}/replay`)
      .set(as(adminToken));
    expect(second.status).toBe(404);

    const row = await harness.prisma.db.auditEvent.findFirst({
      where: { actorId: adminUserId, eventType: 'job.replay' },
      orderBy: { occurredAt: 'desc' },
    });
    expect(row?.target).toBe('job:files.orphan-sweep');

    await harness.app.get<InlineJobQueue>(JOB_QUEUE).settle();
  });

  it('answers 404 for a dead letter that never existed', async () => {
    const response = await request(harness.server)
      .post(`${JOBS}/dead-letters/00000000-0000-4000-8000-000000000000/replay`)
      .set(as(adminToken));

    expect(response.status).toBe(404);
  });
});
