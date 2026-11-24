import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  markVerified,
  registrationBody,
  testEmail,
} from './support/auth-app';
import { deleteDoctors, deletePatients } from './support/hospital-fixture';

/**
 * The doctor's appointment book (RM M11.1–M11.4, M11.11 — API §5).
 *
 * What is worth an HTTP round trip here, as opposed to a unit test:
 *
 * · **The conflict rules are actually wired to the grid.**
 *   `slot-conflict.spec.ts` proves the arithmetic; this proves that the
 *   doctor's saved availability, their buffer and their existing
 *   bookings are the values that arithmetic runs against.
 * · **The transition matrix refuses through the API, with a `detail`.**
 *   The machine's own spec proves the table; this proves a client gets
 *   409 rather than 500 or a silent no-op.
 * · **Scope is 404, and the two scopes agree.** An appointment in
 *   another doctor's book answers exactly as one that does not exist.
 * · **Concurrency.** Two simultaneous approves yield one 200 and one
 *   409 — the test ADR-001's consequences name explicitly.
 * · **`availableActions` is the server's answer.** The frontend renders
 *   its row menu from it, so an empty or wrong list is a UI defect
 *   shipped from the backend.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const PATIENTS = '/api/v1/patients';
const APPOINTMENTS = '/api/v1/appointments';
const AVAILABILITY = '/api/v1/me/availability';
const PASSWORD = 'Medora123!';

interface SessionPayload {
  user: { id: string; role: string; permissions: string[] };
  accessToken: string;
}

interface AppointmentView {
  id: string;
  patient: { id: string; name: string; mrn: string; phone: string; age: number; gender: string };
  dateTime: string;
  durationMin: number;
  visitType: string;
  department: string | null;
  doctorId: string;
  doctor: string;
  status: string;
  priority: string;
  reason: string;
  notes: string | null;
  availableActions: string[];
}

interface AppointmentDetailView extends AppointmentView {
  cancelledReason: string | null;
  createdAt: string;
  events: {
    id: string;
    action: string;
    fromStatus: string | null;
    toStatus: string | null;
    occurredAt: string;
    actor: string;
    reason: string | null;
  }[];
  proposals: { id: string; status: string; slots: string[]; chosenSlot: number | null }[];
}

interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

/**
 * A Monday well clear of "today", so the slot-date gate is unambiguous
 * whatever day the suite runs on. 2027-03-01 is a Monday.
 */
const FUTURE_MONDAY = '2027-03-01';
const slot = (day: string, time: string): string => `${day}T${time}:00.000Z`;

/** Nine to five, Monday to Friday, with an hour of lunch. */
function week(): unknown[] {
  const open = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((weekday) => ({
    weekday,
    open: open.includes(weekday),
    windows: open.includes(weekday) ? [{ start: '09:00', end: '17:00' }] : [],
    breaks: open.includes(weekday) ? [{ start: '12:00', end: '13:00' }] : [],
  }));
}

interface Doctor {
  readonly token: string;
  readonly email: string;
}

async function seedDoctor(local: string, bufferMin = 0): Promise<Doctor> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  const token = dataOf<SessionPayload>(
    await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;

  const saved = await request(harness.server)
    .put(AVAILABILITY)
    .set('Authorization', `Bearer ${token}`)
    .send({ week: week(), defaultDurationMin: 30, bufferMin });

  expect(saved.status).toBe(200);

  return { token, email };
}

const createdCharts: string[] = [];

async function seedPatient(token: string, fullName = 'Layla Morsi'): Promise<string> {
  const response = await request(harness.server)
    .post(PATIENTS)
    .set('Authorization', `Bearer ${token}`)
    .send({
      fullName,
      dateOfBirth: '1988-04-12',
      gender: 'female',
      bloodType: 'A+',
      phone: '+20 100 777 1234',
      allergies: [],
      chronicConditions: [],
    });

  expect(response.status).toBe(201);

  const id = dataOf<{ id: string }>(response).id;
  createdCharts.push(id);

  return id;
}

async function book(
  token: string,
  patientId: string,
  overrides: Record<string, unknown> = {},
): Promise<request.Response> {
  return request(harness.server)
    .post(APPOINTMENTS)
    .set('Authorization', `Bearer ${token}`)
    .send({
      patientId,
      dateTime: slot(FUTURE_MONDAY, '10:00'),
      visitType: 'Consultation',
      reason: 'Follow-up on blood pressure',
      ...overrides,
    });
}

beforeAll(async () => {
  harness = await createAuthHarness('appointments-book', { clinicalDoctors: true });
}, 60_000);

afterAll(async () => {
  if (harness === undefined) return;

  if (createdCharts.length > 0) {
    await harness.prisma.appointment.deleteMany({
      where: { patient: { publicId: { in: createdCharts } } },
    });
    await deletePatients(harness.prisma, { where: { publicId: { in: createdCharts } } });
  }

  await harness.reset();
  await harness.close();
});

describe('POST /appointments (§5.3) — booking and the conflict rules', () => {
  it('books into the grid and returns the created appointment', async () => {
    const doctor = await seedDoctor('create');
    const patientId = await seedPatient(doctor.token);

    const response = await book(doctor.token, patientId);

    expect(response.status).toBe(201);

    const view = dataOf<AppointmentView>(response);
    expect(view.id).toMatch(/^APT-\d+$/);
    expect(view.status).toBe('scheduled');
    expect(view.priority).toBe('normal');
    // The doctor's own default, not a number this endpoint invented.
    expect(view.durationMin).toBe(30);
    expect(view.patient.id).toBe(patientId);
    expect(view.patient.mrn).not.toBe('');
    expect(view.availableActions).toEqual(['reschedule', 'cancel']);
  });

  it('refuses a slot outside the working grid with 409 naming the rule', async () => {
    const doctor = await seedDoctor('outside');
    const patientId = await seedPatient(doctor.token);

    const response = await book(doctor.token, patientId, {
      dateTime: slot(FUTURE_MONDAY, '19:00'),
    });

    expect(response.status).toBe(409);

    const error = errorBody(response);
    expect(error.code).toBe('slot_conflict');
    expect(error.detail).toContain('working hours');
  });

  it('refuses a slot inside the lunch break', async () => {
    const doctor = await seedDoctor('break');
    const patientId = await seedPatient(doctor.token);

    const response = await book(doctor.token, patientId, {
      dateTime: slot(FUTURE_MONDAY, '12:15'),
    });

    expect(response.status).toBe(409);
    expect(errorBody(response).detail).toContain('break');
  });

  it('refuses a slot on a closed day', async () => {
    const doctor = await seedDoctor('closed');
    const patientId = await seedPatient(doctor.token);

    // 2027-03-06 is the Saturday of that week.
    const response = await book(doctor.token, patientId, {
      dateTime: slot('2027-03-06', '10:00'),
    });

    expect(response.status).toBe(409);
  });

  it('refuses a second booking overlapping the first, naming the reference', async () => {
    const doctor = await seedDoctor('overlap');
    const patientId = await seedPatient(doctor.token);

    const first = await book(doctor.token, patientId);
    expect(first.status).toBe(201);
    const reference = dataOf<AppointmentView>(first).id;

    const second = await book(doctor.token, patientId, {
      dateTime: slot(FUTURE_MONDAY, '10:15'),
    });

    expect(second.status).toBe(409);
    expect(errorBody(second).detail).toContain(reference);
  });

  it('names no patient in the overlap conflict', async () => {
    const doctor = await seedDoctor('overlap-phi');
    const patientId = await seedPatient(doctor.token, 'Rania Halabi');

    await book(doctor.token, patientId);
    const second = await book(doctor.token, patientId, {
      dateTime: slot(FUTURE_MONDAY, '10:15'),
    });

    expect(JSON.stringify(second.body)).not.toContain('Rania Halabi');
  });

  it('allows a back-to-back booking when the buffer is zero', async () => {
    const doctor = await seedDoctor('backtoback');
    const patientId = await seedPatient(doctor.token);

    expect((await book(doctor.token, patientId)).status).toBe(201);
    expect(
      (await book(doctor.token, patientId, { dateTime: slot(FUTURE_MONDAY, '10:30') })).status,
    ).toBe(201);
  });

  it('refuses the same back-to-back booking once a buffer is configured', async () => {
    const doctor = await seedDoctor('buffer', 15);
    const patientId = await seedPatient(doctor.token);

    expect((await book(doctor.token, patientId)).status).toBe(201);
    expect(
      (await book(doctor.token, patientId, { dateTime: slot(FUTURE_MONDAY, '10:30') })).status,
    ).toBe(409);
  });

  it('refuses a booking for a patient the doctor has no care relationship with', async () => {
    const mine = await seedDoctor('scope-owner');
    const theirs = await seedDoctor('scope-other');
    const patientId = await seedPatient(theirs.token);

    const response = await book(mine.token, patientId);

    // 404, not 403: a 403 would confirm the chart exists (ADR-022).
    expect(response.status).toBe(404);
  });

  it('rejects an unknown visit type with a field error rather than a 500', async () => {
    const doctor = await seedDoctor('visit-type');
    const patientId = await seedPatient(doctor.token);

    const response = await book(doctor.token, patientId, { visitType: 'Teleportation' });

    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors?.['visitType']).toBeDefined();
  });

  it('rejects a blank reason', async () => {
    const doctor = await seedDoctor('blank-reason');
    const patientId = await seedPatient(doctor.token);

    const response = await book(doctor.token, patientId, { reason: '   ' });

    expect(response.status).toBe(422);
  });

  it('writes a created event onto the history', async () => {
    const doctor = await seedDoctor('created-event');
    const patientId = await seedPatient(doctor.token);
    const reference = dataOf<AppointmentView>(await book(doctor.token, patientId)).id;

    const detail = await request(harness.server)
      .get(`${APPOINTMENTS}/${reference}`)
      .set('Authorization', `Bearer ${doctor.token}`);

    const events = dataOf<AppointmentDetailView>(detail).events;
    expect(events).toHaveLength(1);
    expect(events[0]?.action).toBe('created');
    expect(events[0]?.toStatus).toBe('scheduled');
    // The snapshot names the actor rather than leaving the line blank.
    expect(events[0]?.actor).not.toBe('');
  });
});

describe('GET /appointments (§5.1) — the book', () => {
  it('returns only the caller’s own appointments', async () => {
    const mine = await seedDoctor('list-mine');
    const theirs = await seedDoctor('list-theirs');
    const minePatient = await seedPatient(mine.token);
    const theirsPatient = await seedPatient(theirs.token);

    await book(mine.token, minePatient);
    await book(theirs.token, theirsPatient);

    const page = dataOf<Page<AppointmentView>>(
      await request(harness.server).get(APPOINTMENTS).set('Authorization', `Bearer ${mine.token}`),
    );

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.patient.id).toBe(minePatient);
  });

  it('filters by status', async () => {
    const doctor = await seedDoctor('list-status');
    const patientId = await seedPatient(doctor.token);
    await book(doctor.token, patientId);

    const matching = dataOf<Page<AppointmentView>>(
      await request(harness.server)
        .get(`${APPOINTMENTS}?status=scheduled`)
        .set('Authorization', `Bearer ${doctor.token}`),
    );
    const other = dataOf<Page<AppointmentView>>(
      await request(harness.server)
        .get(`${APPOINTMENTS}?status=completed`)
        .set('Authorization', `Bearer ${doctor.token}`),
    );

    expect(matching.totalItems).toBe(1);
    expect(other.totalItems).toBe(0);
  });

  it('searches by the patient handle', async () => {
    const doctor = await seedDoctor('list-q');
    const patientId = await seedPatient(doctor.token);
    await book(doctor.token, patientId);

    const page = dataOf<Page<AppointmentView>>(
      await request(harness.server)
        .get(`${APPOINTMENTS}?q=${patientId}`)
        .set('Authorization', `Bearer ${doctor.token}`),
    );

    expect(page.totalItems).toBe(1);
  });

  it('returns a day view unpaginated and anchored on the date', async () => {
    const doctor = await seedDoctor('list-day');
    const patientId = await seedPatient(doctor.token);
    await book(doctor.token, patientId);

    const onDay = dataOf<Page<AppointmentView>>(
      await request(harness.server)
        .get(`${APPOINTMENTS}?view=day&date=${FUTURE_MONDAY}`)
        .set('Authorization', `Bearer ${doctor.token}`),
    );
    const nextDay = dataOf<Page<AppointmentView>>(
      await request(harness.server)
        .get(`${APPOINTMENTS}?view=day&date=2027-03-02`)
        .set('Authorization', `Bearer ${doctor.token}`),
    );

    expect(onDay.totalItems).toBe(1);
    expect(nextDay.totalItems).toBe(0);
  });

  it('refuses a caller with no doctor profile', async () => {
    const doctor = await seedDoctor('no-profile');
    await deleteDoctors(harness.prisma, { where: { user: { email: doctor.email } } });

    const response = await request(harness.server)
      .get(APPOINTMENTS)
      .set('Authorization', `Bearer ${doctor.token}`);

    expect(response.status).toBe(404);
  });

  it('refuses an unauthenticated caller', async () => {
    expect((await request(harness.server).get(APPOINTMENTS)).status).toBe(401);
  });
});

describe('GET /appointments/{id} (§5.2)', () => {
  it('answers 404 for another doctor’s appointment, identically to a missing one', async () => {
    const mine = await seedDoctor('detail-mine');
    const theirs = await seedDoctor('detail-theirs');
    const theirsPatient = await seedPatient(theirs.token);
    const reference = dataOf<AppointmentView>(await book(theirs.token, theirsPatient)).id;

    const foreign = await request(harness.server)
      .get(`${APPOINTMENTS}/${reference}`)
      .set('Authorization', `Bearer ${mine.token}`);
    const missing = await request(harness.server)
      .get(`${APPOINTMENTS}/APT-99999999`)
      .set('Authorization', `Bearer ${mine.token}`);

    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
  });

  it('does not shadow the summary route', async () => {
    const doctor = await seedDoctor('summary-route');

    const response = await request(harness.server)
      .get(`${APPOINTMENTS}/summary`)
      .set('Authorization', `Bearer ${doctor.token}`);

    expect(response.status).toBe(200);
    expect(dataOf<{ today: number }>(response).today).toBeTypeOf('number');
  });
});
