import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type AuthHarness, createAuthHarness, dataOf, testEmail } from './support/auth-app';
import { assignOwned } from './support/hospital-fixture';
import {
  destroyLabFixtures,
  orderTest,
  post,
  seedDoctor,
  seedPatient,
  specimenBody,
  toProcessing,
} from './support/lab-fixture';

/**
 * The doctor's action queue (RM M15.4 — API §16.2, UX §2.1).
 *
 * > ✅ Verify: each source feeds the queue in a seeded scenario;
 * > response < 200 ms.
 *
 * Both halves of that step are here. The first half is the bulk of the
 * file: each of the four sources UX §2.1 names is driven into existence
 * through the API that owns it — an appointment request, an unreviewed
 * critical result, an unsigned note, a stale thread — and then found in
 * the queue. The second half is the last `describe`.
 *
 * ## What the sort tests do and do not cover
 *
 * The ordering rule has its own unit spec
 * (`action-queue.ordering.spec.ts`), which states the properties over
 * arrangements this file cannot cheaply build. What is asserted *here*
 * is that the rule is actually applied to real rows — a pure function
 * that sorts correctly and is never called is the failure a unit test
 * alone cannot see.
 *
 * ## The messaging source
 *
 * Its rows are inserted directly, because **M20 owns the messaging
 * feature** and no route writes `conversations` or `messages` yet. That
 * is the honest state of the source rather than a shortcut: the query
 * is written against the M5.9 schema and these cases prove it answers
 * correctly, so M20 inherits a working queue rather than a fourth
 * source still to wire. An INSERT here is not working around a
 * transition — there is no state machine on a message.
 */
let harness: AuthHarness;

const QUEUE = '/api/v1/dashboard/doctor/action-queue';
const RECORDS = '/api/v1/medical-records';

interface QueueItem {
  id: string;
  kind: string;
  urgency: string;
  label: string;
  patient: { id: string; name: string } | null;
  waitingSince: string;
  ageHours: number;
}

interface QueueView {
  items: QueueItem[];
  counts: {
    appointmentRequests: number;
    criticalLabs: number;
    unsignedNotes: number;
    staleMessages: number;
  };
  totalItems: number;
  truncated: boolean;
}

const charts: string[] = [];
const conversations: string[] = [];

function queue(token: string): request.Test {
  return request(harness.server).get(QUEUE).set('Authorization', `Bearer ${token}`);
}

async function readQueue(token: string): Promise<QueueView> {
  return dataOf<QueueView>(await queue(token).expect(200));
}

/**
 * A logged-in doctor, remembering the **uuid** behind the account.
 *
 * `/me/profile` answers `account.id` as the `usr_…` public handle
 * (`SessionUser.id`) — what a client shows, and not what a foreign key
 * refers to. The two ids are deliberately separate (`AuthenticatedUser`'s
 * own header says so), and conflating them is how a `usr_…` string ends
 * up in a `WHERE id =`. The fixtures below insert rows directly and so
 * need the uuid; it is read from the row by address once, here, rather
 * than re-derived at each call site.
 */
const doctorUserIds = new Map<string, string>();

async function seedQueueDoctor(local: string): Promise<string> {
  const token = await seedDoctor(harness, local);
  const user = await harness.prisma.user.findFirstOrThrow({
    where: { email: testEmail(local) },
    select: { id: true },
  });

  doctorUserIds.set(token, user.id);

  return token;
}

/** The other end of every seeded thread. See `seedStaleThread`. */
let counterpartUserId = '';

function userIdFor(token: string): string {
  const userId = doctorUserIds.get(token);
  if (userId === undefined) throw new Error('Seed the doctor with seedQueueDoctor().');

  return userId;
}

/**
 * A request in `pending`, inserted rather than booked.
 *
 * There is no API path to `pending`: it is the state a patient's request
 * arrives in, and the patient-side booking route does not exist yet.
 * `appointments-oversight.e2e-spec.ts` records the same reasoning — an
 * INSERT is not a transition, so the M5.10 trigger is not being worked
 * around.
 */
/**
 * Each seeded request takes its own half-hour slot. `pending` occupies a
 * slot (`LIVE_STATUSES`), and two in the same slot for one doctor are a
 * double booking that `appointments_no_overlap` refuses (DR-11).
 */
let nextSlot = 0;

async function seedPendingRequest(
  token: string,
  patientPublicId: string,
  overrides: { priority?: 'URGENT' | 'NORMAL'; createdAt?: Date } = {},
): Promise<string> {
  const doctor = await harness.prisma.doctor.findFirstOrThrow({
    where: { userId: userIdFor(token) },
    select: { id: true, departmentId: true },
  });
  const patient = await harness.prisma.patient.findUniqueOrThrow({
    where: { publicId: patientPublicId },
    select: { id: true },
  });
  const visitType = await harness.prisma.visitType.findUniqueOrThrow({
    where: { name: 'Consultation' },
    select: { id: true },
  });

  const sequence = await harness.prisma.$queryRaw<Array<{ value: bigint }>>`
    SELECT nextval('appointment_reference_seq') AS value
  `;
  const publicId = `APT-${String(sequence[0]?.value ?? 0n)}`;

  await harness.prisma.appointment.create({
    data: {
      publicId,
      patientId: patient.id,
      doctorId: doctor.id,
      departmentId: doctor.departmentId,
      visitTypeId: visitType.id,
      startsAt: new Date(Date.parse('2026-12-01T10:00:00.000Z') + nextSlot++ * 30 * 60_000),
      durationMin: 30,
      status: 'PENDING',
      priority: overrides.priority ?? 'NORMAL',
      reason: 'Requested by the patient',
      // Owned by the doctor's hospital (S4): the queue is that hospital's.
      ...(await assignOwned(harness.prisma, { doctorId: doctor.id, patientId: patient.id })),
      ...(overrides.createdAt === undefined ? {} : { createdAt: overrides.createdAt }),
    },
  });

  return publicId;
}

/** An order released with a potassium of 7.2 — `critical-high` (M14.4). */
async function seedCriticalLab(token: string, patientPublicId: string): Promise<string> {
  const order = await orderTest(harness, token, patientPublicId);
  await toProcessing(harness, token, order.id, specimenBody());

  await post(harness, token, `/${order.id}/results`, {
    results: [{ analyte: 'Potassium', value: '7.2', unit: 'mmol/L' }],
  }).expect(200);

  await post(harness, token, `/${order.id}/transition`, { to: 'completed' }).expect(200);

  return order.id;
}

/** A record carrying one unsigned note by this doctor (M12.4). */
async function seedUnsignedNote(
  token: string,
  patientPublicId: string,
  title = 'Consultation note',
): Promise<string> {
  const recordId = dataOf<{ id: string }>(
    await request(harness.server)
      .post(RECORDS)
      .set('Authorization', `Bearer ${token}`)
      .send({
        patientId: patientPublicId,
        visitDate: '2026-09-10T09:00:00.000Z',
        visitType: 'Consultation',
        priority: 'normal',
        chiefComplaint: 'Hypertension review',
        historyOfPresentIllness: 'Stable on current therapy.',
        physicalExamination: 'BP 128/78. No oedema.',
      })
      .expect(201),
  ).id;

  await request(harness.server)
    .post(`${RECORDS}/${recordId}/notes`)
    .set('Authorization', `Bearer ${token}`)
    .send({ title, body: 'Reviewed and stable; continue current dose.' })
    .expect(201);

  return recordId;
}

/**
 * A thread whose last word was the patient's, `hoursAgo` hours back.
 *
 * Inserted directly — M20 owns the messaging routes. See the file
 * header.
 */
async function seedStaleThread(
  token: string,
  options: { hoursAgo: number; lastAuthor: 'other' | 'me'; archived?: boolean; topic?: string },
): Promise<string> {
  const doctorUserId = userIdFor(token);
  const at = new Date(Date.now() - options.hoursAgo * 60 * 60 * 1000);

  // The counterpart, and it is **this suite's own**. A real thread has
  // two participants and the "unanswered" rule is about which of them
  // spoke last, so a single-participant fixture would not exercise the
  // predicate — but taking "any other user" from the table is a read of
  // shared state that Vitest runs other files against in parallel. The
  // account it picked could be deleted between this query and the insert
  // below, and the failure lands here as a foreign-key violation on a
  // row this file did nothing wrong to create. `counterpartUserId` is
  // seeded in `beforeAll` inside this harness's own email domain, so
  // only this file's own teardown can remove it.
  const other = { id: counterpartUserId };

  const conversation = await harness.prisma.conversation.create({
    data: {
      topic: options.topic ?? 'Follow-up question',
      lastActivityAt: at,
      participants: {
        create: [
          { userId: doctorUserId, archived: options.archived ?? false },
          { userId: other.id },
        ],
      },
      messages: {
        create: [
          {
            authorId: options.lastAuthor === 'me' ? doctorUserId : other.id,
            body: 'Is it safe to keep taking this with the new tablet?',
            sentAt: at,
          },
        ],
      },
    },
    select: { id: true },
  });

  conversations.push(conversation.id);

  return conversation.id;
}

function kinds(view: QueueView): string[] {
  return view.items.map((item) => item.kind);
}

beforeAll(async () => {
  harness = await createAuthHarness('action-queue', { clinicalDoctors: true });
  // The stale-thread counterpart — see `seedStaleThread`.
  counterpartUserId = userIdFor(await seedQueueDoctor('queue-counterpart'));
}, 60_000);

afterAll(async () => {
  if (harness === undefined) return;

  if (conversations.length > 0) {
    // `messages` and `conversation_participants` CASCADE from the
    // thread, so the thread is the only row to name.
    await harness.prisma.conversation.deleteMany({ where: { id: { in: conversations } } });
  }

  if (charts.length > 0) {
    await harness.prisma.appointment.deleteMany({
      where: { patient: { publicId: { in: charts } } },
    });
    await destroyLabFixtures(harness, charts);
  }

  await harness.reset();
  await harness.close();
});

describe('RM M15.4 verify — each source feeds the queue', () => {
  it('surfaces a pending appointment request', async () => {
    const token = await seedQueueDoctor('queue-appointment');
    const patient = await seedPatient(harness, token);
    charts.push(patient.id);

    const reference = await seedPendingRequest(token, patient.id);
    const view = await readQueue(token);

    expect(view.counts.appointmentRequests).toBe(1);

    const row = view.items.find((item) => item.kind === 'appointment-request');
    expect(row?.id).toBe(reference);
    expect(row?.patient).toEqual({ id: patient.id, name: patient.name });
    expect(row?.label).toBe('Appointment request awaiting your decision');
    expect(row?.urgency).toBe('normal');
  });

  it('surfaces an unreviewed critical result, and names the test', async () => {
    const token = await seedQueueDoctor('queue-lab');
    const patient = await seedPatient(harness, token);
    charts.push(patient.id);

    const reference = await seedCriticalLab(token, patient.id);
    const view = await readQueue(token);

    expect(view.counts.criticalLabs).toBe(1);

    const row = view.items.find((item) => item.kind === 'critical-lab');
    expect(row?.id).toBe(reference);
    expect(row?.urgency).toBe('critical');
    expect(row?.label).toBe('Critical result awaiting review — Basic Metabolic Panel');
    // The row names the test, never the value: a dashboard card is not
    // a chart.
    expect(row?.label).not.toContain('7.2');
  });

  it('surfaces an unsigned note, by its title and not its body', async () => {
    const token = await seedQueueDoctor('queue-note');
    const patient = await seedPatient(harness, token);
    charts.push(patient.id);

    const recordId = await seedUnsignedNote(token, patient.id, 'Cardiology review');
    const view = await readQueue(token);

    expect(view.counts.unsignedNotes).toBe(1);

    const row = view.items.find((item) => item.kind === 'unsigned-note');
    // The row links to the **record**, which is where signing happens.
    expect(row?.id).toBe(recordId);
    expect(row?.label).toBe('Unsigned note — Cardiology review');
    expect(row?.label).not.toContain('continue current dose');
  });

  it('surfaces a thread the patient spoke last in, over 24 hours ago', async () => {
    const token = await seedQueueDoctor('queue-message');
    const id = await seedStaleThread(token, { hoursAgo: 30, lastAuthor: 'other' });

    const view = await readQueue(token);

    expect(view.counts.staleMessages).toBe(1);

    const row = view.items.find((item) => item.kind === 'stale-message');
    expect(row?.id).toBe(id);
    expect(row?.urgency).toBe('high');
    expect(row?.ageHours).toBeGreaterThanOrEqual(30);
  });

  it('feeds all four into one list, in one seeded scenario', async () => {
    // The verify step names the four together, so they are proven
    // together: one doctor, one queue, every source contributing.
    const token = await seedQueueDoctor('queue-all-four');
    const patient = await seedPatient(harness, token);
    charts.push(patient.id);

    await seedPendingRequest(token, patient.id);
    await seedCriticalLab(token, patient.id);
    await seedUnsignedNote(token, patient.id);
    await seedStaleThread(token, { hoursAgo: 48, lastAuthor: 'other' });

    const view = await readQueue(token);

    expect(view.counts).toEqual({
      appointmentRequests: 1,
      criticalLabs: 1,
      unsignedNotes: 1,
      staleMessages: 1,
    });
    expect(view.totalItems).toBe(4);
    expect(new Set(kinds(view))).toEqual(
      new Set(['appointment-request', 'critical-lab', 'unsigned-note', 'stale-message']),
    );
  });
});

describe('the sort rule is actually applied to real rows', () => {
  it('puts the critical result first and the note last', async () => {
    // The ordering rule has its own unit spec; what this proves is that
    // it is *reached* — a correct sort that is never called is the
    // failure a unit test cannot see.
    const token = await seedQueueDoctor('queue-order');
    const patient = await seedPatient(harness, token);
    charts.push(patient.id);

    // Seeded in the wrong order deliberately, and the note is made the
    // oldest row so that an age-first sort would put it on top.
    await seedUnsignedNote(token, patient.id);
    await seedStaleThread(token, { hoursAgo: 72, lastAuthor: 'other' });
    await seedCriticalLab(token, patient.id);

    const view = await readQueue(token);

    expect(kinds(view)[0]).toBe('critical-lab');
    expect(kinds(view).at(-1)).toBe('unsigned-note');
  });

  it('ranks an urgent request above an ordinary one that waited longer', async () => {
    const token = await seedQueueDoctor('queue-urgent');
    const patient = await seedPatient(harness, token);
    charts.push(patient.id);

    const ordinary = await seedPendingRequest(token, patient.id, {
      createdAt: new Date('2026-01-01T09:00:00.000Z'),
    });
    const urgent = await seedPendingRequest(token, patient.id, { priority: 'URGENT' });

    const requests = (await readQueue(token)).items.filter(
      (item) => item.kind === 'appointment-request',
    );

    expect(requests.map((item) => item.id)).toEqual([urgent, ordinary]);
    expect(requests[0]?.urgency).toBe('high');
  });

  it('measures age from when the row started waiting', async () => {
    const token = await seedQueueDoctor('queue-age');
    const patient = await seedPatient(harness, token);
    charts.push(patient.id);

    // A request made 48 hours ago for a slot in December has waited two
    // days for an answer — the answer is what the queue is about, not
    // the slot.
    const waitingSince = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await seedPendingRequest(token, patient.id, { createdAt: waitingSince });

    const row = (await readQueue(token)).items.find((item) => item.kind === 'appointment-request');

    expect(row?.ageHours).toBe(48);
    expect(Date.parse(row?.waitingSince ?? '')).toBeCloseTo(waitingSince.getTime(), -4);
  });
});

describe('a row leaves the queue when it is dealt with', () => {
  it('drops the note once it is signed', async () => {
    const token = await seedQueueDoctor('queue-signed');
    const patient = await seedPatient(harness, token);
    charts.push(patient.id);

    const recordId = await seedUnsignedNote(token, patient.id);
    expect((await readQueue(token)).counts.unsignedNotes).toBe(1);

    const record = dataOf<{ notes: { id: string }[] }>(
      await request(harness.server)
        .get(`${RECORDS}/${recordId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200),
    );

    await request(harness.server)
      .post(`${RECORDS}/${recordId}/notes/${record.notes[0]?.id ?? ''}/sign`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(200);

    expect((await readQueue(token)).counts.unsignedNotes).toBe(0);
  });

  it('drops the lab once the critical result is reviewed', async () => {
    const token = await seedQueueDoctor('queue-reviewed');
    const patient = await seedPatient(harness, token);
    charts.push(patient.id);

    const reference = await seedCriticalLab(token, patient.id);
    expect((await readQueue(token)).counts.criticalLabs).toBe(1);

    const order = dataOf<{ results: { id: string }[] }>(
      await request(harness.server)
        .get(`/api/v1/lab-orders/${reference}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200),
    );

    // A critical value is reviewed individually, with every critical id
    // acknowledged and a note (M14.5).
    await post(harness, token, `/${reference}/review`, {
      acknowledgedResultIds: order.results.map((result) => result.id),
      note: 'Phoned the patient; repeat sample requested.',
    }).expect(200);

    expect((await readQueue(token)).counts.criticalLabs).toBe(0);
  });
});

describe('the queue is the caller’s own, and nobody else’s', () => {
  it('does not show a colleague’s pending requests', async () => {
    const owner = await seedQueueDoctor('queue-owner');
    const stranger = await seedQueueDoctor('queue-stranger');
    const patient = await seedPatient(harness, owner);
    charts.push(patient.id);

    await seedPendingRequest(owner, patient.id);

    expect((await readQueue(stranger)).counts.appointmentRequests).toBe(0);
    expect((await readQueue(owner)).counts.appointmentRequests).toBe(1);
  });

  it('does not show a colleague’s unsigned note, because only its author may sign', async () => {
    // Care scope would not be the right filter here: M12.4 refuses a
    // colleague's signature with 403 `not_note_author`, so a colleague's
    // note in this queue would be a row with no action behind it.
    const author = await seedQueueDoctor('queue-author');
    const colleague = await seedQueueDoctor('queue-colleague');
    const patient = await seedPatient(harness, author);
    charts.push(patient.id);

    await seedUnsignedNote(author, patient.id);

    expect((await readQueue(colleague)).counts.unsignedNotes).toBe(0);
  });

  it('ignores a thread the doctor archived', async () => {
    // Archiving is the per-viewer act of saying "done with this". A
    // queue that kept surfacing it would make the control meaningless.
    const token = await seedQueueDoctor('queue-archived');
    await seedStaleThread(token, { hoursAgo: 40, lastAuthor: 'other', archived: true });

    expect((await readQueue(token)).counts.staleMessages).toBe(0);
  });

  it('ignores a thread the doctor answered last', async () => {
    // "Unanswered" means the last word was not the doctor's. A thread
    // they replied to is waiting on the patient, not on them.
    const token = await seedQueueDoctor('queue-answered');
    await seedStaleThread(token, { hoursAgo: 40, lastAuthor: 'me' });

    expect((await readQueue(token)).counts.staleMessages).toBe(0);
  });

  it('ignores a thread that is not yet 24 hours old', async () => {
    const token = await seedQueueDoctor('queue-fresh');
    await seedStaleThread(token, { hoursAgo: 3, lastAuthor: 'other' });

    expect((await readQueue(token)).counts.staleMessages).toBe(0);
  });

  it('answers a doctor with nothing waiting with an empty queue, not a 404', async () => {
    const token = await seedQueueDoctor('queue-empty');
    const view = await readQueue(token);

    expect(view.items).toEqual([]);
    expect(view.totalItems).toBe(0);
    expect(view.truncated).toBe(false);
    expect(view.counts).toEqual({
      appointmentRequests: 0,
      criticalLabs: 0,
      unsignedNotes: 0,
      staleMessages: 0,
    });
  });

  it('refuses an unauthenticated request', async () => {
    expect((await request(harness.server).get(QUEUE)).status).toBe(401);
  });
});

describe('RM M15.4 verify — response < 200 ms', () => {
  it('answers inside the budget with every source populated', async () => {
    // The widget is priority-fetched on the first screen a doctor sees
    // (UX §2.1's loading state), so the budget is the contract's, not a
    // nicety. Four queries in parallel rather than in series is what
    // buys it — and the measurement is taken with all four sources
    // non-empty, because an empty queue would measure nothing.
    const token = await seedQueueDoctor('queue-latency');
    const patient = await seedPatient(harness, token);
    charts.push(patient.id);

    await seedPendingRequest(token, patient.id);
    await seedCriticalLab(token, patient.id);
    await seedUnsignedNote(token, patient.id);
    await seedStaleThread(token, { hoursAgo: 36, lastAuthor: 'other' });

    // One warm request first: the first query through a connection pays
    // for the plan cache and the pool, which is not what this measures.
    await readQueue(token);

    const started = process.hrtime.bigint();
    const view = await readQueue(token);
    const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;

    expect(view.totalItems).toBe(4);
    expect(elapsedMs).toBeLessThan(200);
  });
});
