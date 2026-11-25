import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  markVerified,
  patientRegistrationBody,
  registrationBody,
  testEmail,
  makeClinicalDoctor,
  clinicalStampFor,
  recordPatientAt,
} from './support/auth-app';
import { createPatientRecords, destroyPatientRecords } from './support/patient-fixture';

/**
 * `GET/PUT /me/availability` and `/me/time-off` (RM M9.4 — API §3.8–3.9).
 *
 * The milestone's verify step is "grid round-trip; overlapping ranges
 * rejected 422", and both are here. The overlap cases are the ones worth
 * reading: `@@unique([doctorId, weekday, startTime])` stops two rows
 * starting at the same minute and nothing else, so 09:00–13:00 beside
 * 12:00–17:00 satisfies the schema perfectly and describes a day that
 * books a patient into one slot twice. That rule lives in the service,
 * and this is what proves it.
 *
 * The time-off cases assert the property ADR-005 RA-005.2 insists on:
 * the endpoint reports what a block would disturb and **moves nothing**,
 * whatever `mode` says.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const AVAILABILITY = '/api/v1/me/availability';
const TIME_OFF = '/api/v1/me/time-off';
const PASSWORD = 'Medora123!';

interface SessionPayload {
  user: { id: string; name: string; email: string; role: string; permissions: string[] };
  accessToken: string;
  expiresIn: number;
}

interface TimeRange {
  start: string;
  end: string;
}

interface AvailabilityDay {
  weekday: string;
  open: boolean;
  windows: TimeRange[];
  breaks: TimeRange[];
}

interface AvailabilityView {
  week: AvailabilityDay[];
  defaultDurationMin: number;
  bufferMin: number;
}

interface TimeOffView {
  id: string;
  startsAt: string;
  endsAt: string;
  kind: string;
  autoBehavior: string;
  createdAt: string;
}

interface TimeOffResult {
  timeOff: TimeOffView;
  impacted: {
    id: string;
    scheduledAt: string;
    durationMin: number;
    status: string;
    patientId: string;
  }[];
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/** A closed week, which every test then opens the days it cares about. */
function closedWeek(): AvailabilityDay[] {
  return WEEKDAYS.map((weekday) => ({ weekday, open: false, windows: [], breaks: [] }));
}

function weekWith(weekday: string, day: Partial<AvailabilityDay>): AvailabilityDay[] {
  return closedWeek().map((entry) =>
    entry.weekday === weekday ? { ...entry, open: true, ...day } : entry,
  );
}

async function seedDoctor(local: string): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  // Clinical standing (F-09): outside it, this route is refused.
  await makeClinicalDoctor(harness.prisma, email);

  const response = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });

  return dataOf<SessionPayload>(response).accessToken;
}

async function seedPatientAccount(local: string): Promise<string> {
  const email = testEmail(local);
  await request(harness.server)
    .post(REGISTER)
    .send(patientRegistrationBody({ email }));
  await markVerified(harness.prisma, email);

  const response = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });

  return dataOf<SessionPayload>(response).accessToken;
}

async function putWeek(token: string, body: object): Promise<request.Response> {
  return request(harness.server)
    .put(AVAILABILITY)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

beforeAll(async () => {
  harness = await createAuthHarness('doctor-availability');
}, 60_000);

/** The dedicated charts some tests book against, and their appointments. */
async function removeCharts(): Promise<void> {
  for (const tag of ['avi', 'avn']) await destroyPatientRecords(harness.prisma, tag);
}

afterAll(async () => {
  await removeCharts();
  await harness.reset();
  await harness.close();
});

beforeEach(async () => {
  await removeCharts();
  await harness.reset();
});

describe('GET /me/availability (§3.8)', () => {
  it('returns seven days for a doctor with no grid yet', async () => {
    const token = await seedDoctor('fresh');

    const response = await request(harness.server)
      .get(AVAILABILITY)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);

    const view = dataOf<AvailabilityView>(response);
    expect(view.week.map((day) => day.weekday)).toEqual([...WEEKDAYS]);
    expect(view.week.every((day) => !day.open)).toBe(true);
    // The column defaults, which are the doctor's scheduling defaults
    // rather than a property of any one day (ADR-005 §2).
    expect(view.defaultDurationMin).toBe(30);
    expect(view.bufferMin).toBe(0);
  });

  it('answers 404 for an account with no doctor profile', async () => {
    const token = await seedPatientAccount('patient');

    const response = await request(harness.server)
      .get(AVAILABILITY)
      .set('Authorization', `Bearer ${token}`);

    // The resource genuinely does not exist for them. A 403 would say
    // "you may not see your own availability", which is untrue.
    expect(response.status).toBe(404);
  });

  it('refuses an unauthenticated caller', async () => {
    expect((await request(harness.server).get(AVAILABILITY)).status).toBe(401);
  });
});

describe('PUT /me/availability (§3.8)', () => {
  it('round-trips the grid, breaks included', async () => {
    const token = await seedDoctor('roundtrip');

    const week = weekWith('Mon', {
      windows: [
        { start: '09:00', end: '12:00' },
        { start: '13:00', end: '17:00' },
      ],
      breaks: [{ start: '10:30', end: '10:45' }],
    });

    const saved = await putWeek(token, { week, defaultDurationMin: 20, bufferMin: 10 });
    expect(saved.status).toBe(200);

    const read = await request(harness.server)
      .get(AVAILABILITY)
      .set('Authorization', `Bearer ${token}`);

    const view = dataOf<AvailabilityView>(read);
    const monday = view.week.find((day) => day.weekday === 'Mon');

    expect(monday?.open).toBe(true);
    expect(monday?.windows).toEqual([
      { start: '09:00', end: '12:00' },
      { start: '13:00', end: '17:00' },
    ]);
    expect(monday?.breaks).toEqual([{ start: '10:30', end: '10:45' }]);
    expect(view.defaultDurationMin).toBe(20);
    expect(view.bufferMin).toBe(10);
    // Every other day is closed and stays closed.
    expect(view.week.filter((day) => day.open)).toHaveLength(1);
  });

  it('replaces rather than merges', async () => {
    const token = await seedDoctor('replace');

    await putWeek(token, {
      week: weekWith('Mon', { windows: [{ start: '09:00', end: '17:00' }] }),
      defaultDurationMin: 30,
      bufferMin: 0,
    });

    await putWeek(token, {
      week: weekWith('Tue', { windows: [{ start: '08:00', end: '12:00' }] }),
      defaultDurationMin: 30,
      bufferMin: 0,
    });

    const read = await request(harness.server)
      .get(AVAILABILITY)
      .set('Authorization', `Bearer ${token}`);

    const open = dataOf<AvailabilityView>(read).week.filter((day) => day.open);
    // "The days you did not mention keep what they had" would silently
    // preserve a day the doctor believes they cleared.
    expect(open.map((day) => day.weekday)).toEqual(['Tue']);
  });

  it('rejects overlapping working windows with 422', async () => {
    const token = await seedDoctor('overlap');

    const response = await putWeek(token, {
      week: weekWith('Mon', {
        windows: [
          { start: '09:00', end: '13:00' },
          { start: '12:00', end: '17:00' },
        ],
      }),
      defaultDurationMin: 30,
      bufferMin: 0,
    });

    // The unique index cannot catch this: the two rows start at
    // different minutes and describe a day that double-books noon.
    expect(response.status).toBe(422);
    expect(Object.keys(errorBody(response).fieldErrors ?? {})[0]).toContain('windows');

    // Nothing was written.
    const read = await request(harness.server)
      .get(AVAILABILITY)
      .set('Authorization', `Bearer ${token}`);
    expect(dataOf<AvailabilityView>(read).week.every((day) => !day.open)).toBe(true);
  });

  it('accepts windows that touch at an endpoint', async () => {
    const token = await seedDoctor('touching');

    const response = await putWeek(token, {
      week: weekWith('Mon', {
        windows: [
          { start: '09:00', end: '12:00' },
          { start: '12:00', end: '17:00' },
        ],
      }),
      defaultDurationMin: 30,
      bufferMin: 0,
    });

    // A lunch boundary, not a double booking.
    expect(response.status).toBe(200);
  });

  it('rejects overlapping breaks', async () => {
    const token = await seedDoctor('breakoverlap');

    const response = await putWeek(token, {
      week: weekWith('Mon', {
        windows: [{ start: '09:00', end: '17:00' }],
        breaks: [
          { start: '12:00', end: '13:00' },
          { start: '12:30', end: '13:30' },
        ],
      }),
      defaultDurationMin: 30,
      bufferMin: 0,
    });

    expect(response.status).toBe(422);
  });

  it('rejects a break outside its working window', async () => {
    const token = await seedDoctor('straybreak');

    const response = await putWeek(token, {
      week: weekWith('Mon', {
        windows: [{ start: '09:00', end: '12:00' }],
        breaks: [{ start: '14:00', end: '15:00' }],
      }),
      defaultDurationMin: 30,
      bufferMin: 0,
    });

    // A break outside the working day blocks nothing and makes the grid
    // read as though it does.
    expect(response.status).toBe(422);
  });

  it('rejects a range whose end precedes its start', async () => {
    const token = await seedDoctor('backwards');

    const response = await putWeek(token, {
      week: weekWith('Mon', { windows: [{ start: '17:00', end: '09:00' }] }),
      defaultDurationMin: 30,
      bufferMin: 0,
    });

    expect(response.status).toBe(422);
  });

  it('rejects a closed day that still carries hours', async () => {
    const token = await seedDoctor('closedhours');

    const week = closedWeek().map((day) =>
      day.weekday === 'Mon' ? { ...day, windows: [{ start: '09:00', end: '17:00' }] } : day,
    );

    const response = await putWeek(token, { week, defaultDurationMin: 30, bufferMin: 0 });

    // The two states mean different things, and quietly discarding the
    // windows would lose an edit the user believes they made.
    expect(response.status).toBe(422);
  });

  it('rejects a slot duration outside the fixed set', async () => {
    const token = await seedDoctor('badduration');

    for (const defaultDurationMin of [7, 25, 90]) {
      const response = await putWeek(token, {
        week: weekWith('Mon', { windows: [{ start: '09:00', end: '17:00' }] }),
        defaultDurationMin,
        bufferMin: 0,
      });

      expect(response.status).toBe(422);
    }
  });

  it('rejects a week that is not seven distinct days', async () => {
    const token = await seedDoctor('shortweek');

    const six = closedWeek().slice(0, 6);
    expect((await putWeek(token, { week: six, defaultDurationMin: 30, bufferMin: 0 })).status).toBe(
      422,
    );

    const duplicated = [...closedWeek().slice(0, 6), closedWeek()[0]];
    expect(
      (await putWeek(token, { week: duplicated, defaultDurationMin: 30, bufferMin: 0 })).status,
    ).toBe(422);
  });

  it('rejects a time with seconds', async () => {
    const token = await seedDoctor('seconds');

    const response = await putWeek(token, {
      week: weekWith('Mon', { windows: [{ start: '09:00:00', end: '17:00:00' }] }),
      defaultDurationMin: 30,
      bufferMin: 0,
    });

    // The column is `time(0)`; a client sending seconds is a client that
    // will be surprised when they come back stripped.
    expect(response.status).toBe(422);
  });

  it("never writes into another doctor's grid", async () => {
    const mine = await seedDoctor('mine');
    const theirs = await seedDoctor('theirs');

    await putWeek(mine, {
      week: weekWith('Mon', { windows: [{ start: '09:00', end: '17:00' }] }),
      defaultDurationMin: 30,
      bufferMin: 0,
    });

    const read = await request(harness.server)
      .get(AVAILABILITY)
      .set('Authorization', `Bearer ${theirs}`);

    expect(dataOf<AvailabilityView>(read).week.every((day) => !day.open)).toBe(true);
  });

  it('writes a settings activity entry', async () => {
    const token = await seedDoctor('activity');

    await putWeek(token, {
      week: weekWith('Mon', { windows: [{ start: '09:00', end: '17:00' }] }),
      defaultDurationMin: 30,
      bufferMin: 0,
    });

    const feed = await request(harness.server)
      .get('/api/v1/me/activity')
      .set('Authorization', `Bearer ${token}`);

    const items = dataOf<{ items: { kind: string; summary: string }[] }>(feed).items;
    expect(items[0]?.kind).toBe('settings');
    expect(items[0]?.summary).toContain('availability');
  });
});

/**
 * BR-DEC-005 — a new grid reports the live appointments it strands,
 * computed in the clinic's timezone, and moves none of them.
 *
 * The zone-reading itself (DST, the clinic's weekday versus UTC's) is
 * pinned in `stranded-appointments.spec.ts` with fixed instants; this
 * proves the route wires it to real rows and the clinic's stored zone.
 * The patient is this file's own (`createPatientRecords`), not a borrowed
 * seeded one another suite may be using.
 */
describe('PUT /me/availability — stranded appointments (BR-DEC-005)', () => {
  it('serves the clinic timezone the grid is read in', async () => {
    const token = await seedDoctor('tz-read');

    const response = await request(harness.server)
      .get(AVAILABILITY)
      .set('Authorization', `Bearer ${token}`);

    const stored = await harness.prisma.platformSetting.findUnique({
      where: { key: 'localization' },
      select: { value: true },
    });
    const expected = (stored?.value as { timezone?: string } | null)?.timezone ?? 'UTC';

    expect(response.status).toBe(200);
    expect(dataOf<{ clinicTimezone: string }>(response).clinicTimezone).toBe(expected);
  });

  it('reports what the new week no longer covers, and moves nothing', async () => {
    const token = await seedDoctor('stranded');
    const doctor = await harness.prisma.doctor.findFirstOrThrow({
      where: { user: { email: testEmail('stranded') } },
      select: { id: true },
    });
    const [patient] = await createPatientRecords(harness.prisma, 'av5', 1);
    // The patient holds a record at the doctor's hospital, and the bookings
    // are stamped with it, as the application would write them (F-06).
    await recordPatientAt(harness.prisma, patient?.id ?? '');
    const clinical = await clinicalStampFor(harness.prisma, doctor.id, patient?.id ?? '');
    const visitType = await harness.prisma.visitType.findFirstOrThrow({ select: { id: true } });

    // Two Thursdays out, so both are in the future whenever this runs.
    const thursday = new Date();
    thursday.setUTCDate(thursday.getUTCDate() + ((4 - thursday.getUTCDay() + 7) % 7) + 7);
    const atUtc = (hour: number) =>
      new Date(
        Date.UTC(thursday.getUTCFullYear(), thursday.getUTCMonth(), thursday.getUTCDate(), hour),
      );

    const stamp = Date.now().toString(36);
    const [kept, stranded] = await Promise.all(
      [10, 15].map((hour, index) =>
        harness.prisma.appointment.create({
          data: {
            ...clinical,
            publicId: `APT-T-AV5-${String(index)}-${stamp}`,
            patientId: patient?.id ?? '',
            doctorId: doctor.id,
            visitTypeId: visitType.id,
            startsAt: atUtc(hour),
            durationMin: 30,
            status: 'CONFIRMED',
            reason: 'Follow-up',
          },
          select: { id: true, publicId: true },
        }),
      ),
    );

    try {
      // The stored zone is the seed's UTC unless `platform-settings.e2e-spec`
      // has just written Africa/Cairo, and both suites share the database.
      // So the window and the two instants are chosen to give the same
      // answer in UTC, in Cairo winter (UTC+2) and Cairo summer (UTC+3):
      // 10:00Z is 10:00–13:00 local, inside 08:00–14:00 in all three, and
      // 15:00Z is 15:00–18:00 local, outside it in all three.
      const response = await putWeek(token, {
        week: weekWith('Thu', { windows: [{ start: '08:00', end: '14:00' }], breaks: [] }),
        defaultDurationMin: 30,
        bufferMin: 0,
      });

      expect(response.status, JSON.stringify(response.body)).toBe(200);

      const result = dataOf<{ clinicTimezone: string; stranded: { id: string; patientId: string }[] }>(
        response,
      );
      expect(['UTC', 'Africa/Cairo']).toContain(result.clinicTimezone);
      expect(result.stranded.map((entry) => entry.id)).toEqual([stranded?.publicId]);
      // The handle, never the name — the time-off list's rule.
      expect(JSON.stringify(result.stranded)).not.toContain('Test Patient');

      const after = await harness.prisma.appointment.findMany({
        where: { id: { in: [kept?.id ?? '', stranded?.id ?? ''] } },
        select: { status: true },
      });
      expect(after.map((row) => row.status)).toEqual(['CONFIRMED', 'CONFIRMED']);
    } finally {
      await harness.prisma.appointment.deleteMany({
        where: { publicId: { startsWith: 'APT-T-AV5-' } },
      });
      await destroyPatientRecords(harness.prisma, 'av5');
    }
  });

  it('reports an empty list when nothing is booked', async () => {
    const token = await seedDoctor('stranded-none');

    const response = await putWeek(token, {
      week: weekWith('Mon', { windows: [{ start: '09:00', end: '17:00' }], breaks: [] }),
      defaultDurationMin: 30,
      bufferMin: 0,
    });

    expect(response.status).toBe(200);
    expect(dataOf<{ stranded: unknown[] }>(response).stranded).toEqual([]);
  });
});

describe('/me/time-off (§3.9)', () => {
  it('books a block and lists it', async () => {
    const token = await seedDoctor('timeoff');

    const created = await request(harness.server)
      .post(TIME_OFF)
      .set('Authorization', `Bearer ${token}`)
      .send({
        from: '2026-12-01T00:00:00.000Z',
        to: '2026-12-08T00:00:00.000Z',
        kind: 'vacation',
        mode: 'block-new',
      });

    expect(created.status).toBe(201);

    const result = dataOf<TimeOffResult>(created);
    expect(result.timeOff.kind).toBe('vacation');
    expect(result.timeOff.autoBehavior).toBe('block-new');
    // No appointments exist for a freshly registered doctor.
    expect(result.impacted).toEqual([]);

    const listed = await request(harness.server)
      .get(TIME_OFF)
      .set('Authorization', `Bearer ${token}`);

    expect(dataOf<TimeOffView[]>(listed)).toHaveLength(1);
  });

  it('reports impacted appointments and moves none of them', async () => {
    const token = await seedDoctor('impact');

    const doctor = await harness.prisma.doctor.findFirstOrThrow({
      where: { user: { email: testEmail('impact') } },
      select: { id: true },
    });
    // A dedicated chart at the doctor's hospital (DR-05, F-06).
    const [patient] = await createPatientRecords(harness.prisma, 'avi', 1);
    if (patient === undefined) throw new Error('fixture patient missing');
    await recordPatientAt(harness.prisma, patient.id);
    const clinical = await clinicalStampFor(harness.prisma, doctor.id, patient.id);
    const visitType = await harness.prisma.visitType.findFirstOrThrow({ select: { id: true } });

    const appointment = await harness.prisma.appointment.create({
      data: {
        ...clinical,
        publicId: `APT-IMP-${Date.now().toString(36)}`,
        patientId: patient.id,
        doctorId: doctor.id,
        visitTypeId: visitType.id,
        startsAt: new Date('2026-12-03T10:00:00.000Z'),
        durationMin: 30,
        status: 'CONFIRMED',
        reason: 'Follow-up',
      },
    });

    const created = await request(harness.server)
      .post(TIME_OFF)
      .set('Authorization', `Bearer ${token}`)
      .send({
        from: '2026-12-01T00:00:00.000Z',
        to: '2026-12-08T00:00:00.000Z',
        kind: 'emergency-block',
        // Even the mode that *sounds* like an instruction is only a
        // pre-selection for the resolution screen (ADR-005 RA-005.2).
        mode: 'reschedule-existing',
      });

    const result = dataOf<TimeOffResult>(created);
    expect(result.impacted).toHaveLength(1);
    expect(result.impacted[0]?.status).toBe('confirmed');
    expect(result.impacted[0]?.patientId).toMatch(/^PT-/);

    // The blast-radius confirmation is mandatory, so the appointment is
    // untouched: same status, same time.
    const after = await harness.prisma.appointment.findUniqueOrThrow({
      where: { id: appointment.id },
      select: { status: true, startsAt: true },
    });
    expect(after.status).toBe('CONFIRMED');
    expect(after.startsAt.toISOString()).toBe('2026-12-03T10:00:00.000Z');

    await harness.prisma.appointment.delete({ where: { id: appointment.id } });
  });

  it('carries no patient name in the impact list', async () => {
    const token = await seedDoctor('nonames');

    const doctor = await harness.prisma.doctor.findFirstOrThrow({
      where: { user: { email: testEmail('nonames') } },
      select: { id: true },
    });
    // A dedicated chart at the doctor's hospital (DR-05, F-06).
    const [patient] = await createPatientRecords(harness.prisma, 'avn', 1);
    if (patient === undefined) throw new Error('fixture patient missing');
    await recordPatientAt(harness.prisma, patient.id);
    const clinical = await clinicalStampFor(harness.prisma, doctor.id, patient.id);
    const visitType = await harness.prisma.visitType.findFirstOrThrow({ select: { id: true } });

    const appointment = await harness.prisma.appointment.create({
      data: {
        ...clinical,
        publicId: `APT-PHI-${Date.now().toString(36)}`,
        patientId: patient.id,
        doctorId: doctor.id,
        visitTypeId: visitType.id,
        startsAt: new Date('2027-01-05T09:00:00.000Z'),
        durationMin: 30,
        status: 'SCHEDULED',
        reason: 'Review',
      },
    });

    const created = await request(harness.server)
      .post(TIME_OFF)
      .set('Authorization', `Bearer ${token}`)
      .send({ from: '2027-01-01T00:00:00.000Z', to: '2027-01-10T00:00:00.000Z' });

    // The handle, never the name: this route is about a schedule, not
    // about patients.
    const { fullName } = await harness.prisma.patient.findUniqueOrThrow({
      where: { id: patient.id },
      select: { fullName: true },
    });
    expect(JSON.stringify(created.body)).not.toContain(fullName);

    await harness.prisma.appointment.delete({ where: { id: appointment.id } });
  });

  it('rejects a block whose end precedes its start', async () => {
    const token = await seedDoctor('backwardsblock');

    const response = await request(harness.server)
      .post(TIME_OFF)
      .set('Authorization', `Bearer ${token}`)
      .send({ from: '2026-12-08T00:00:00.000Z', to: '2026-12-01T00:00:00.000Z' });

    expect(response.status).toBe(422);
  });

  it("answers 404 when cancelling another doctor's block", async () => {
    const mine = await seedDoctor('blockowner');
    const theirs = await seedDoctor('blockthief');

    const created = await request(harness.server)
      .post(TIME_OFF)
      .set('Authorization', `Bearer ${mine}`)
      .send({ from: '2026-11-01T00:00:00.000Z', to: '2026-11-02T00:00:00.000Z' });

    const id = dataOf<TimeOffResult>(created).timeOff.id;

    const refused = await request(harness.server)
      .delete(`${TIME_OFF}/${id}`)
      .set('Authorization', `Bearer ${theirs}`);

    expect(refused.status).toBe(404);

    const removed = await request(harness.server)
      .delete(`${TIME_OFF}/${id}`)
      .set('Authorization', `Bearer ${mine}`);

    expect(removed.status).toBe(204);
  });
});
