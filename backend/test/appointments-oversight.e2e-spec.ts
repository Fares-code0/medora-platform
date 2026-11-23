import { Secret, TOTP } from 'otpauth';
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
  grantPlatformAdmin,
  makeClinicalDoctor,
  purgeHospitalRecords,
} from './support/auth-app';

/**
 * Appointment oversight and the time-off resolution (RM M11.5, M11.6 —
 * API §5.9, §5.10, §5.11).
 *
 * Four properties, each of which is the reason its endpoint exists:
 *
 * · **The oversight table crosses doctors and masks the patient.** An
 *   administrator sees every doctor's book and gets the `PT-…` handle
 *   and nothing else — API §0.4 masks admin patient projections until
 *   M7.3's audited reveal. The test looks for the actual name in the
 *   serialized body rather than trusting the shape.
 * · **A doctor cannot reach it.** `appointments.manageOwn` is not
 *   `appointments.reassign`, and the split is the whole point of having
 *   two services over one table.
 * · **Reassignment is refused across specialties and into an
 *   unavailable slot.** A cardiology follow-up handed to a dermatologist
 *   is a clinical error a scheduling tool must not be able to make.
 * · **The blast radius is confirmed before anything is sent.** A
 *   `confirmedCount` that does not match the server's current impact
 *   count is a 409 and **nothing moves** — RM M11.5's verify step names
 *   exactly this.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const PATIENTS = '/api/v1/patients';
const APPOINTMENTS = '/api/v1/appointments';
const ADMIN_APPOINTMENTS = '/api/v1/admin/appointments';
const AVAILABILITY = '/api/v1/me/availability';
const TIME_OFF = '/api/v1/me/time-off';
const PASSWORD = 'Medora123!';

interface SessionPayload {
  accessToken: string;
}

interface OversightView {
  id: string;
  reference: string;
  startsAt: string;
  specialty: string;
  doctorId: string;
  doctorName: string;
  patientId: string;
  status: string;
  stateSince: string;
  ageInStateHours: number;
  rescheduleCount: number;
  lastNudgedAt: string | null;
  flags: string[];
}

interface OversightPage {
  items: OversightView[];
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  flaggedItems: number;
}

interface ResolutionResult {
  action: string;
  resolved: string[];
  skipped: { id: string; reason: string }[];
  notified: number;
}

/** 2027-03-01 is a Monday. */
const FUTURE_MONDAY = '2027-03-01';

const slot = (time: string): string => `${FUTURE_MONDAY}T${time}:00.000Z`;

function week(): unknown[] {
  const open = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((weekday) => ({
    weekday,
    open: open.includes(weekday),
    windows: open.includes(weekday) ? [{ start: '09:00', end: '17:00' }] : [],
    breaks: [],
  }));
}

interface Doctor {
  readonly token: string;
  readonly email: string;
  readonly id: string;
}

async function seedDoctor(local: string, specialty?: string): Promise<Doctor> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  // Clinical standing at the fixture hospital (§2.6, DR-05).
  await makeClinicalDoctor(harness.prisma, email);

  const token = dataOf<SessionPayload>(
    await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;

  await request(harness.server)
    .put(AVAILABILITY)
    .set('Authorization', `Bearer ${token}`)
    .send({ week: week(), defaultDurationMin: 30, bufferMin: 0 });

  const row = await harness.prisma.doctor.findFirstOrThrow({
    where: { user: { email } },
    select: { id: true },
  });

  if (specialty !== undefined) {
    await harness.prisma.doctor.update({ where: { id: row.id }, data: { specialty } });
  }

  return { token, email, id: row.id };
}

function currentCode(secret: string): string {
  return new TOTP({
    algorithm: 'SHA1',
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(secret),
  }).generate();
}

/** An administrator: registered as a doctor, then stripped of the row. */
async function seedAdmin(local: string): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  const bootstrap = dataOf<SessionPayload>(
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
  await harness.prisma.user.update({ where: { email }, data: { roleId: adminRole.id } });
  await grantPlatformAdmin(harness.prisma, email);
  await harness.prisma.doctor.deleteMany({ where: { user: { email } } });

  const login = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });

  return dataOf<SessionPayload>(
    await request(harness.server)
      .post('/api/v1/auth/otp/verify')
      .send({ otpToken: dataOf<{ otpToken: string }>(login).otpToken, code: currentCode(secret) }),
  ).accessToken;
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

  const id = dataOf<{ id: string }>(response).id;
  createdCharts.push(id);

  return id;
}

async function book(token: string, patientId: string, time = '10:00'): Promise<string> {
  const response = await request(harness.server)
    .post(APPOINTMENTS)
    .set('Authorization', `Bearer ${token}`)
    .send({
      patientId,
      dateTime: slot(time),
      visitType: 'Consultation',
      reason: 'Follow-up on blood pressure',
    });

  expect(response.status).toBe(201);

  return dataOf<{ id: string }>(response).id;
}

/**
 * A request in `pending`, inserted rather than booked.
 *
 * There is no API path to `pending`: it is the state a **patient's**
 * request arrives in, and the patient-side booking route deliberately
 * does not exist yet. An INSERT is not a transition, so the M5.10
 * trigger is not being worked around — `UPDATE … SET status = 'pending'`
 * is refused by it, correctly.
 */
async function seedPending(doctor: Doctor, patientPublicId: string): Promise<string> {
  const doctorRow = await harness.prisma.doctor.findUniqueOrThrow({
    where: { id: doctor.id },
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
      doctorId: doctorRow.id,
      departmentId: doctorRow.departmentId,
      visitTypeId: visitType.id,
      startsAt: new Date(slot('10:00')),
      durationMin: 30,
      status: 'PENDING',
      reason: 'Requested by the patient',
    },
  });

  return publicId;
}

beforeAll(async () => {
  harness = await createAuthHarness('appointments-oversight');
}, 60_000);

afterAll(async () => {
  if (harness === undefined) return;

  if (createdCharts.length > 0) {
    await harness.prisma.appointment.deleteMany({
      where: { patient: { publicId: { in: createdCharts } } },
    });
    const charts = await harness.prisma.patient.findMany({
      where: { publicId: { in: createdCharts } },
      select: { id: true },
    });
    await purgeHospitalRecords(
      harness.prisma,
      charts.map((row) => row.id),
    );
    await harness.prisma.patient.deleteMany({ where: { publicId: { in: createdCharts } } });
  }

  await harness.reset();
  await harness.close();
});

describe('GET /admin/appointments (§5.10)', () => {
  it('crosses doctors and carries the age-in-state', async () => {
    const admin = await seedAdmin('oversight-list-admin');
    const doctor = await seedDoctor('oversight-list-doc');
    const patientId = await seedPatient(doctor.token);
    const reference = await book(doctor.token, patientId);

    const page = dataOf<OversightPage>(
      await request(harness.server)
        .get(`${ADMIN_APPOINTMENTS}?doctorId=${doctor.id}`)
        .set('Authorization', `Bearer ${admin.toString()}`),
    );

    expect(page.items).toHaveLength(1);

    const row = page.items[0];
    expect(row?.reference).toBe(reference);
    expect(row?.doctorId).toBe(doctor.id);
    expect(row?.ageInStateHours).toBe(0);
    expect(row?.rescheduleCount).toBe(0);
    expect(row?.flags).toEqual([]);
  });

  it('masks the patient — the handle is served, the identity is not', async () => {
    const admin = await seedAdmin('oversight-mask-admin');
    const doctor = await seedDoctor('oversight-mask-doc');
    const patientId = await seedPatient(doctor.token, 'Rania Halabi');
    await book(doctor.token, patientId);

    const response = await request(harness.server)
      .get(`${ADMIN_APPOINTMENTS}?doctorId=${doctor.id}`)
      .set('Authorization', `Bearer ${admin}`);

    const serialized = JSON.stringify(response.body);
    expect(serialized).toContain(patientId);
    // Asserted against the serialized body rather than the type: a
    // widened `select` would satisfy the interface and still leak.
    expect(serialized).not.toContain('Rania Halabi');
  });

  it('refuses a doctor holding only appointments.manageOwn', async () => {
    const doctor = await seedDoctor('oversight-forbidden');

    const response = await request(harness.server)
      .get(ADMIN_APPOINTMENTS)
      .set('Authorization', `Bearer ${doctor.token}`);

    expect(response.status).toBe(403);
  });

  it('refuses an unauthenticated caller', async () => {
    expect((await request(harness.server).get(ADMIN_APPOINTMENTS)).status).toBe(401);
  });

  it('counts a reschedule toward the repeated-reschedules signal', async () => {
    const admin = await seedAdmin('oversight-resched-admin');
    const doctor = await seedDoctor('oversight-resched-doc');
    const patientId = await seedPatient(doctor.token);
    const reference = await book(doctor.token, patientId);

    await request(harness.server)
      .post(`${APPOINTMENTS}/${reference}/reschedule`)
      .set('Authorization', `Bearer ${doctor.token}`)
      .send({ dateTime: slot('14:00'), reason: 'Doctor called into theatre' });

    const page = dataOf<OversightPage>(
      await request(harness.server)
        .get(`${ADMIN_APPOINTMENTS}?doctorId=${doctor.id}`)
        .set('Authorization', `Bearer ${admin}`),
    );

    expect(page.items[0]?.rescheduleCount).toBe(1);
    expect(page.items[0]?.status).toBe('rescheduled');
  });

  it('serves the administrator summary strip with its denominator', async () => {
    const admin = await seedAdmin('oversight-summary');

    const summary = dataOf<{
      cancellationRate7d: number;
      noShowRate7d: number;
      window7dTotal: number;
      pendingOverDay: number;
    }>(
      await request(harness.server)
        .get(`${ADMIN_APPOINTMENTS}/summary`)
        .set('Authorization', `Bearer ${admin}`),
    );

    expect(summary.cancellationRate7d).toBeGreaterThanOrEqual(0);
    expect(summary.cancellationRate7d).toBeLessThanOrEqual(1);
    expect(summary.window7dTotal).toBeTypeOf('number');
    expect(summary.pendingOverDay).toBeTypeOf('number');
  });
});

describe('POST /admin/appointments/{id}/nudge (§5.10)', () => {
  it('records a nudge without changing the status', async () => {
    const admin = await seedAdmin('nudge-admin');
    const doctor = await seedDoctor('nudge-doc');
    const reference = await book(doctor.token, await seedPatient(doctor.token));

    const response = await request(harness.server)
      .post(`${ADMIN_APPOINTMENTS}/${reference}/nudge`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ template: 'awaiting-confirmation' });

    expect(response.status).toBe(200);

    const view = dataOf<OversightView>(response);
    expect(view.status).toBe('scheduled');
    expect(view.lastNudgedAt).not.toBeNull();
  });

  /**
   * ADM-05 ships a 60-minute cooldown as a disabled button. A rule that
   * lives only in the UI is not a rule — a second administrator, or the
   * same one after a reload, sends the reminder anyway, and the person
   * receiving three in ten minutes is the patient.
   */
  it('refuses a second nudge inside the cooldown window', async () => {
    const admin = await seedAdmin('nudge-cooldown-admin');
    const doctor = await seedDoctor('nudge-cooldown-doc');
    const reference = await book(doctor.token, await seedPatient(doctor.token));

    const first = await request(harness.server)
      .post(`${ADMIN_APPOINTMENTS}/${reference}/nudge`)
      .set('Authorization', `Bearer ${admin}`)
      .send({});
    expect(first.status).toBe(200);

    const second = await request(harness.server)
      .post(`${ADMIN_APPOINTMENTS}/${reference}/nudge`)
      .set('Authorization', `Bearer ${admin}`)
      .send({});

    expect(second.status).toBe(409);
    expect(errorBody(second).code).toBe('nudge_cooldown');
  });

  it('allows the next nudge once the cooldown has elapsed', async () => {
    const admin = await seedAdmin('nudge-elapsed-admin');
    const doctor = await seedDoctor('nudge-elapsed-doc');
    const reference = await book(doctor.token, await seedPatient(doctor.token));

    await request(harness.server)
      .post(`${ADMIN_APPOINTMENTS}/${reference}/nudge`)
      .set('Authorization', `Bearer ${admin}`)
      .send({});

    // Backdate the event rather than waiting an hour: the rule under
    // test is the comparison, not the clock.
    const appointment = await harness.prisma.appointment.findUniqueOrThrow({
      where: { publicId: reference },
      select: { id: true },
    });
    await harness.prisma.appointmentEvent.updateMany({
      where: { appointmentId: appointment.id, action: 'NUDGED' },
      data: { occurredAt: new Date(Date.now() - 61 * 60_000) },
    });

    const second = await request(harness.server)
      .post(`${ADMIN_APPOINTMENTS}/${reference}/nudge`)
      .set('Authorization', `Bearer ${admin}`)
      .send({});

    expect(second.status).toBe(200);
  });

  it('refuses to nudge a terminal appointment', async () => {
    const admin = await seedAdmin('nudge-terminal-admin');
    const doctor = await seedDoctor('nudge-terminal-doc');
    const reference = await book(doctor.token, await seedPatient(doctor.token));

    await request(harness.server)
      .post(`${APPOINTMENTS}/${reference}/cancel`)
      .set('Authorization', `Bearer ${doctor.token}`)
      .send({ reason: 'Patient withdrew' });

    const response = await request(harness.server)
      .post(`${ADMIN_APPOINTMENTS}/${reference}/nudge`)
      .set('Authorization', `Bearer ${admin}`)
      .send({});

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('nudge_not_applicable');
  });
});

describe('POST /admin/appointments/{id}/reassign (§5.10)', () => {
  it('moves the appointment to another doctor of the same specialty', async () => {
    const admin = await seedAdmin('reassign-admin');
    const from = await seedDoctor('reassign-from', 'Cardiology');
    const to = await seedDoctor('reassign-to', 'Cardiology');
    const reference = await book(from.token, await seedPatient(from.token));

    const response = await request(harness.server)
      .post(`${ADMIN_APPOINTMENTS}/${reference}/reassign`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ doctorId: to.id, reason: 'Original doctor on emergency leave' });

    expect(response.status).toBe(200);
    expect(dataOf<OversightView>(response).doctorId).toBe(to.id);

    // The appointment is now in the receiving doctor's book, and out of
    // the original's — the move is a scope change, not a copy.
    const receiving = dataOf<{ items: { id: string }[] }>(
      await request(harness.server)
        .get(APPOINTMENTS)
        .set('Authorization', `Bearer ${to.token}`),
    );
    const original = dataOf<{ items: { id: string }[] }>(
      await request(harness.server)
        .get(APPOINTMENTS)
        .set('Authorization', `Bearer ${from.token}`),
    );

    expect(receiving.items.map((item) => item.id)).toContain(reference);
    expect(original.items.map((item) => item.id)).not.toContain(reference);
  });

  it('refuses a reassignment across specialties', async () => {
    const admin = await seedAdmin('reassign-specialty-admin');
    const from = await seedDoctor('reassign-specialty-from', 'Cardiology');
    const to = await seedDoctor('reassign-specialty-to', 'Dermatology');
    const reference = await book(from.token, await seedPatient(from.token));

    const response = await request(harness.server)
      .post(`${ADMIN_APPOINTMENTS}/${reference}/reassign`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ doctorId: to.id, reason: 'Rebalancing the list' });

    // 422 with a field path, per RM M11.6: the picker needs a field to
    // highlight, not a bare conflict.
    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('specialty_mismatch');
    expect(errorBody(response).fieldErrors?.['doctorId']).toBeDefined();
  });

  it('refuses a reassignment into a slot the receiving doctor is not working', async () => {
    const admin = await seedAdmin('reassign-busy-admin');
    const from = await seedDoctor('reassign-busy-from', 'Neurology');
    const to = await seedDoctor('reassign-busy-to', 'Neurology');
    const reference = await book(from.token, await seedPatient(from.token));

    // The receiving doctor closes the day the appointment sits on.
    await request(harness.server)
      .put(AVAILABILITY)
      .set('Authorization', `Bearer ${to.token}`)
      .send({
        week: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((weekday) => ({
          weekday,
          open: weekday === 'Tue',
          windows: weekday === 'Tue' ? [{ start: '09:00', end: '17:00' }] : [],
          breaks: [],
        })),
        defaultDurationMin: 30,
        bufferMin: 0,
      });

    const response = await request(harness.server)
      .post(`${ADMIN_APPOINTMENTS}/${reference}/reassign`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ doctorId: to.id, reason: 'Rebalancing the list' });

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('slot_conflict');
  });

  it('refuses a reassignment to the doctor who already holds it', async () => {
    const admin = await seedAdmin('reassign-same-admin');
    const doctor = await seedDoctor('reassign-same-doc', 'Oncology');
    const reference = await book(doctor.token, await seedPatient(doctor.token));

    const response = await request(harness.server)
      .post(`${ADMIN_APPOINTMENTS}/${reference}/reassign`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ doctorId: doctor.id, reason: 'No change' });

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('reassign_no_change');
  });
});

describe('POST /admin/appointments/{id}/cancel-administratively (§5.10)', () => {
  it('cancels with a category and marks the event administrative', async () => {
    const admin = await seedAdmin('admin-cancel-admin');
    const doctor = await seedDoctor('admin-cancel-doc');
    const reference = await book(doctor.token, await seedPatient(doctor.token));

    const response = await request(harness.server)
      .post(`${ADMIN_APPOINTMENTS}/${reference}/cancel-administratively`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ category: 'clinic-closure', reason: 'Clinic closed for refurbishment' });

    expect(response.status).toBe(200);
    expect(dataOf<OversightView>(response).status).toBe('cancelled');

    const view = dataOf<{ events: { action: string; detail: unknown }[] }>(
      await request(harness.server)
        .get(`${APPOINTMENTS}/${reference}`)
        .set('Authorization', `Bearer ${doctor.token}`),
    );
    const cancellation = view.events.find((event) => event.action === 'cancel');
    // The trail has to say who overrode whom — an administrative
    // cancellation that looked like the doctor's own would be useless at
    // exactly the moment it matters.
    expect(cancellation?.detail).toMatchObject({ administrative: true });
  });

  it('refuses an unknown category', async () => {
    const admin = await seedAdmin('admin-cancel-category');
    const doctor = await seedDoctor('admin-cancel-category-doc');
    const reference = await book(doctor.token, await seedPatient(doctor.token));

    const response = await request(harness.server)
      .post(`${ADMIN_APPOINTMENTS}/${reference}/cancel-administratively`)
      .set('Authorization', `Bearer ${admin}`)
      .send({ category: 'because', reason: 'Because' });

    expect(response.status).toBe(422);
  });
});

describe('POST /me/time-off/{id}/resolve (§5.9) — the blast radius', () => {
  /** Books a block covering the whole Monday, over `count` appointments. */
  async function blockWith(local: string, count: number): Promise<{
    doctor: Doctor;
    timeOffId: string;
    references: string[];
  }> {
    const doctor = await seedDoctor(local);
    const patientId = await seedPatient(doctor.token);
    const references: string[] = [];

    for (let index = 0; index < count; index += 1) {
      references.push(await book(doctor.token, patientId, `${String(10 + index)}:00`));
    }

    const timeOff = await request(harness.server)
      .post(TIME_OFF)
      .set('Authorization', `Bearer ${doctor.token}`)
      .send({
        from: `${FUTURE_MONDAY}T00:00:00.000Z`,
        to: `${FUTURE_MONDAY}T23:59:00.000Z`,
        kind: 'emergency-block',
        mode: 'block-new',
      });

    expect(timeOff.status).toBe(201);

    const result = dataOf<{ timeOff: { id: string }; impacted: unknown[] }>(timeOff);
    expect(result.impacted).toHaveLength(count);

    return { doctor, timeOffId: result.timeOff.id, references };
  }

  it('refuses when the confirmed count does not match, and moves nothing', async () => {
    const { doctor, timeOffId, references } = await blockWith('resolve-mismatch', 2);

    const response = await request(harness.server)
      .post(`${TIME_OFF}/${timeOffId}/resolve`)
      .set('Authorization', `Bearer ${doctor.token}`)
      .send({ action: 'cancel-apology', confirmedCount: 1 });

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('blast_radius_changed');

    // Nothing sent, nothing moved — RM M11.5's verify step.
    for (const reference of references) {
      const view = dataOf<{ status: string }>(
        await request(harness.server)
          .get(`${APPOINTMENTS}/${reference}`)
          .set('Authorization', `Bearer ${doctor.token}`),
      );
      expect(view.status).toBe('scheduled');
    }
  });

  it('cancels every impacted appointment when the count matches', async () => {
    const { doctor, timeOffId, references } = await blockWith('resolve-cancel', 2);

    const response = await request(harness.server)
      .post(`${TIME_OFF}/${timeOffId}/resolve`)
      .set('Authorization', `Bearer ${doctor.token}`)
      .send({
        action: 'cancel-apology',
        confirmedCount: 2,
        reason: 'The clinic is closed that day',
      });

    expect(response.status).toBe(200);

    const result = dataOf<ResolutionResult>(response);
    expect(result.resolved).toHaveLength(2);
    expect(result.skipped).toHaveLength(0);

    for (const reference of references) {
      const view = dataOf<{ status: string; cancelledReason: string | null }>(
        await request(harness.server)
          .get(`${APPOINTMENTS}/${reference}`)
          .set('Authorization', `Bearer ${doctor.token}`),
      );
      expect(view.status).toBe('cancelled');
      expect(view.cancelledReason).toBe('The clinic is closed that day');
    }
  });

  /**
   * The documented gap, asserted rather than assumed.
   *
   * ADR-001 permits `awaiting-patient` only from `pending` (RA-001.1),
   * and the M5.10 trigger encodes the same restriction — so a
   * `scheduled` appointment cannot take this resolution. The endpoint
   * reports it in `skipped` with the refused transition named, and
   * leaves the row alone. This test exists to make that behaviour
   * deliberate: if RA-001.1 is later resolved by widening the matrix,
   * this test fails and says so, rather than the gap quietly closing
   * without anyone deciding it should.
   */
  it('skips a scheduled appointment on a reschedule proposal, and says why', async () => {
    const { doctor, timeOffId, references } = await blockWith('resolve-propose', 1);

    const result = dataOf<ResolutionResult>(
      await request(harness.server)
        .post(`${TIME_OFF}/${timeOffId}/resolve`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({ action: 'reschedule-proposal', confirmedCount: 1 }),
    );

    expect(result.resolved).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]?.id).toBe(references[0]);
    expect(result.skipped[0]?.reason).toContain('awaiting-patient');

    const view = dataOf<{ status: string }>(
      await request(harness.server)
        .get(`${APPOINTMENTS}/${references[0] ?? ''}`)
        .set('Authorization', `Bearer ${doctor.token}`),
    );
    expect(view.status).toBe('scheduled');
  });

  it('applies the reschedule proposal to a pending request, which ADR-001 allows', async () => {
    const doctor = await seedDoctor('resolve-propose-pending');
    const patientId = await seedPatient(doctor.token);
    const reference = await seedPending(doctor, patientId);

    const timeOff = dataOf<{ timeOff: { id: string }; impacted: unknown[] }>(
      await request(harness.server)
        .post(TIME_OFF)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({
          from: `${FUTURE_MONDAY}T00:00:00.000Z`,
          to: `${FUTURE_MONDAY}T23:59:00.000Z`,
          kind: 'emergency-block',
          mode: 'block-new',
        }),
    );

    const result = dataOf<ResolutionResult>(
      await request(harness.server)
        .post(`${TIME_OFF}/${timeOff.timeOff.id}/resolve`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({ action: 'reschedule-proposal', confirmedCount: timeOff.impacted.length }),
    );

    expect(result.resolved).toContain(reference);

    const view = dataOf<{ status: string }>(
      await request(harness.server)
        .get(`${APPOINTMENTS}/${reference}`)
        .set('Authorization', `Bearer ${doctor.token}`),
    );
    expect(view.status).toBe('awaiting-patient');
  });

  it('leaves the status alone on a handover, and still writes the event', async () => {
    const { doctor, timeOffId, references } = await blockWith('resolve-handover', 1);

    const result = dataOf<ResolutionResult>(
      await request(harness.server)
        .post(`${TIME_OFF}/${timeOffId}/resolve`)
        .set('Authorization', `Bearer ${doctor.token}`)
        .send({ action: 'handover', confirmedCount: 1 }),
    );

    expect(result.resolved).toHaveLength(1);

    const view = dataOf<{ status: string; events: { action: string }[] }>(
      await request(harness.server)
        .get(`${APPOINTMENTS}/${references[0] ?? ''}`)
        .set('Authorization', `Bearer ${doctor.token}`),
    );

    expect(view.status).toBe('scheduled');
    expect(view.events.some((event) => event.action === 'nudged')).toBe(true);
  });

  it("answers 404 for another doctor's block", async () => {
    const { timeOffId } = await blockWith('resolve-foreign', 1);
    const stranger = await seedDoctor('resolve-stranger');

    const response = await request(harness.server)
      .post(`${TIME_OFF}/${timeOffId}/resolve`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .send({ action: 'cancel-apology', confirmedCount: 1 });

    expect(response.status).toBe(404);
  });
});
