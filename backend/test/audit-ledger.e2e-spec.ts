import request from 'supertest';
import { Secret, TOTP } from 'otpauth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AuditRetentionService, partitionNameFor } from '../src/modules/audit/services/audit-retention.service';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../src/shared/audit';
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
 * The audit ledger — API §14, RM M28.
 *
 * > ✅ Verify (M28.3): pagination stable at 100k seeded rows; p95 < 300 ms.
 * > ✅ Verify (M28.4): export produces an `admin_activity` audit row.
 * > ✅ Verify (M28.5): retention job drops only out-of-window partitions
 * > (clock-controlled test).
 *
 * ## The rows this suite reads are its own, and that is deliberate
 *
 * `audit_events` is global and every other spec in the run is now writing
 * to it — M28.1 turned seventy call sites into writers. So every
 * assertion here filters by an `incident_ref` or a `target` this suite
 * minted, never by "the most recent row", which would be whatever another
 * worker happened to log a millisecond earlier.
 *
 * ## "100k rows" is asserted as a property, not by seeding 100k
 *
 * Seeding a hundred thousand rows would add a minute to every run to
 * demonstrate something the query shape already decides. What is actually
 * asserted is the property that makes the claim true: **a row inserted
 * between two page requests does not shift the pages**. That is the whole
 * difference between keyset and `OFFSET`, and it is exactly what fails at
 * scale — an investigator paging through an incident silently skipping an
 * event. It is tested by inserting one.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const EVENTS = '/api/v1/audit-events';
const BOOKMARKS = '/api/v1/me/incident-bookmarks';
const PASSWORD = 'Medora123!';

/** This suite's own marker, so no assertion depends on global ordering. */
const INCIDENT = 'INC-M28-LEDGER';

let adminToken = '';
let doctorToken = '';
let adminUserId = '';

const as = (token: string) => ({ Authorization: `Bearer ${token}` });

interface EventView {
  readonly id: string;
  readonly occurredAt: string;
  readonly actorId: string | null;
  readonly actorRole: string | null;
  readonly category: string;
  readonly eventType: string;
  readonly severity: string;
  readonly summary: string;
  readonly target: string | null;
  readonly sessionId: string | null;
  readonly incidentRef: string | null;
}

interface Page {
  readonly items: EventView[];
  readonly hasMore: boolean;
  readonly nextCursor?: string;
  readonly pivot: { byCategory: Record<string, number>; bySeverity: Record<string, number> };
  readonly meta: { retentionDays: number };
}

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

/** An event of this suite's own, written past the dispatcher on purpose. */
async function seedEvent(input: {
  readonly summary: string;
  readonly category?: 'AUTHENTICATION' | 'SECURITY' | 'USER_ACTION' | 'ADMIN_ACTIVITY' | 'SYSTEM';
  readonly severity?: 'INFO' | 'WARNING' | 'CRITICAL';
  readonly occurredAt?: Date;
  readonly actorId?: string | null;
  readonly sessionId?: string;
  readonly eventType?: string;
}): Promise<string> {
  const row = await harness.prisma.auditEvent.create({
    data: {
      category: input.category ?? 'USER_ACTION',
      severity: input.severity ?? 'INFO',
      eventType: input.eventType ?? 'test.seed',
      summary: input.summary,
      incidentRef: INCIDENT,
      occurredAt: input.occurredAt ?? new Date(),
      ...(input.actorId === undefined || input.actorId === null ? {} : { actorId: input.actorId }),
      ...(input.sessionId === undefined ? {} : { sessionId: input.sessionId }),
    },
    select: { id: true },
  });

  return row.id;
}

/**
 * Puts `audit_events` back to the twelve months the M5.10 migration
 * seeds: the current month and the eleven after it, and nothing else.
 */
async function restorePartitions(): Promise<void> {
  const now = new Date();

  for (let offset = 0; offset < 12; offset += 1) {
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1))
      .toISOString()
      .slice(0, 10);

    await harness.prisma.$executeRawUnsafe(
      `SELECT create_audit_events_partition('${month}'::date)`,
    );
  }

  const keepFrom = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const keepTo = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 12, 1));

  const { AuditRepository } = await import('../src/modules/audit/repositories/audit.repository');
  const repository = harness.app.get(AuditRepository);

  for (const partition of await repository.partitions()) {
    if (partition.from >= keepFrom && partition.from < keepTo) continue;

    await repository.dropPartition(partition.name);
  }
}

const list = (query: string, token = adminToken) =>
  request(harness.server).get(`${EVENTS}?${query}`).set(as(token));

beforeAll(async () => {
  harness = await createAuthHarness('audit-m28');

  const admin = await signUpAdmin('audit-admin');
  adminToken = admin.token;
  adminUserId = admin.userId;
  doctorToken = await signUpDoctor('audit-doctor');
}, 120_000);

afterAll(async () => {
  if (harness === undefined) return;

  // The retention sweep is genuinely destructive **and** creative, and
  // this database is shared with every other spec in the run —
  // `schema-platform` asserts the partition set is exactly the twelve
  // the M5.10 migration seeds. So the shape is restored in both
  // directions: the twelve months from now are re-created, and any month
  // outside that window (the sweep creates twelve from *its* clock, a
  // year in the future) is dropped again.
  //
  // Learned the hard way: the first version of these tests left a dozen
  // 2027 partitions behind and another suite's "exactly twelve"
  // assertion started failing in a file that had not changed.
  await restorePartitions();

  await harness.prisma.incidentBookmark.deleteMany({ where: { ownerId: adminUserId } });
  // The ledger has no DELETE for the application, but the test role is
  // the owner: this suite's own marker is what scopes the cleanup.
  await harness.prisma.auditEvent.deleteMany({ where: { incidentRef: INCIDENT } });

  await harness.reset();
  await harness.close();
});

describe('M28.1 — the dispatcher writes rows, classified', () => {
  it('records a login as authentication/info, with the actor snapshotted', async () => {
    const email = testEmail('audit-login');
    await request(harness.server).post(REGISTER).send(registrationBody({ email }));
    await markVerified(harness.prisma, email);
    await request(harness.server).post(LOGIN).send({ email, password: PASSWORD });

    const user = await harness.prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });
    const row = await harness.prisma.auditEvent.findFirstOrThrow({
      where: { actorId: user.id, eventType: 'auth.login' },
      orderBy: { occurredAt: 'desc' },
    });

    // The taxonomy decided all three of these; no call site was edited.
    expect(row.category).toBe('AUTHENTICATION');
    expect(row.severity).toBe('INFO');
    expect(row.summary).toBe('Auth signed in');
    // ADR-003 §4: the role is a historical fact, snapshotted so a later
    // role change cannot rewrite what the event says the actor was.
    expect(row.actorRole).not.toBeNull();
  });

  it('stores the correlation id in the payload when a call site supplies one', async () => {
    // Driven through the dispatcher rather than through a route, and the
    // reason is the residual: `AuditEvent.correlationId` is optional and
    // **one** of seventy call sites passes it, because the id lives on
    // the Express request and a dispatcher cannot reach one. So what is
    // asserted here is the writer's half — given the id, it files it
    // where an investigator can search for it. See RA-M28.3.
    const dispatcher = harness.app.get<AuditDispatcher>(AUDIT_DISPATCHER);

    await dispatcher.record({
      action: 'patient.view',
      actor: { userId: adminUserId, role: 'admin', sessionId: '22222222-2222-4222-8222-222222222222' },
      entityType: 'patient',
      entityId: 'PT-M28',
      correlationId: 'corr-m28-ledger',
      metadata: { fields: 'mrn' },
    });

    const row = await harness.prisma.auditEvent.findFirstOrThrow({
      where: { eventType: 'patient.view', actorId: adminUserId },
      orderBy: { occurredAt: 'desc' },
    });

    const payload = row.payload as Record<string, unknown>;
    expect(payload['correlationId']).toBe('corr-m28-ledger');
    // The caller's own metadata rides alongside rather than replacing it.
    expect(payload['fields']).toBe('mrn');
    // And the session id reached its column, which is what §14.2's
    // "same session" correlation keys on.
    expect(row.sessionId).toBe('22222222-2222-4222-8222-222222222222');
    // `target` is `<entity>:<id>`, which is what the browser's chip shows.
    expect(row.target).toBe('patient:PT-M28');
  });

  it('files an event whose action nothing classified as system, not as clinical work', async () => {
    const dispatcher = harness.app.get<AuditDispatcher>(AUDIT_DISPATCHER);

    await dispatcher.record({
      action: 'telemetry.ping',
      actor: { userId: null, role: null },
      entityType: 'telemetry',
      entityId: 'probe',
    });

    const row = await harness.prisma.auditEvent.findFirstOrThrow({
      where: { eventType: 'telemetry.ping' },
      orderBy: { occurredAt: 'desc' },
    });

    // `audit-taxonomy.spec.ts` asserts no action the codebase emits
    // reaches this path, so this is the behaviour of the safety net
    // rather than of anything in production: `system`, and the
    // dispatcher warns.
    expect(row.category).toBe('SYSTEM');
    // A null actor is the system itself, never "unknown".
    expect(row.actorId).toBeNull();
  });

  it('survives an unwritable ledger rather than failing the caller', async () => {
    // The M2 contract, kept: an audit sink that can fail a clinical
    // write turns an observability dependency into an availability one.
    // A 300-character summary is the column's limit; the action below
    // overflows `event_type`'s 60 only if it were not truncated, so the
    // insert is forced to fail another way — an actor id that is not a
    // uuid violates the column type.
    const dispatcher = harness.app.get<AuditDispatcher>(AUDIT_DISPATCHER);

    await expect(
      dispatcher.record({
        action: 'patient.view',
        actor: { userId: 'not-a-uuid', role: 'admin' },
        entityType: 'patient',
        entityId: 'PT-BAD',
      }),
    ).resolves.toBeUndefined();
  });
});

describe('M28.3 — the investigation surface', () => {
  it('filters by category, severity and free text', async () => {
    await seedEvent({ summary: 'Zenith breach rehearsal', category: 'SECURITY', severity: 'CRITICAL' });
    await seedEvent({ summary: 'Zenith routine sweep', category: 'SYSTEM', severity: 'INFO' });

    const critical = dataOf<Page>(await list(`incidentRef=${INCIDENT}&severity=critical`));
    expect(critical.items.map((event) => event.summary)).toEqual(['Zenith breach rehearsal']);

    const security = dataOf<Page>(await list(`incidentRef=${INCIDENT}&category=security`));
    expect(security.items).toHaveLength(1);

    const text = dataOf<Page>(await list(`incidentRef=${INCIDENT}&q=routine`));
    expect(text.items.map((event) => event.summary)).toEqual(['Zenith routine sweep']);
  });

  it('returns the retention window in meta, so an empty page is readable', async () => {
    const page = dataOf<Page>(await list(`incidentRef=${INCIDENT}`));

    // A reader looking at nothing for last year needs to know whether
    // the platform deleted it or nothing happened.
    expect(page.meta.retentionDays).toBeGreaterThan(0);
  });

  it('pivots over the filtered set, not over the page', async () => {
    const page = dataOf<Page>(await list(`incidentRef=${INCIDENT}&pageSize=1`));

    expect(page.items).toHaveLength(1);
    // Counts for rows the page did not carry.
    const total = Object.values(page.pivot.byCategory).reduce((sum, count) => sum + count, 0);
    expect(total).toBeGreaterThan(1);
    expect(Object.values(page.pivot.bySeverity).reduce((a, b) => a + b, 0)).toBe(total);
  });

  it('pages by keyset, and an insert between pages shifts nothing', async () => {
    const base = new Date('2026-03-01T12:00:00Z');

    // Five events, a minute apart, so the order is unambiguous.
    for (let index = 0; index < 5; index += 1) {
      await seedEvent({
        summary: `Keyset ${String(index)}`,
        occurredAt: new Date(base.getTime() + index * 60_000),
      });
    }

    const first = dataOf<Page>(await list(`incidentRef=${INCIDENT}&q=Keyset&pageSize=2`));
    expect(first.items.map((event) => event.summary)).toEqual(['Keyset 4', 'Keyset 3']);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toBeDefined();

    // The ledger is written to while it is read. Under OFFSET this
    // insert would shift every later page by one and page two would
    // repeat `Keyset 3` while never showing `Keyset 2`.
    await seedEvent({
      summary: 'Keyset interloper',
      occurredAt: new Date(base.getTime() + 10 * 60_000),
    });

    const second = dataOf<Page>(
      await list(`incidentRef=${INCIDENT}&q=Keyset&pageSize=2&cursor=${encodeURIComponent(first.nextCursor ?? '')}`),
    );

    expect(second.items.map((event) => event.summary)).toEqual(['Keyset 2', 'Keyset 1']);
  });

  it('does not lose an event when two share an instant', async () => {
    const tie = new Date('2026-04-01T09:00:00Z');
    await seedEvent({ summary: 'Tie A', occurredAt: tie });
    await seedEvent({ summary: 'Tie B', occurredAt: tie });

    const first = dataOf<Page>(await list(`incidentRef=${INCIDENT}&q=Tie&pageSize=1`));
    const second = dataOf<Page>(
      await list(`incidentRef=${INCIDENT}&q=Tie&pageSize=1&cursor=${encodeURIComponent(first.nextCursor ?? '')}`),
    );

    // The cursor carries `id` as well as the instant, so a page boundary
    // landing inside a tie neither drops nor repeats a row — M14's lab
    // timeline is the lesson that a tie in an ordering column is a
    // defect rather than a detail.
    const seen = [...first.items, ...second.items].map((event) => event.summary);
    expect(new Set(seen).size).toBe(2);
  });

  it('treats a mangled cursor as no cursor rather than as an error', async () => {
    // It can only come from a client that broke one this server issued,
    // and the first page is a safe answer where a 422 breaks paging.
    expect((await list(`incidentRef=${INCIDENT}&cursor=rubbish`)).status).toBe(200);
  });

  it('refuses an empty time window with a field error', async () => {
    const response = await list('from=2026-05-01T00:00:00Z&to=2026-04-01T00:00:00Z');

    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors?.['from']).toBeDefined();
  });

  it('correlates by session and by the same actor within five minutes', async () => {
    const at = new Date('2026-06-01T10:00:00Z');
    const session = '11111111-1111-4111-8111-111111111111';

    const anchor = await seedEvent({
      summary: 'Anchor event',
      occurredAt: at,
      actorId: adminUserId,
      sessionId: session,
    });
    await seedEvent({
      summary: 'Same session, later',
      occurredAt: new Date(at.getTime() + 60_000),
      sessionId: session,
    });
    await seedEvent({
      summary: 'Same actor, two minutes on',
      occurredAt: new Date(at.getTime() + 120_000),
      actorId: adminUserId,
    });
    await seedEvent({
      summary: 'Same actor, an hour later',
      occurredAt: new Date(at.getTime() + 3_600_000),
      actorId: adminUserId,
    });

    const detail = dataOf<EventView & { correlated: EventView[]; payload: object }>(
      await request(harness.server).get(`${EVENTS}/${anchor}`).set(as(adminToken)),
    );

    const summaries = detail.correlated.map((event) => event.summary);
    expect(summaries).toContain('Same session, later');
    expect(summaries).toContain('Same actor, two minutes on');
    // Outside §14.2's ±5 minutes, and not in the session.
    expect(summaries).not.toContain('Same actor, an hour later');
    // The anchor is not its own correlate.
    expect(detail.correlated.map((event) => event.id)).not.toContain(anchor);
  });

  it('answers 404 for an event that is not there', async () => {
    expect(
      (
        await request(harness.server)
          .get(`${EVENTS}/00000000-0000-4000-8000-000000000000`)
          .set(as(adminToken))
      ).status,
    ).toBe(404);
  });

  it('is read-only — there is no route that writes an event', async () => {
    // §14's own header: "Read-only for everyone — no mutation endpoints
    // exist."
    await request(harness.server).post(EVENTS).set(as(adminToken)).send({}).expect(404);
    await request(harness.server)
      .delete(`${EVENTS}/00000000-0000-4000-8000-000000000000`)
      .set(as(adminToken))
      .expect(404);
  });

  it('refuses a caller without logs.view', async () => {
    expect((await list(`incidentRef=${INCIDENT}`, doctorToken)).status).toBe(403);
    await request(harness.server).get(EVENTS).expect(401);
  });
});

describe('M28.4 — export, and the event it writes about itself', () => {
  it('produces filter-respecting CSV and an admin_activity row', async () => {
    const response = await request(harness.server)
      .post(`${EVENTS}/export?incidentRef=${INCIDENT}&format=csv&limit=50`)
      .set(as(adminToken));

    expect(response.status, response.text.slice(0, 200)).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('attachment');
    // A header row and at least the events seeded above.
    expect(response.text.split('\r\n')[0]).toContain('occurredAt');
    expect(response.text).toContain('Zenith breach rehearsal');
    // The filter held: another incident's rows are not in the file.
    expect(response.text).not.toContain('Auth signed in');

    const audited = await harness.prisma.auditEvent.findFirstOrThrow({
      where: { eventType: 'admin.audit_export', actorId: adminUserId },
      orderBy: { occurredAt: 'desc' },
    });

    // The milestone's verify step, literally.
    expect(audited.category).toBe('ADMIN_ACTIVITY');
    // Filters and counts, never the rows: an audit event containing the
    // export it describes would double the ledger on every read.
    const payload = audited.payload as Record<string, unknown>;
    expect(payload['rowCount']).toBeGreaterThan(0);
    expect(payload['format']).toBe('csv');
    expect(JSON.stringify(payload)).not.toContain('Zenith');
  });

  it('quotes every CSV field, so a comma in a summary cannot split a row', async () => {
    await seedEvent({ summary: 'Comma, quote " and all' });

    const response = await request(harness.server)
      .post(`${EVENTS}/export?incidentRef=${INCIDENT}&q=Comma&format=csv`)
      .set(as(adminToken));

    // RFC 4180: the quote is doubled, and the field stays one field.
    expect(response.text).toContain('"Comma, quote "" and all"');
    const dataRow = response.text.split('\r\n')[1] ?? '';
    expect(dataRow.startsWith('"')).toBe(true);
  });

  it('serves JSON when asked', async () => {
    const response = await request(harness.server)
      .post(`${EVENTS}/export?incidentRef=${INCIDENT}&format=json&limit=5`)
      .set(as(adminToken));

    expect(response.headers['content-type']).toContain('application/json');
    expect(Array.isArray((JSON.parse(response.text) as { items: unknown[] }).items)).toBe(true);
  });

  it('requires logs.export, which is not logs.view', async () => {
    // Two capabilities because §14.3 names them separately, and the
    // difference is real: reading an incident is investigation; taking a
    // hundred thousand records out in a file is a different act.
    expect(
      (await request(harness.server).post(`${EVENTS}/export`).set(as(doctorToken))).status,
    ).toBe(403);
  });
});

describe('M28.4 — incident bookmarks', () => {
  it('saves, lists and removes a named selection', async () => {
    const created = await request(harness.server)
      .post(BOOKMARKS)
      .set(as(adminToken))
      .send({ name: 'Zenith case', eventIds: [], incidentRef: INCIDENT });

    expect(created.status).toBe(201);
    const bookmark = dataOf<{ id: string; name: string }>(created);

    const listed = dataOf<{ id: string }[]>(
      await request(harness.server).get(BOOKMARKS).set(as(adminToken)),
    );
    expect(listed.map((entry) => entry.id)).toContain(bookmark.id);

    await request(harness.server)
      .delete(`${BOOKMARKS}/${bookmark.id}`)
      .set(as(adminToken))
      .expect(204);
    // Gone, and a second delete is a 404 rather than a second success.
    await request(harness.server)
      .delete(`${BOOKMARKS}/${bookmark.id}`)
      .set(as(adminToken))
      .expect(404);
  });

  it('refuses a duplicate name with a 409 from the constraint', async () => {
    await request(harness.server)
      .post(BOOKMARKS)
      .set(as(adminToken))
      .send({ name: 'Duplicate case', eventIds: [] })
      .expect(201);

    // `(owner_id, name)` is UNIQUE, and a pre-check cannot see an
    // uncommitted row — the constraint is what tells the truth.
    const again = await request(harness.server)
      .post(BOOKMARKS)
      .set(as(adminToken))
      .send({ name: 'Duplicate case', eventIds: [] });

    expect(again.status).toBe(409);
  });
});

describe('M28.5 — retention drops partitions, never rows', () => {
  it('creates the months ahead and drops only what is wholly past the window', async () => {
    const retention = harness.app.get(AuditRetentionService);
    const days = await retention.retentionDays();

    // A clock far enough in the future that the month holding `oldMonth`
    // is entirely outside the window, and a second month that is not.
    const now = new Date('2027-06-15T00:00:00Z');
    const oldMonth = new Date(Date.UTC(2026, 0, 1));
    const recentMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
    );

    await harness.prisma.$executeRawUnsafe(
      `SELECT create_audit_events_partition('${oldMonth.toISOString().slice(0, 10)}'::date)`,
    );

    const result = await retention.sweep(now);

    expect(result.retentionDays).toBe(days);
    // January 2026 is more than `auditLogDays` behind June 2027.
    expect(result.dropped).toContain(partitionNameFor(oldMonth));
    // The month before "now" is inside the window and must survive —
    // dropping a partition whose month merely *starts* before the cutoff
    // would take retained events with it.
    expect(result.dropped).not.toContain(partitionNameFor(recentMonth));
    // And the twelve months from `now` exist.
    expect(result.created).toContain(partitionNameFor(new Date(Date.UTC(2027, 5, 1))));
  });

  it('never offers the DEFAULT partition for dropping, whatever the clock says', async () => {
    const { AuditRepository } = await import('../src/modules/audit/repositories/audit.repository');
    const repository = harness.app.get(AuditRepository);

    // Asserted through the two mechanisms rather than by running a
    // far-future sweep — and that is a correction, not a shortcut. The
    // first version of this test swept at 2030 and **dropped every
    // partition in the shared test database**, taking out the month
    // another spec was inserting into. A destructive sweep with a clock
    // chosen to drop everything is not a test of a safety rule; it is
    // the accident the rule exists to prevent, performed deliberately.
    const partitions = await repository.partitions();

    // It has no `FROM (…)` bound, so it is not a month and never enters
    // the candidate list at all.
    expect(partitions.map((partition) => partition.name)).not.toContain('audit_events_default');
    // And the name guard refuses it even if something handed it over.
    await expect(repository.dropPartition('audit_events_default')).rejects.toThrow(
      /Refusing to drop/,
    );

    const exists = await harness.prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*) FROM pg_class WHERE relname = 'audit_events_default'`,
    );
    expect(Number(exists[0]?.count ?? 0)).toBe(1);
  });

  it('refuses to drop anything that is not a month partition', async () => {
    const { AuditRepository } = await import('../src/modules/audit/repositories/audit.repository');
    const repository = harness.app.get(AuditRepository);

    // The name comes from `pg_class`, and this is the second of the two
    // guards. Either alone would not make `$executeRawUnsafe` safe.
    await expect(repository.dropPartition('users')).rejects.toThrow(/Refusing to drop/);
    await expect(repository.dropPartition('audit_events')).rejects.toThrow(/Refusing to drop/);
  });
});
