import { Secret, TOTP } from 'otpauth';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { NotificationDispatchService } from '../src/modules/notifications/services/notification-dispatch.service';
import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  markVerified,
  registrationBody,
  testEmail,
  makeClinicalDoctor,
  asJob,
  fixtureHospital,
} from './support/auth-app';
import {
  acquireDeliveryWorkerLock,
  DELIVERY_WORKER_LOCK_TIMEOUT_MS,
  type DeliveryWorkerLock,
} from './support/delivery-worker-lock';
import { destroyLabFixtures } from './support/lab-fixture';

/**
 * The record-issue queue — API §6.9 "flag data error → admin queue",
 * RM M12.7: "✅ Verify: report creates a queue row + admin notification".
 *
 * M12.7 shipped the row and left both other halves open — the admin
 * notification (M19's consumer) and the queue endpoint (M23). This file
 * proves the whole loop over HTTP: a doctor reports, every administrator
 * is notified with a pointer that carries no clinical text, the queue
 * lists the item with the patient masked to a handle, and an
 * administrator works it through a guarded, race-safe lifecycle.
 *
 * ## Owning its events
 *
 * `drain()` is process-wide and claims the oldest pending events, so this
 * suite drains until **its own** event is no longer pending rather than
 * asserting a global count, and asserts only on its own administrator's
 * feed. `notification-fanout.e2e-spec.ts` spares this topic from its
 * outbox clean-up, as its header asks of any suite that asserts on
 * `domain_events`.
 */
let harness: AuthHarness;
let dispatch: NotificationDispatchService;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const PATIENTS = '/api/v1/patients';
const RECORDS = '/api/v1/medical-records';
const QUEUE = '/api/v1/admin/record-issues';
const PASSWORD = 'Medora123!';
const TOPIC = 'medical_record.issue_reported';

interface IssueView {
  id: string;
  status: string;
  description: string;
  record: { id: string; status: string; visitDate: string; department: string | null };
  patientId: string;
  reportedBy: { id: string; name: string } | null;
  reportedAt: string;
  resolvedBy: { id: string; name: string } | null;
  resolvedAt: string | null;
  availableActions: string[];
}

let doctorToken = '';
let adminToken = '';
let adminUserId = '';
let patientId = '';
let recordId = '';
const charts: string[] = [];

function currentCode(secret: string): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

async function seedDoctor(local: string): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  // Clinical standing at the fixture hospital (§2.6).
  await makeClinicalDoctor(harness.prisma, email);

  return dataOf<{ accessToken: string }>(
    await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;
}

async function seedAdmin(local: string): Promise<{ token: string; userId: string }> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  const bootstrap = dataOf<{ accessToken: string }>(
    await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;
  const secret = dataOf<{ secret: string }>(
    await request(harness.server)
      .post('/api/v1/me/2fa/setup')
      .set('Authorization', `Bearer ${bootstrap}`)
      .send({ password: PASSWORD }),
  ).secret;
  await request(harness.server)
    .post('/api/v1/me/2fa/enable')
    .set('Authorization', `Bearer ${bootstrap}`)
    .send({ code: currentCode(secret) });

  const adminRole = await harness.prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });
  const admin = await harness.prisma.user.update({
    where: { email },
    data: { roleId: adminRole.id },
    select: { id: true },
  });
  // Record quality review is a hospital function (F-01, OD-07): the
  // fixture hospital's own Hospital Admin, where the records are.
  await harness.prisma.hospitalRoleAssignment.create({
    data: { userId: admin.id, hospitalId: await fixtureHospital(harness.prisma), roleId: adminRole.id },
  });
  await harness.prisma.doctor.deleteMany({ where: { user: { email } } });

  const login = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });
  const verified = await request(harness.server)
    .post('/api/v1/auth/otp/verify')
    .send({ otpToken: dataOf<{ otpToken: string }>(login).otpToken, code: currentCode(secret) });

  const user = await harness.prisma.user.findUniqueOrThrow({ where: { email } });

  return { token: dataOf<{ accessToken: string }>(verified).accessToken, userId: user.id };
}

/**
 * Files a report. Its outbox event is removed unless the test is about the
 * event: every drain in the run fans an issue out to **every** active
 * administrator in the shared database, and a dozen reports nobody asserts
 * on would put a dozen notifications per administrator — and their
 * delivery rows — in front of the suites that drain and deliver.
 */
async function report(description: string, keepEvent = false): Promise<string> {
  const response = await request(harness.server)
    .post(`${RECORDS}/${recordId}/report-issue`)
    .set('Authorization', `Bearer ${doctorToken}`)
    .send({ description });

  expect(response.status).toBe(201);
  const id = dataOf<{ id: string }>(response).id;

  if (!keepEvent) {
    await harness.prisma.domainEvent.deleteMany({
      where: { topic: TOPIC, payload: { path: ['issueId'], equals: id } },
    });
  }

  return id;
}

async function queue(query: Record<string, string> = {}): Promise<IssueView[]> {
  const response = await request(harness.server)
    .get(QUEUE)
    .query({ pageSize: '100', ...query })
    .set('Authorization', `Bearer ${adminToken}`);

  expect(response.status).toBe(200);

  return dataOf<{ items: IssueView[] }>(response).items;
}

function move(token: string, id: string, status: string) {
  return request(harness.server)
    .patch(`${QUEUE}/${id}`)
    .set('Authorization', `Bearer ${token}`)
    .send({ status });
}

/**
 * Drains until this administrator's notification for the record exists.
 *
 * Not "until the event is claimed": another suite's drain may claim it
 * first and still be writing the fan-out when this one looks, and the
 * claim commits before the notifications do. The notification is the
 * thing asserted, so it is the thing waited for.
 */
async function drainUntilNotified(): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const found = await harness.prisma.db.notification.count({
      where: { recipientId: adminUserId, body: { contains: recordId } },
    });
    if (found > 0) return;

    await dispatch.drain();
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error('no notification reached the administrator');
}

/**
 * Excludes the other notification-pipeline specs for this file's whole
 * run — see `support/delivery-worker-lock.ts`. The release is registered
 * before this file's own `afterAll`, so under Vitest's default `stack`
 * hook order it runs last, after this file's cleanup has deleted its rows.
 */
let pipelineLock: DeliveryWorkerLock | undefined;

beforeAll(async () => {
  pipelineLock = await acquireDeliveryWorkerLock();
}, DELIVERY_WORKER_LOCK_TIMEOUT_MS + 10_000);

afterAll(async () => {
  await pipelineLock?.release();
});

beforeAll(async () => {
  harness = await createAuthHarness('record-issue-queue');
  dispatch = asJob(harness.app.get(NotificationDispatchService));

  doctorToken = await seedDoctor('issue-doctor');
  ({ token: adminToken, userId: adminUserId } = await seedAdmin('issue-admin'));

  const patient = await request(harness.server)
    .post(PATIENTS)
    .set('Authorization', `Bearer ${doctorToken}`)
    .send({
      fullName: 'Salma Queue',
      dateOfBirth: '1979-02-03',
      gender: 'female',
      bloodType: 'O+',
      phone: '+20 100 555 0101',
      allergies: [],
      chronicConditions: [],
    });
  expect(patient.status).toBe(201);
  patientId = dataOf<{ id: string }>(patient).id;
  charts.push(patientId);

  const record = await request(harness.server)
    .post(RECORDS)
    .set('Authorization', `Bearer ${doctorToken}`)
    .send({
      patientId,
      visitDate: '2026-09-10T09:00:00.000Z',
      visitType: 'Consultation',
      priority: 'normal',
      chiefComplaint: 'Cough for three days',
      historyOfPresentIllness: 'Dry cough, no fever.',
      physicalExamination: 'Chest clear.',
    });
  expect(record.status).toBe(201);
  recordId = dataOf<{ id: string }>(record).id;
}, 120_000);

afterAll(async () => {
  if (harness === undefined) return;

  await harness.prisma.domainEvent.deleteMany({
    where: { topic: TOPIC, payload: { path: ['recordId'], equals: recordId } },
  });
  await harness.prisma.db.notification.deleteMany({ where: { recipientId: adminUserId } });
  await destroyLabFixtures(harness, charts);
  await harness.reset();
  await harness.close();
});

describe('RM M12.7 verify — a report notifies the administrators', () => {
  it('publishes the issue id and the record reference, never the description', async () => {
    const issueId = await report('DOB-SECRET-TEXT is a day out', true);

    const [event] = await harness.prisma.domainEvent.findMany({
      where: { topic: TOPIC, payload: { path: ['issueId'], equals: issueId } },
    });

    expect(event?.payload).toEqual({ issueId, recordId });
    expect(JSON.stringify(event?.payload)).not.toContain('DOB-SECRET-TEXT');

    await harness.prisma.domainEvent.deleteMany({ where: { id: event?.id ?? '' } });
  });

  it('puts a pointer to the record in every administrator’s feed', async () => {
    await report('The visit type should be follow-up.', true);

    await drainUntilNotified();

    const notifications = await harness.prisma.db.notification.findMany({
      where: { recipientId: adminUserId, title: 'Record data issue reported' },
    });
    const mine = notifications.filter((row) => row.body.includes(recordId));

    expect(mine.length).toBeGreaterThan(0);
    expect(mine[0]?.category).toBe('MEDICAL_RECORDS');
    expect(mine[0]?.body).toBe(`Record ${recordId}`);
    expect(mine[0]?.body).not.toContain('follow-up');
  });
});

describe('GET /admin/record-issues', () => {
  it('lists the report with the record reference and the patient as a handle only', async () => {
    const issueId = await report('Allergy list is missing latex.');

    const item = (await queue({ status: 'open' })).find((row) => row.id === issueId);

    expect(item).toMatchObject({
      status: 'open',
      description: 'Allergy list is missing latex.',
      record: { id: recordId, status: 'draft' },
      patientId,
      resolvedBy: null,
      resolvedAt: null,
      availableActions: ['investigating', 'resolved'],
    });
    expect(item?.reportedBy?.name).toBeTruthy();
    expect(JSON.stringify(item)).not.toContain('Salma Queue');
  });

  it('filters by status and orders oldest first by default', async () => {
    const first = await report('First report.');
    const second = await report('Second report.');

    const open = (await queue({ status: 'open' })).map((row) => row.id);
    expect(open.indexOf(first)).toBeLessThan(open.indexOf(second));

    const newest = (await queue({ status: 'open', sort: 'reportedAt:desc' })).map((row) => row.id);
    expect(newest.indexOf(second)).toBeLessThan(newest.indexOf(first));

    const resolved = (await queue({ status: 'resolved' })).map((row) => row.id);
    expect(resolved).not.toContain(first);
  });

  it('refuses an unknown status filter', async () => {
    const response = await request(harness.server)
      .get(QUEUE)
      .query({ status: 'closed' })
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(422);
  });

  it('is an administrator’s queue: a doctor is refused', async () => {
    const response = await request(harness.server)
      .get(QUEUE)
      .set('Authorization', `Bearer ${doctorToken}`);

    expect(response.status).toBe(403);
  });
});

describe('PATCH /admin/record-issues/{id}', () => {
  it('takes an issue, then resolves it, stamping the resolver and auditing both', async () => {
    const issueId = await report('Wrong department on the visit.');

    const taken = await move(adminToken, issueId, 'investigating');
    expect(taken.status).toBe(200);
    expect(dataOf<IssueView>(taken)).toMatchObject({
      status: 'investigating',
      resolvedBy: null,
      availableActions: ['resolved'],
    });

    const resolved = await move(adminToken, issueId, 'resolved');
    expect(resolved.status).toBe(200);
    const view = dataOf<IssueView>(resolved);
    expect(view.status).toBe('resolved');
    expect(view.resolvedBy?.name).toBeTruthy();
    expect(view.resolvedAt).not.toBeNull();
    expect(view.availableActions).toEqual([]);

    const rows = await harness.prisma.auditEvent.findMany({
      where: { actorId: adminUserId, target: `record_issue:${issueId}` },
    });
    expect(rows.map((row) => row.eventType).sort()).toEqual([
      'record_issue.investigate',
      'record_issue.resolve',
    ]);
    expect(rows.every((row) => row.category === 'ADMIN_ACTIVITY')).toBe(true);
    expect(JSON.stringify(rows.map((row) => row.payload))).not.toContain('Wrong department');
  });

  it('resolves an open issue directly', async () => {
    const issueId = await report('Duplicate diagnosis line.');

    expect((await move(adminToken, issueId, 'resolved')).status).toBe(200);
  });

  it('refuses to move a resolved issue with 409', async () => {
    const issueId = await report('Already handled.');
    await move(adminToken, issueId, 'resolved');

    const again = await move(adminToken, issueId, 'investigating');

    expect(again.status).toBe(409);
    expect(errorBody(again).code).toBe('invalid_status_transition');
  });

  it('lets exactly one of two concurrent takes through', async () => {
    const issueId = await report('Race me.');

    const statuses = (
      await Promise.all([
        move(adminToken, issueId, 'investigating'),
        move(adminToken, issueId, 'investigating'),
      ])
    )
      .map((response) => response.status)
      .sort();

    expect(statuses).toEqual([200, 409]);
  });

  it('refuses reopening as a target, and an unknown id with 404', async () => {
    const issueId = await report('Cannot be reopened.');

    expect((await move(adminToken, issueId, 'open')).status).toBe(422);
    expect(
      (await move(adminToken, '00000000-0000-4000-8000-000000000000', 'resolved')).status,
    ).toBe(404);
    expect((await move(adminToken, 'not-a-uuid', 'resolved')).status).toBe(404);
  });

  it('is refused to a doctor', async () => {
    const issueId = await report('Doctors do not work the queue.');

    expect((await move(doctorToken, issueId, 'resolved')).status).toBe(403);
  });
});
