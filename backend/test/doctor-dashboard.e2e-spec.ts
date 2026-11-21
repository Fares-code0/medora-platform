import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { CriticalAlertsRepository } from '../src/modules/dashboard/repositories/critical-alerts.repository';
import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  markVerified,
  registrationBody,
  testEmail,
} from './support/auth-app';
import { createPatientRecords, destroyPatientRecords } from './support/patient-fixture';

/**
 * The doctor Overview composite and its widgets — API §16.2–16.3, RM M27.
 *
 * > ✅ Verify (M27.1): shape matches `dashboard/model/mock-data.ts`;
 * > **KPI values are final, never eventually-consistent**.
 * > ✅ Verify (M27.2): each widget endpoint returns the same slice the
 * > composite carries; one widget failing does not fail the others.
 * > ✅ Verify (M27.3): with the source query forced to fail the endpoint
 * > returns 5xx, never 200 with `[]`.
 *
 * ## The p95 budgets are not asserted, and the reason is on the record
 *
 * M27.1 asks for p95 < 200 ms and M27.4 for < 50 ms. A latency budget
 * measured on whichever machine CI happens to run asserts the disk
 * rather than the design, and the shape that would make it meaningful —
 * a warmed cache — is **M31.1**'s. This is the same position M19.3 and
 * M23.1 already took, recorded as RA-M19.1. What is asserted instead is
 * the property this milestone controls: the KPI block is **one
 * transaction**, so every figure describes one instant.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const DASH = '/api/v1/dashboard/doctor';
const PASSWORD = 'Medora123!';

let token = '';
let doctorId = '';
let userId = '';
let strangerToken = '';
let patientId = '';
const TAG = 'd27';

const as = (auth: string) => ({ Authorization: `Bearer ${auth}` });
const get = (path: string, auth = token) =>
  request(harness.server).get(`${DASH}${path}`).set(as(auth));

interface Composite {
  readonly generatedAt: string;
  readonly kpis: {
    todayCount: number;
    todayCompleted: number;
    nextAt: string | null;
    pendingRequests: number;
    totalPatients: number;
    completedWeek: number;
    completedWeekDelta: number;
  };
  readonly todaySchedule: {
    id: string;
    at: string;
    patientName: string;
    patientAge: number;
    visitType: string;
    status: string;
    isNext: boolean;
  }[];
  readonly actionQueue: { id: string; kind: string }[];
  readonly trends: { day: string; completed: number; cancelled: number }[];
  readonly satisfaction: { total: number; average: number; buckets: { rating: number; count: number }[] };
  readonly recentActivity: { id: string; kind: string; at: string; text: string }[];
  readonly quickActions: { id: string; label: string; path: string }[];
}

async function signUpDoctor(local: string): Promise<{ auth: string; doctorId: string; userId: string }> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  const auth = dataOf<{ accessToken: string }>(
    await request(harness.server).post(LOGIN).send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;

  const user = await harness.prisma.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  });
  const doctor = await harness.prisma.doctor.findFirstOrThrow({
    where: { userId: user.id },
    select: { id: true },
  });

  return { auth, doctorId: doctor.id, userId: user.id };
}

/**
 * The day every fixture lives on, read once. Reading the clock per call
 * would let a run that starts at 23:59:59 put half the fixture on one day
 * and half on the next.
 */
const FIXTURE_DAY = new Date();

/** The fixture day at a fixed UTC hour. */
function todayAt(hour: number): Date {
  return new Date(
    Date.UTC(FIXTURE_DAY.getUTCFullYear(), FIXTURE_DAY.getUTCMonth(), FIXTURE_DAY.getUTCDate(), hour),
  );
}

/**
 * The whole file runs at noon on the fixture day. `nextAt` and `isNext`
 * mean "still ahead of the request clock", and the latest appointment the
 * fixture can place today is 23:00 — so on the real clock, a run after
 * 23:00 UTC has nothing ahead and both assertions fail on a correct
 * composite. The application is in-process (supertest), so faking `Date`
 * here moves the clock the services read. Only `Date` is faked, and it
 * keeps advancing.
 *
 * Pinned **before** the harness signs anyone in, not per test. The first
 * version pinned it in `beforeEach`, after `beforeAll` had issued the
 * access tokens on the real clock: any run before about 11:45 UTC then
 * verified a token whose 15-minute life had ended "at noon", and every
 * request was a 401. One clock for issuing and verifying is the fix.
 * Declared ahead of the harness's `beforeAll`, which Vitest runs in order.
 */
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'], shouldAdvanceTime: true });
  vi.setSystemTime(todayAt(12));
});

afterAll(() => {
  vi.useRealTimers();
});

beforeAll(async () => {
  harness = await createAuthHarness('dashboard-m27');

  const doctor = await signUpDoctor('dash-doctor');
  token = doctor.auth;
  doctorId = doctor.doctorId;
  userId = doctor.userId;
  strangerToken = (await signUpDoctor('dash-stranger')).auth;

  const [record] = await createPatientRecords(harness.prisma, TAG, 1);
  patientId = record?.id ?? '';

  await harness.prisma.patientDoctorAssignment.create({
    data: { patientId, doctorId, role: 'primary' },
  });

  const visitType = await harness.prisma.visitType.findFirstOrThrow({ select: { id: true } });
  const test = await harness.prisma.labTestCatalogue.findFirstOrThrow({ select: { id: true } });
  const medication = await harness.prisma.medication.findFirstOrThrow({ select: { id: true } });

  // Three appointments today: one completed, one still ahead, one
  // pending — so `todayCount`, `todayCompleted`, `nextAt` and
  // `pendingRequests` are all non-zero and distinguishable.
  await harness.prisma.appointment.createMany({
    data: [
      {
        publicId: `APT-T${TAG}1`,
        patientId,
        doctorId,
        visitTypeId: visitType.id,
        startsAt: todayAt(1),
        reason: 'Completed visit',
        status: 'COMPLETED',
      },
      {
        publicId: `APT-T${TAG}2`,
        patientId,
        doctorId,
        visitTypeId: visitType.id,
        startsAt: todayAt(23),
        reason: 'Upcoming visit',
        status: 'CONFIRMED',
      },
      {
        publicId: `APT-T${TAG}3`,
        patientId,
        doctorId,
        visitTypeId: visitType.id,
        startsAt: todayAt(22),
        reason: 'Requested visit',
        status: 'PENDING',
      },
      {
        publicId: `APT-T${TAG}4`,
        patientId,
        doctorId,
        visitTypeId: visitType.id,
        startsAt: todayAt(20),
        reason: 'Urgent, moved',
        status: 'RESCHEDULED',
        priority: 'URGENT',
      },
      // M27.3's urgent reschedule. The banner reports only one still
      // ahead of the request clock, so `APT-T…4` at 20:00 drops out of it
      // for any run after 20:00 UTC. Tomorrow is always ahead, and lies
      // outside every today-bounded figure the composite asserts.
      {
        publicId: `APT-T${TAG}5`,
        patientId,
        doctorId,
        visitTypeId: visitType.id,
        startsAt: new Date(todayAt(20).getTime() + 24 * 60 * 60 * 1000),
        reason: 'Urgent, moved to tomorrow',
        status: 'RESCHEDULED',
        priority: 'URGENT',
      },
    ],
  });

  const record0 = await harness.prisma.medicalRecord.create({
    data: {
      publicId: `MR-T${TAG}1`,
      patientId,
      doctorId,
      visitDate: todayAt(1),
      visitType: 'Consultation',
      chiefComplaint: 'Shoulder pain',
      historyOfPresentIllness: 'n/a',
      physicalExamination: 'n/a',
    },
    select: { id: true },
  });

  await harness.prisma.recordNote.create({
    data: {
      recordId: record0.id,
      authorId: userId,
      title: 'Consultation note',
      body: 'Signed today.',
      signed: true,
      signedAt: todayAt(2),
    },
  });

  await harness.prisma.prescription.create({
    data: {
      publicId: `RX-T${TAG}1`,
      patientId,
      medicationId: medication.id,
      prescribingDoctorId: doctorId,
      strength: '500 mg',
      dosage: '1 tablet',
      frequency: 'twice daily',
      route: 'ORAL',
      durationDays: 7,
      quantity: 14,
      instructions: 'After food.',
      status: 'ACTIVE',
      startDate: todayAt(0),
      endDate: todayAt(0),
      signedAt: todayAt(3),
    },
  });

  // A released order carrying a critical value nobody has reviewed —
  // the Row-0 banner's first source, and the action queue's.
  await harness.prisma.labOrder.create({
    data: {
      publicId: `LAB-T${TAG}1`,
      patientId,
      testId: test.id,
      orderedBy: doctorId,
      clinicalIndication: 'Electrolytes',
      status: 'COMPLETED',
      requestedAt: todayAt(0),
      completedAt: todayAt(4),
      hasCriticalResult: true,
    },
  });

  await harness.prisma.patientClinicalAlert.create({
    data: { patientId, severity: 'CRITICAL', message: 'Anaphylaxis to penicillin', active: true },
  });

  await harness.prisma.satisfactionSurvey.create({
    data: {
      appointmentId: (
        await harness.prisma.appointment.findUniqueOrThrow({
          where: { publicId: `APT-T${TAG}1` },
          select: { id: true },
        })
      ).id,
      patientId,
      doctorId,
      rating: 5,
    },
  });
}, 120_000);

afterAll(async () => {
  if (harness === undefined) return;

  await harness.prisma.satisfactionSurvey.deleteMany({ where: { doctorId } });
  await harness.prisma.patientClinicalAlert.deleteMany({ where: { patientId } });
  await harness.prisma.labOrder.deleteMany({ where: { publicId: { startsWith: `LAB-T${TAG}` } } });
  await harness.prisma.patientMedication.deleteMany({ where: { patientId } });
  await harness.prisma.prescription.deleteMany({ where: { publicId: { startsWith: `RX-T${TAG}` } } });
  await harness.prisma.recordNote.deleteMany({ where: { authorId: userId } });
  await harness.prisma.medicalRecord.deleteMany({ where: { publicId: { startsWith: `MR-T${TAG}` } } });
  await harness.prisma.appointment.deleteMany({ where: { publicId: { startsWith: `APT-T${TAG}` } } });
  await harness.prisma.patientDoctorAssignment.deleteMany({ where: { patientId } });
  await destroyPatientRecords(harness.prisma, TAG);

  await harness.reset();
  await harness.close();
});

describe('M27.1 — the composite', () => {
  it('carries every widget the Overview renders', async () => {
    const response = await get('');

    expect(response.status, JSON.stringify(response.body)).toBe(200);

    const doc = dataOf<Composite>(response);

    // The nine keys §16.2 lists. A missing one is a blank row on the
    // first screen a doctor sees.
    expect(Object.keys(doc).sort()).toEqual(
      [
        'actionQueue',
        'generatedAt',
        'kpis',
        'quickActions',
        'recentActivity',
        'satisfaction',
        'todaySchedule',
        'trends',
      ].sort(),
    );
  });

  it('counts the KPI figures rather than reading a stored one', async () => {
    const doc = dataOf<Composite>(await get(''));

    expect(doc.kpis.todayCount).toBe(4);
    expect(doc.kpis.todayCompleted).toBe(1);
    expect(doc.kpis.pendingRequests).toBe(1);
    expect(doc.kpis.totalPatients).toBe(1);
    // `nextAt` is the next appointment still **ahead** of the request's
    // clock — "next at 09:00" about one that already happened is the
    // kind of wrong that makes a dashboard untrusted.
    expect(doc.kpis.nextAt).not.toBeNull();
    expect(new Date(doc.kpis.nextAt ?? 0).getTime()).toBeGreaterThan(Date.now());
  });

  it('carries a signed delta, so fewer is not indistinguishable from more', async () => {
    const doc = dataOf<Composite>(await get(''));

    expect(typeof doc.kpis.completedWeekDelta).toBe('number');
    expect(doc.kpis.completedWeek).toBe(1);
  });

  it('sends instants, never a formatted "20 min ago"', async () => {
    const doc = dataOf<Composite>(await get(''));

    // The widget re-renders on a timer; a relative string computed on
    // the server freezes at whatever it said when the response was
    // built. The rule M15.4's action queue set for `waitingSince`.
    for (const entry of doc.recentActivity) {
      expect(Number.isNaN(Date.parse(entry.at))).toBe(false);
    }
    for (const entry of doc.todaySchedule) {
      expect(Number.isNaN(Date.parse(entry.at))).toBe(false);
    }
  });

  it('marks the next appointment, computed against the request clock', async () => {
    const doc = dataOf<Composite>(await get(''));
    const next = doc.todaySchedule.filter((entry) => entry.isNext);

    // Exactly one, and it is not the completed one behind us.
    expect(next).toHaveLength(1);
    expect(next[0]?.status).not.toBe('completed');
    expect(doc.todaySchedule.map((entry) => entry.id)).toEqual([
      `APT-T${TAG}1`,
      `APT-T${TAG}4`,
      `APT-T${TAG}3`,
      `APT-T${TAG}2`,
    ]);
  });

  it('returns all fourteen trend days, including the empty ones', async () => {
    const doc = dataOf<Composite>(await get(''));

    // A series that skipped quiet days would draw a clinic that closes
    // at random — the rule M23.1 applies to its hourly histogram.
    expect(doc.trends).toHaveLength(14);
    expect(doc.trends.map((point) => point.day)).toEqual([...doc.trends].map((p) => p.day).sort());
    expect(doc.trends.at(-1)?.completed).toBe(1);
  });

  it('returns all five satisfaction buckets and a real average', async () => {
    const doc = dataOf<Composite>(await get(''));

    // A histogram missing "1 star" because nobody gave one reads as a
    // scale that starts at 2.
    expect(doc.satisfaction.buckets.map((bucket) => bucket.rating)).toEqual([1, 2, 3, 4, 5]);
    expect(doc.satisfaction.total).toBe(1);
    expect(doc.satisfaction.average).toBe(5);
  });

  it('feeds recent activity from clinical work, not from the account log', async () => {
    const doc = dataOf<Composite>(await get(''));
    const kinds = doc.recentActivity.map((entry) => entry.kind);

    // `user_activity_log`'s seven kinds are account events; the widget
    // shows a note signed, a prescription issued, a result released.
    expect(kinds).toContain('note-signed');
    expect(kinds).toContain('prescription-issued');
    expect(kinds).toContain('lab-released');
    // Newest first, merged across all three sources rather than the
    // newest of each.
    const times = doc.recentActivity.map((entry) => Date.parse(entry.at));
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it('answers an empty Overview for a doctor with no practice of their own', async () => {
    const doc = dataOf<Composite & { practice: null }>(await get('', strangerToken));

    // Empty because there is nothing, and it says so — a client that
    // could not tell this from a failed query would render "0 patients"
    // as a fact.
    expect(doc.kpis.todayCount).toBe(0);
    expect(doc.todaySchedule).toEqual([]);
    expect(doc.trends).toHaveLength(14);
    expect(doc.quickActions.length).toBeGreaterThan(0);
  });

  it('requires the clinical capability', async () => {
    await request(harness.server).get(DASH).expect(401);
  });
});

describe('M27.2 — each widget answers on its own', () => {
  it('returns exactly the slice the composite carries', async () => {
    const doc = dataOf<Composite>(await get(''));

    const [kpis, schedule, trends, satisfaction, activity] = await Promise.all([
      get('/kpis'),
      get('/schedule'),
      get('/trends'),
      get('/satisfaction'),
      get('/recent-activity'),
    ]);

    // The same method computes both, so the two cannot disagree — this
    // is the assertion that fails if a widget route ever grows its own
    // copy of the logic. `generatedAt` differs by construction, so the
    // KPI comparison drops it.
    const { generatedAt: _generated, ...widgetKpis } = dataOf<
      Composite['kpis'] & { generatedAt?: string }
    >(kpis);
    expect(widgetKpis).toEqual(doc.kpis);
    expect(dataOf<Composite['todaySchedule']>(schedule)).toEqual(doc.todaySchedule);
    expect(dataOf<Composite['trends']>(trends)).toEqual(doc.trends);
    expect(dataOf<Composite['satisfaction']>(satisfaction)).toEqual(doc.satisfaction);
    expect(dataOf<Composite['recentActivity']>(activity)).toEqual(doc.recentActivity);
  });

  it('serves the action queue as its own endpoint, as M15.4 did', async () => {
    expect((await get('/action-queue')).status).toBe(200);
  });
});

describe('M27.3 — the Row-0 banner fails loud', () => {
  it('reports the three sources it can see', async () => {
    const response = await get('/critical-alerts');

    expect(response.status).toBe(200);

    const kinds = dataOf<{ alerts: { kind: string }[] }>(response).alerts.map(
      (alert) => alert.kind,
    );

    expect(kinds).toContain('unreviewed-critical-lab');
    expect(kinds).toContain('allergy-conflict');
    expect(kinds).toContain('urgent-reschedule');
  });

  it('answers 5xx — never 200 with an empty list — when a source fails', async () => {
    // A second application, with the alerts repository replaced by one
    // that throws. This is the whole point of that class being its own
    // provider: an empty banner is indistinguishable from a safe one, so
    // a failure must be visible.
    const failing = await createAuthHarness('dashboard-m27-fail', {
      overrides: [
        {
          token: CriticalAlertsRepository,
          value: {
            unreviewedCriticalLabs: () => Promise.reject(new Error('source down')),
            todaysCriticalAlerts: () => Promise.resolve([]),
            urgentReschedules: () => Promise.resolve([]),
          },
        },
      ],
    });

    try {
      const email = `dash-fail@${failing.domain}`;
      await request(failing.server).post(REGISTER).send(registrationBody({ email }));
      await markVerified(failing.prisma, email);
      const auth = dataOf<{ accessToken: string }>(
        await request(failing.server)
          .post(LOGIN)
          .send({ email, password: PASSWORD, rememberMe: false }),
      ).accessToken;

      const response = await request(failing.server)
        .get(`${DASH}/critical-alerts`)
        .set(as(auth));

      expect(response.status).toBeGreaterThanOrEqual(500);
      expect(JSON.stringify(response.body)).not.toContain('"alerts"');
    } finally {
      await failing.reset();
      await failing.close();
    }
  }, 60_000);
});

describe('M27.4 — the summary endpoints every card reads', () => {
  it('answers on all five modules', async () => {
    const paths = [
      '/api/v1/appointments/summary',
      '/api/v1/medical-records/summary',
      '/api/v1/prescriptions/summary',
      '/api/v1/lab-orders/summary',
      '/api/v1/notifications/summary',
    ];

    for (const path of paths) {
      const response = await request(harness.server).get(path).set(as(token));
      expect(response.status, path).toBe(200);
    }
  });

  it('counts prescriptions in the frontend’s own vocabulary', async () => {
    const summary = dataOf<{
      total: number;
      active: number;
      pendingRefills: number;
      expired: number;
      highRisk: number;
      newToday: number;
    }>(await request(harness.server).get('/api/v1/prescriptions/summary').set(as(token)));

    // The six field names are `summarizePrescriptions`'s verbatim.
    expect(Object.keys(summary).sort()).toEqual([
      'active',
      'expired',
      'highRisk',
      'newToday',
      'pendingRefills',
      'total',
    ]);
    expect(summary.total).toBe(1);
    expect(summary.active).toBe(1);
    expect(summary.newToday).toBe(1);
  });

  it('reports criticalUnreviewed on the lab summary', async () => {
    const summary = dataOf<{ criticalUnreviewed: number }>(
      await request(harness.server).get('/api/v1/lab-orders/summary').set(as(token)),
    );

    expect(summary.criticalUnreviewed).toBe(1);
  });
});
