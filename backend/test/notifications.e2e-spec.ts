import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  registrationBody,
  testEmail,
  tokenFromLink,
} from './support/auth-app';
import {
  createPatientRecords,
  destroyPatientRecords,
  type PatientRecord,
} from './support/patient-fixture';
import { body as mailBody } from './support/smtp-sink';

/**
 * The notification feed — API §10.1–10.4.
 *
 * ## One model, exercised from a patient account
 *
 * `notifications.recipient_id → users.id`, and ADR-030 made patients
 * users — so a patient became a valid recipient with no schema change and
 * no parallel route tree. API §10 marks these routes `✓` (any
 * authenticated user), and these tests hold that literally: the same
 * routes are exercised as a patient **and** as a doctor, and both are
 * scoped to themselves.
 *
 * ## The properties under test
 *
 * Isolation on reads *and on writes*. A mark-read route implemented with
 * `update` by id would throw a distinguishable error for someone else's
 * row and become an enumeration oracle; the scoped `updateMany` makes
 * "not yours" and "no such row" the same 404, and that is asserted here
 * rather than assumed.
 *
 * `notifications` cascade from `users`, so `harness.reset()` removes
 * everything this suite creates — no cross-suite cleanup is needed.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const VERIFY = '/api/v1/auth/verify-email';
const FEED = '/api/v1/notifications';
const BADGES = '/api/v1/notifications/badge-counts';
const PASSWORD = 'Medora123!';

interface Session {
  readonly token: string;
  readonly userId: string;
}

/**
 * This file's own clinical record (RA-M10.1).
 *
 * The one test that needs a `patients` row used to take whichever row
 * `findFirstOrThrow()` returned — which under a parallel full-suite run
 * is as likely to be another spec file's fixture as a seeded demo
 * record, and that file may delete it between this lookup and the
 * assertions that read its `mrn`. `support/patient-fixture.ts` is the
 * rule; this brings the last borrower in this file under it.
 */
let records: PatientRecord[];
const PATIENT_TAG = 'notif';

beforeAll(async () => {
  harness = await createAuthHarness('notifications');
  records = await createPatientRecords(harness.prisma, PATIENT_TAG, 1);
});

afterAll(async () => {
  await destroyPatientRecords(harness.prisma, PATIENT_TAG);
  await harness.reset();
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
});

async function signUp(local: string, role = 'patient'): Promise<Session> {
  const email = testEmail(local);

  await request(harness.server)
    .post(REGISTER)
    .send(registrationBody({ email, role }))
    .expect(201);

  await request(harness.server)
    .post(VERIFY)
    .send({ token: tokenFromLink(mailBody(harness.sink.lastTo(email)!)) })
    .expect(204);

  const login = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD })
    .expect(200);

  const row = await harness.prisma.user.findUniqueOrThrow({ where: { email } });

  return { token: dataOf<{ accessToken: string }>(login).accessToken, userId: row.id };
}

async function notify(
  session: Session,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const row = await harness.prisma.db.notification.create({
    data: {
      recipientId: session.userId,
      title: 'Appointment confirmed',
      body: 'Your appointment has been confirmed.',
      category: 'APPOINTMENTS',
      priority: 'NORMAL',
      kind: 'UPDATE',
      sender: 'Medora Clinic',
      ...overrides,
    },
    select: { id: true },
  });

  return row.id;
}

describe('GET /notifications', () => {
  it('refuses an unauthenticated request', async () => {
    await request(harness.server).get(FEED).expect(401);
  });

  it('returns the caller’s own feed in the paginated envelope', async () => {
    const session = await signUp('sara');
    const id = await notify(session);

    const response = await request(harness.server)
      .get(FEED)
      .set('Authorization', `Bearer ${session.token}`)
      .expect(200);

    const page = dataOf<{
      items: { id: string; category: string; readAt: string | null }[];
      page: number;
      pageSize: number;
      totalItems: number;
      totalPages: number;
    }>(response);

    expect(page.items.map((i) => i.id)).toEqual([id]);
    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(20);
    expect(page.totalItems).toBe(1);
    expect(page.items[0]!.readAt).toBeNull();
    // ADR-023: the wire vocabulary, not the Prisma member name.
    expect(page.items[0]!.category).toBe('appointments');
  });

  it('never shows one user another user’s notifications', async () => {
    const mine = await signUp('sara');
    const theirs = await signUp('omar');

    const mineId = await notify(mine);
    const theirsId = await notify(theirs, { title: 'Not for you' });

    const response = await request(harness.server)
      .get(`${FEED}?pageSize=100`)
      .set('Authorization', `Bearer ${mine.token}`)
      .expect(200);

    const ids = dataOf<{ items: { id: string }[] }>(response).items.map((i) => i.id);

    expect(ids).toContain(mineId);
    expect(ids).not.toContain(theirsId);
    expect(JSON.stringify(response.body)).not.toContain('Not for you');
  });

  it('serves a doctor from the same route, scoped to themselves', async () => {
    // API §10 is `✓` — any authenticated user. One model, one code path.
    const patient = await signUp('sara');
    const doctor = await signUp('amelia', 'doctor');

    const patientNote = await notify(patient);
    const doctorNote = await notify(doctor, { title: 'Critical lab result' });

    const response = await request(harness.server)
      .get(`${FEED}?pageSize=100`)
      .set('Authorization', `Bearer ${doctor.token}`)
      .expect(200);

    const ids = dataOf<{ items: { id: string }[] }>(response).items.map((i) => i.id);

    expect(ids).toContain(doctorNote);
    expect(ids).not.toContain(patientNote);
  });

  it('filters by status, category and priority', async () => {
    const session = await signUp('sara');
    const unread = await notify(session);
    const read = await notify(session, { readAt: new Date(), title: 'Already read' });
    const lab = await notify(session, { category: 'LABORATORY', priority: 'CRITICAL' });

    const unreadPage = await request(harness.server)
      .get(`${FEED}?status=unread&pageSize=100`)
      .set('Authorization', `Bearer ${session.token}`)
      .expect(200);
    const unreadIds = dataOf<{ items: { id: string }[] }>(unreadPage).items.map((i) => i.id);
    expect(unreadIds).toContain(unread);
    expect(unreadIds).not.toContain(read);

    const readPage = await request(harness.server)
      .get(`${FEED}?status=read&pageSize=100`)
      .set('Authorization', `Bearer ${session.token}`)
      .expect(200);
    expect(dataOf<{ items: { id: string }[] }>(readPage).items.map((i) => i.id)).toEqual([read]);

    const labPage = await request(harness.server)
      .get(`${FEED}?category=laboratory&priority=critical&pageSize=100`)
      .set('Authorization', `Bearer ${session.token}`)
      .expect(200);
    expect(dataOf<{ items: { id: string }[] }>(labPage).items.map((i) => i.id)).toEqual([lab]);
  });

  it('rejects a category outside the vocabulary and an over-cap pageSize', async () => {
    const session = await signUp('sara');

    // `medical_records` is the Prisma spelling; the wire says
    // `medical-records`. The enum must reject the wrong one.
    await request(harness.server)
      .get(`${FEED}?category=medical_records`)
      .set('Authorization', `Bearer ${session.token}`)
      .expect(422);

    await request(harness.server)
      .get(`${FEED}?pageSize=5000`)
      .set('Authorization', `Bearer ${session.token}`)
      .expect(422);
  });

  it('sorts pinned first, then newest', async () => {
    const session = await signUp('sara');
    const old = await notify(session, { createdAt: new Date('2026-01-01T00:00:00Z') });
    const recent = await notify(session, { createdAt: new Date('2026-08-01T00:00:00Z') });
    const pinned = await notify(session, {
      pinned: true,
      createdAt: new Date('2025-01-01T00:00:00Z'),
    });

    const response = await request(harness.server)
      .get(`${FEED}?pageSize=100`)
      .set('Authorization', `Bearer ${session.token}`)
      .expect(200);

    const ids = dataOf<{ items: { id: string }[] }>(response).items.map((i) => i.id);

    expect(ids).toEqual([pinned, recent, old]);
  });

  it('projects related ids but no linked content', async () => {
    // A notification announcing a result must not become a way to read
    // one — that is ADR-031's decision, not a notification body's.
    const session = await signUp('sara');
    const patient = await harness.prisma.db.patient.findUniqueOrThrow({
      where: { id: records[0]!.id },
    });
    await notify(session, { patientId: patient.id, category: 'LABORATORY' });

    const response = await request(harness.server)
      .get(FEED)
      .set('Authorization', `Bearer ${session.token}`)
      .expect(200);

    const page = dataOf<{ items: { related: Record<string, string | null> }[] }>(response);
    const raw = JSON.stringify(response.body);

    expect(page.items[0]!.related.patientId).toBe(patient.id);
    expect(page.items[0]!.related.recordId).toBeNull();
    // The linked patient's own PHI must not ride along.
    expect(raw).not.toContain(patient.mrn);
    expect(raw).not.toContain(patient.fullName);
  });
});

describe('read state (API §10.2, §10.3)', () => {
  it('marks one notification read, and is idempotent on a retry', async () => {
    // The client is optimistic and rolls back on failure, so a retry
    // after a flaky connection must not error and cause a correct state
    // to be rolled back.
    const session = await signUp('sara');
    const id = await notify(session);

    await request(harness.server)
      .post(`${FEED}/${id}/read`)
      .set('Authorization', `Bearer ${session.token}`)
      .expect(204);

    await request(harness.server)
      .post(`${FEED}/${id}/read`)
      .set('Authorization', `Bearer ${session.token}`)
      .expect(204);

    const row = await harness.prisma.db.notification.findUniqueOrThrow({ where: { id } });
    expect(row.readAt).not.toBeNull();
  });

  it('marks a notification unread again', async () => {
    const session = await signUp('sara');
    const id = await notify(session, { readAt: new Date() });

    await request(harness.server)
      .post(`${FEED}/${id}/unread`)
      .set('Authorization', `Bearer ${session.token}`)
      .expect(204);

    const row = await harness.prisma.db.notification.findUniqueOrThrow({ where: { id } });
    expect(row.readAt).toBeNull();
  });

  it('cannot mark another user’s notification read — 404, and it stays unread', async () => {
    // The write-path isolation test. An implementation using `update` by
    // id would answer differently for "exists but not yours" than for
    // "does not exist", turning this route into an enumeration oracle.
    const mine = await signUp('sara');
    const theirs = await signUp('omar');
    const theirsId = await notify(theirs);

    await request(harness.server)
      .post(`${FEED}/${theirsId}/read`)
      .set('Authorization', `Bearer ${mine.token}`)
      .expect(404);

    const row = await harness.prisma.db.notification.findUniqueOrThrow({ where: { id: theirsId } });
    expect(row.readAt).toBeNull();
  });

  it('answers 404 identically for an id that does not exist', async () => {
    const session = await signUp('sara');

    await request(harness.server)
      .post(`${FEED}/00000000-0000-4000-8000-000000000000/read`)
      .set('Authorization', `Bearer ${session.token}`)
      .expect(404);

    // A malformed id must not reach Postgres as a uuid literal, which
    // would turn a legitimate 404 into a 500.
    await request(harness.server)
      .post(`${FEED}/not-a-uuid/read`)
      .set('Authorization', `Bearer ${session.token}`)
      .expect(404);
  });

  it('marks all read for the caller only', async () => {
    const mine = await signUp('sara');
    const theirs = await signUp('omar');

    await notify(mine);
    await notify(mine);
    const theirsId = await notify(theirs);

    const response = await request(harness.server)
      .post(`${FEED}/read-all`)
      .set('Authorization', `Bearer ${mine.token}`)
      .expect(200);

    expect(dataOf<{ updated: number }>(response).updated).toBe(2);

    const untouched = await harness.prisma.db.notification.findUniqueOrThrow({
      where: { id: theirsId },
    });
    expect(untouched.readAt).toBeNull();
  });
});

describe('GET /notifications/badge-counts (API §10.4)', () => {
  it('counts only the caller’s unread notifications', async () => {
    const mine = await signUp('sara');
    const theirs = await signUp('omar');

    await notify(mine);
    await notify(mine);
    await notify(mine, { readAt: new Date() });
    await notify(theirs);

    const response = await request(harness.server)
      .get(BADGES)
      .set('Authorization', `Bearer ${mine.token}`)
      .expect(200);

    expect(dataOf<{ notifications: number; messages: number }>(response)).toEqual({
      notifications: 2,
      messages: 0,
    });
  });

  it('is not shadowed by the :notificationId route', async () => {
    // Nest matches in declaration order: a `:notificationId` route above
    // `badge-counts` would capture it as an id and 404 the poll target.
    const session = await signUp('sara');

    const response = await request(harness.server)
      .get(BADGES)
      .set('Authorization', `Bearer ${session.token}`)
      .expect(200);

    expect(dataOf<{ notifications: number }>(response).notifications).toBe(0);
  });

  it('refuses an unauthenticated request', async () => {
    await request(harness.server).get(BADGES).expect(401);
  });
});
