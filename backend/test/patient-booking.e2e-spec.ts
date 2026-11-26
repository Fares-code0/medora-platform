import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  fixtureHospital,
  makeClinicalDoctor,
  markVerified,
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
 * Patient appointment actions end to end (ADR-049): booking a published
 * slot, cancelling before the start, and the reschedule-request lifecycle
 * with the clinic's approve / reject.
 *
 * Runs unchanged under the restricted runtime role with tenant context on
 * (`npm run test:e2e:runtime-role -- test/patient-booking.e2e-spec.ts`),
 * which is what proves the RLS paths: a patient request in `patient`
 * scope, the booking transaction in the slot hospital's scope.
 */
let harness: AuthHarness;

const PREFIX = '/api/v1';
const REGISTER = `${PREFIX}/auth/register`;
const LOGIN = `${PREFIX}/auth/login`;
const VERIFY = `${PREFIX}/auth/verify-email`;
const ME_APPOINTMENTS = `${PREFIX}/me/appointments`;
const STAFF = `${PREFIX}/appointments`;
const PASSWORD = 'Medora123!';
const PATIENT_TAG = 'pbk';

interface Session {
  readonly token: string;
  readonly userId: string;
}

interface Doctor {
  readonly token: string;
  readonly doctorId: string;
  readonly hospitalId: string;
  readonly employmentId: string;
}

interface Detail {
  id: string;
  status: string;
  startsAt: string;
  durationMin: number;
  hospital: { id: string; name: string } | null;
  availableActions: string[];
  cancelledReason: string | null;
  pendingRescheduleRequest: RequestView | null;
  events: { action: string; actor: string }[];
}

interface RequestView {
  id: string;
  appointmentId: string;
  status: string;
  requestedSlot: { id: string; startsAt: string; durationMin: number };
  note: string | null;
  decisionReason: string | null;
  decidedAt: string | null;
}

let records: PatientRecord[];
let doctorA: Doctor;
let doctorB: Doctor;
let slotHour = 0;

beforeAll(async () => {
  harness = await createAuthHarness('patient-booking');
  records = await createPatientRecords(harness.prisma, PATIENT_TAG, 4);
  doctorA = await seedDoctor('dra', 'pbka');
  doctorB = await seedDoctor('drb', 'pbkb');
}, 120_000);

afterAll(async () => {
  if (harness === undefined) return;
  await destroyPatientRecords(harness.prisma, PATIENT_TAG);
  await harness.prisma.insuranceProvider.deleteMany({ where: { name: 'E2E patient-booking insurer' } });
  // Employments, their slots and the appointments on them go with the
  // suite's staffing (`deleteWithDependents`).
  await harness.reset();
  await harness.close();
}, 120_000);

beforeEach(async () => {
  // Unlink this file's patient records from the previous test's accounts
  // (the accounts are deleted by `reset()` below; `user_id` is SET NULL).
  await harness.prisma.patientInsurance.deleteMany({
    where: { patient: { publicId: { in: records.map((r) => r.publicId) } } },
  });
});

async function signUp(local: string, role = 'patient'): Promise<Session> {
  const email = testEmail(`${local}-${randomUUID().slice(0, 6)}`);
  await request(harness.server).post(REGISTER).send(registrationBody({ email, role })).expect(201);
  await request(harness.server)
    .post(VERIFY)
    .send({ token: tokenFromLink(mailBody(harness.sink.lastTo(email)!)) })
    .expect(204);
  const login = await request(harness.server).post(LOGIN).send({ email, password: PASSWORD }).expect(200);
  const row = await harness.prisma.user.findUniqueOrThrow({ where: { email } });
  return { token: dataOf<{ accessToken: string }>(login).accessToken, userId: row.id };
}

/** A patient account linked to record `index` (fixture-only link, as the contract allows in tests). */
async function patient(index: number): Promise<Session> {
  const session = await signUp(`p${index}`);
  await harness.prisma.patient.update({ where: { id: records[index]!.id }, data: { userId: session.userId } });
  return session;
}

async function seedDoctor(local: string, hospitalKey: string): Promise<Doctor> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  const hospitalId = await fixtureHospital(harness.prisma, hospitalKey);
  const { doctorId } = await makeClinicalDoctor(harness.prisma, email, hospitalId);
  const employment = await harness.prisma.doctorEmployment.findFirstOrThrow({
    where: { doctorId, endedAt: null },
    select: { id: true },
  });
  const token = dataOf<{ accessToken: string }>(
    await request(harness.server).post(LOGIN).send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;
  return { token, doctorId, hospitalId, employmentId: employment.id };
}

/** A fresh published slot for `doctor`, an hour after the previous one. */
async function publishSlot(doctor: Doctor, options: { startsAt?: Date; withdrawn?: boolean } = {}): Promise<string> {
  slotHour += 1;
  const startsAt = options.startsAt ?? new Date(Date.UTC(2031, 0, 1, 0, 0) + slotHour * 3_600_000);
  const slot = await harness.prisma.publishedSlot.create({
    data: {
      hospitalId: doctor.hospitalId,
      doctorEmploymentId: doctor.employmentId,
      startsAt,
      durationMinutes: 30,
      ...(options.withdrawn === true ? { withdrawnAt: new Date() } : {}),
    },
    select: { id: true },
  });
  return slot.id;
}

function book(session: Session, slotId: string, key: string = randomUUID()) {
  return request(harness.server)
    .post(ME_APPOINTMENTS)
    .set('Authorization', `Bearer ${session.token}`)
    .set('Idempotency-Key', key)
    .send({ slotId, reason: 'Routine check' });
}

async function booked(session: Session, slotId: string): Promise<Detail> {
  const response = await book(session, slotId);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  return dataOf<Detail>(response);
}

async function confirm(appointmentId: string): Promise<void> {
  const response = await request(harness.server)
    .post(`${STAFF}/${appointmentId}/approve`)
    .set('Authorization', `Bearer ${doctorA.token}`);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
}

function requestMove(session: Session, appointmentId: string, slotId: string) {
  return request(harness.server)
    .post(`${ME_APPOINTMENTS}/${appointmentId}/reschedule-requests`)
    .set('Authorization', `Bearer ${session.token}`)
    .set('Idempotency-Key', randomUUID())
    .send({ slotId, note: 'Mornings suit me better' });
}

function cancel(session: Session, appointmentId: string, reasonCode = 'schedule_conflict') {
  return request(harness.server)
    .post(`${ME_APPOINTMENTS}/${appointmentId}/cancel`)
    .set('Authorization', `Bearer ${session.token}`)
    .send({ reasonCode, note: 'Work trip' });
}

describe('slots and visit types', () => {
  it('lists only published, unbooked, future, non-withdrawn slots', async () => {
    const me = await patient(0);
    const open = await publishSlot(doctorA);
    const taken = await publishSlot(doctorA);
    const withdrawn = await publishSlot(doctorA, { withdrawn: true });
    await booked(me, taken);

    const response = await request(harness.server)
      .get(`${PREFIX}/patient/doctors/${doctorA.doctorId}/slots?from=2031-01-01T00:00:00Z&to=2031-01-31T00:00:00Z`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);
    const ids = dataOf<{ id: string; hospital: { id: string } }[]>(response).map((slot) => slot.id);

    expect(ids).toContain(open);
    expect(ids).not.toContain(taken);
    expect(ids).not.toContain(withdrawn);
  });

  it('refuses a window over 31 days', async () => {
    const me = await patient(0);
    await request(harness.server)
      .get(`${PREFIX}/patient/doctors/${doctorA.doctorId}/slots?from=2031-01-01T00:00:00Z&to=2031-03-01T00:00:00Z`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(422);
  });

  it('serves the active visit types to a patient and refuses a doctor', async () => {
    const me = await patient(0);
    const response = await request(harness.server)
      .get(`${PREFIX}/patient/visit-types`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);
    expect(dataOf<{ name: string }[]>(response).map((v) => v.name)).toContain('Consultation');

    const denied = await request(harness.server)
      .get(`${PREFIX}/patient/visit-types`)
      .set('Authorization', `Bearer ${doctorA.token}`);
    expect(denied.status).toBe(403);
    expect(errorBody(denied).code).toBe('patient_only');
  });
});

describe('POST /me/appointments', () => {
  it('books a slot as pending, opens the hospital record, and offers cancel', async () => {
    const me = await patient(1);
    const slot = await publishSlot(doctorA);

    const detail = await booked(me, slot);

    expect(detail.status).toBe('pending');
    expect(detail.hospital).toEqual({ id: doctorA.hospitalId, name: expect.any(String) });
    expect(detail.availableActions).toEqual(['cancel']);
    expect(detail.pendingRescheduleRequest).toBeNull();
    expect(detail.events[0]).toMatchObject({ action: 'created', actor: 'patient' });

    const row = await harness.prisma.appointment.findUniqueOrThrow({ where: { publicId: detail.id } });
    expect(row.publishedSlotId).toBe(slot);
    expect(row.hospitalId).toBe(doctorA.hospitalId);
    const record = await harness.prisma.hospitalMedicalRecord.findUnique({
      where: { patientId_hospitalId: { patientId: records[1]!.id, hospitalId: doctorA.hospitalId } },
    });
    expect(record).not.toBeNull();
    expect(row.hospitalMedicalRecordId).toBe(record!.id);
  });

  it('gives exactly one 201 to N concurrent bookings of one slot', async () => {
    const first = await patient(1);
    const second = await patient(2);
    const slot = await publishSlot(doctorA);

    const responses = await Promise.all(
      Array.from({ length: 6 }, (_, index) => book(index % 2 === 0 ? first : second, slot)),
    );
    const statuses = responses.map((response) => response.status).sort();

    expect(statuses.filter((status) => status === 201)).toHaveLength(1);
    expect(statuses.filter((status) => status === 409)).toHaveLength(5);
    for (const response of responses.filter((r) => r.status === 409)) {
      expect(errorBody(response).code).toBe('slot_taken');
    }
    expect(await harness.prisma.appointment.count({ where: { publishedSlotId: slot } })).toBe(1);
  });

  it('replays the same appointment for a repeated Idempotency-Key', async () => {
    const me = await patient(1);
    const slot = await publishSlot(doctorA);
    const key = randomUUID();

    const first = await book(me, slot, key).expect(201);
    const replay = await book(me, slot, key).expect(201);

    expect(dataOf<Detail>(replay).id).toBe(dataOf<Detail>(first).id);
    expect(replay.headers['idempotency-replayed']).toBe('true');
    expect(await harness.prisma.appointment.count({ where: { publishedSlotId: slot } })).toBe(1);
  });

  it('requires the Idempotency-Key header', async () => {
    const me = await patient(1);
    const slot = await publishSlot(doctorA);
    const response = await request(harness.server)
      .post(ME_APPOINTMENTS)
      .set('Authorization', `Bearer ${me.token}`)
      .send({ slotId: slot, reason: 'Routine check' });
    expect(response.status).toBe(422);
  });

  it('refuses a withdrawn, a past and a booked slot, and an unknown one', async () => {
    const me = await patient(1);
    const other = await patient(2);

    const withdrawn = await publishSlot(doctorA, { withdrawn: true });
    expect((await book(me, withdrawn)).status).toBe(404);

    const past = await publishSlot(doctorA, { startsAt: new Date('2024-01-01T09:00:00Z') });
    const pastResponse = await book(me, past);
    expect(pastResponse.status).toBe(409);
    expect(errorBody(pastResponse).code).toBe('slot_taken');

    const taken = await publishSlot(doctorA);
    await booked(other, taken);
    const takenResponse = await book(me, taken);
    expect(takenResponse.status).toBe(409);
    expect(errorBody(takenResponse).code).toBe('slot_taken');

    expect((await book(me, randomUUID())).status).toBe(404);
  });

  it('answers 409 patient_not_linked for an unlinked patient account', async () => {
    const unlinked = await signUp('unlinked');
    const response = await book(unlinked, await publishSlot(doctorA));
    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('patient_not_linked');
  });

  it('answers 403 patient_only to a non-patient role', async () => {
    const response = await request(harness.server)
      .post(ME_APPOINTMENTS)
      .set('Authorization', `Bearer ${doctorA.token}`)
      .set('Idempotency-Key', randomUUID())
      .send({ slotId: await publishSlot(doctorA), reason: 'Routine check' });
    expect(response.status).toBe(403);
    expect(errorBody(response).code).toBe('patient_only');
  });

  it('refuses an insured patient at a hospital that does not cover the provider (OD-14)', async () => {
    const me = await patient(3);
    const provider = await harness.prisma.insuranceProvider.upsert({
      where: { name: 'E2E patient-booking insurer' },
      create: { name: 'E2E patient-booking insurer' },
      update: {},
      select: { id: true },
    });
    await harness.prisma.patientInsurance.create({
      data: { patientId: records[3]!.id, providerId: provider.id, policyNumber: `POL-${randomUUID().slice(0, 8)}` },
    });

    const response = await book(me, await publishSlot(doctorA));
    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('insurance_not_covered');
  });
});

describe('POST /me/appointments/:id/cancel', () => {
  it('cancels before the start, stores the closed reason, and frees the slot', async () => {
    const me = await patient(1);
    const other = await patient(2);
    const slot = await publishSlot(doctorA);
    const detail = await booked(me, slot);

    const response = await cancel(me, detail.id).expect(200);
    const cancelled = dataOf<Detail>(response);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancelledReason).toBe('patient:schedule_conflict — Work trip');
    expect(cancelled.availableActions).toEqual([]);

    // The freed slot is bookable again.
    await booked(other, slot);

    // The patient is not notified of their own act; the doctor is.
    const events = await harness.prisma.domainEvent.findMany({
      where: { payload: { path: ['appointmentId'], equals: detail.id } },
      select: { topic: true },
    });
    const topics = events.map((event) => event.topic);
    expect(topics).toContain('appointment.cancelled_by_patient');
    expect(topics).not.toContain('appointment.cancelled');
  });

  it('refuses after the start (409) and on a terminal appointment (409)', async () => {
    const me = await patient(1);
    const visitType = await harness.prisma.visitType.findFirstOrThrow({ select: { id: true } });
    const started = await harness.prisma.appointment.create({
      data: {
        publicId: `APT-Tpbk-${Math.floor(Math.random() * 1_000_000)}`,
        patientId: records[1]!.id,
        doctorId: doctorA.doctorId,
        visitTypeId: visitType.id,
        startsAt: new Date(Date.now() - 60_000),
        durationMin: 30,
        status: 'CONFIRMED',
        reason: 'Started already',
      },
      select: { publicId: true },
    });
    const late = await cancel(me, started.publicId);
    expect(late.status).toBe(409);
    expect(errorBody(late).detail).toBeTruthy();

    const detail = await booked(me, await publishSlot(doctorA));
    await cancel(me, detail.id).expect(200);
    expect((await cancel(me, detail.id)).status).toBe(409);
  });

  it('answers 404 for another patient’s appointment and refuses an unknown reason', async () => {
    const me = await patient(1);
    const other = await patient(2);
    const theirs = await booked(other, await publishSlot(doctorA));

    expect((await cancel(me, theirs.id)).status).toBe(404);
    expect((await cancel(other, theirs.id, 'because')).status).toBe(422);
  });
});

describe('reschedule requests', () => {
  async function confirmedAppointment(session: Session): Promise<{ detail: Detail; slot: string }> {
    const slot = await publishSlot(doctorA);
    const detail = await booked(session, slot);
    await confirm(detail.id);
    return { detail, slot };
  }

  it('create → staff approve moves the same row to the new slot and frees the old one', async () => {
    const me = await patient(1);
    const other = await patient(2);
    const { detail, slot: oldSlot } = await confirmedAppointment(me);
    const target = await publishSlot(doctorA);

    const before = dataOf<Detail>(
      await request(harness.server)
        .get(`${ME_APPOINTMENTS}/${detail.id}`)
        .set('Authorization', `Bearer ${me.token}`)
        .expect(200),
    );
    expect(before.availableActions).toEqual(['cancel', 'reschedule']);

    const created = await requestMove(me, detail.id, target);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const view = dataOf<RequestView>(created);
    expect(view).toMatchObject({ appointmentId: detail.id, status: 'pending', note: 'Mornings suit me better' });
    expect(view.requestedSlot.id).toBe(target);

    const pendingDetail = dataOf<Detail>(
      await request(harness.server)
        .get(`${ME_APPOINTMENTS}/${detail.id}`)
        .set('Authorization', `Bearer ${me.token}`)
        .expect(200),
    );
    expect(pendingDetail.pendingRescheduleRequest?.id).toBe(view.id);
    expect(pendingDetail.availableActions).toEqual(['cancel']);

    const queue = await request(harness.server)
      .get(`${STAFF}/reschedule-requests?status=pending`)
      .set('Authorization', `Bearer ${doctorA.token}`)
      .expect(200);
    expect(dataOf<RequestView[]>(queue).map((r) => r.id)).toContain(view.id);

    const approved = await request(harness.server)
      .post(`${STAFF}/reschedule-requests/${view.id}/approve`)
      .set('Authorization', `Bearer ${doctorA.token}`);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(dataOf<RequestView>(approved).status).toBe('approved');

    const row = await harness.prisma.appointment.findUniqueOrThrow({ where: { publicId: detail.id } });
    expect(row.status).toBe('RESCHEDULED');
    expect(row.publishedSlotId).toBe(target);
    const targetRow = await harness.prisma.publishedSlot.findUniqueOrThrow({ where: { id: target } });
    expect(row.startsAt.toISOString()).toBe(targetRow.startsAt.toISOString());
    const events = await harness.prisma.appointmentEvent.findMany({
      where: { appointmentId: row.id, action: 'RESCHEDULE' },
    });
    expect(events).toHaveLength(1);

    // The old slot is free; the new one is held, also against a rescheduled row.
    await booked(other, oldSlot);
    const blocked = await book(other, target);
    expect(blocked.status).toBe(409);

    const outbox = await harness.prisma.domainEvent.findMany({
      where: { topic: 'appointment.reschedule_request.approved', payload: { path: ['appointmentId'], equals: detail.id } },
    });
    expect(outbox).toHaveLength(1);
  });

  it('reject leaves the appointment unchanged', async () => {
    const me = await patient(1);
    const { detail, slot } = await confirmedAppointment(me);
    const view = dataOf<RequestView>(await requestMove(me, detail.id, await publishSlot(doctorA)).expect(201));

    const rejected = await request(harness.server)
      .post(`${STAFF}/reschedule-requests/${view.id}/reject`)
      .set('Authorization', `Bearer ${doctorA.token}`)
      .send({ reason: 'The doctor is in theatre that morning' })
      .expect(200);
    expect(dataOf<RequestView>(rejected)).toMatchObject({
      status: 'rejected',
      decisionReason: 'The doctor is in theatre that morning',
    });

    const row = await harness.prisma.appointment.findUniqueOrThrow({ where: { publicId: detail.id } });
    expect(row.status).toBe('CONFIRMED');
    expect(row.publishedSlotId).toBe(slot);

    const list = await request(harness.server)
      .get(`${ME_APPOINTMENTS}/${detail.id}/reschedule-requests`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);
    expect(dataOf<RequestView[]>(list).map((r) => r.status)).toEqual(['rejected']);
  });

  it('refuses a second pending request (409) and allows withdrawing the first', async () => {
    const me = await patient(1);
    const { detail } = await confirmedAppointment(me);
    const first = dataOf<RequestView>(await requestMove(me, detail.id, await publishSlot(doctorA)).expect(201));

    const second = await requestMove(me, detail.id, await publishSlot(doctorA));
    expect(second.status).toBe(409);
    expect(errorBody(second).code).toBe('reschedule_request_pending');

    const withdrawn = await request(harness.server)
      .post(`${PREFIX}/me/reschedule-requests/${first.id}/withdraw`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);
    expect(dataOf<RequestView>(withdrawn).status).toBe('withdrawn');

    await request(harness.server)
      .post(`${PREFIX}/me/reschedule-requests/${first.id}/withdraw`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(409);
  });

  it('approve answers 409 when the requested slot was taken, and the request stays pending', async () => {
    const me = await patient(1);
    const other = await patient(2);
    const { detail } = await confirmedAppointment(me);
    const target = await publishSlot(doctorA);
    const view = dataOf<RequestView>(await requestMove(me, detail.id, target).expect(201));

    // The requested slot is not reserved: someone else books it meanwhile.
    await booked(other, target);

    const approve = await request(harness.server)
      .post(`${STAFF}/reschedule-requests/${view.id}/approve`)
      .set('Authorization', `Bearer ${doctorA.token}`);
    expect(approve.status).toBe(409);
    expect(errorBody(approve).code).toBe('slot_taken');

    const stored = await harness.prisma.appointmentRescheduleRequest.findUniqueOrThrow({ where: { id: view.id } });
    expect(stored.status).toBe('pending');
    const row = await harness.prisma.appointment.findUniqueOrThrow({ where: { publicId: detail.id } });
    expect(row.status).toBe('CONFIRMED');
  });

  it('refuses a slot at another hospital or of another doctor', async () => {
    const me = await patient(1);
    const { detail } = await confirmedAppointment(me);

    const response = await requestMove(me, detail.id, await publishSlot(doctorB));
    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('slot_not_eligible');
  });

  it('refuses a request on a pending appointment and on another patient’s appointment', async () => {
    const me = await patient(1);
    const other = await patient(2);
    const pending = await booked(me, await publishSlot(doctorA));

    expect((await requestMove(me, pending.id, await publishSlot(doctorA))).status).toBe(409);

    const theirs = await confirmedAppointment(other);
    expect((await requestMove(me, theirs.detail.id, await publishSlot(doctorA))).status).toBe(404);
    await request(harness.server)
      .get(`${ME_APPOINTMENTS}/${theirs.detail.id}/reschedule-requests`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(404);
  });

  it('supersedes a pending request when the patient cancels', async () => {
    const me = await patient(1);
    const { detail } = await confirmedAppointment(me);
    const view = dataOf<RequestView>(await requestMove(me, detail.id, await publishSlot(doctorA)).expect(201));

    await cancel(me, detail.id).expect(200);

    const stored = await harness.prisma.appointmentRescheduleRequest.findUniqueOrThrow({ where: { id: view.id } });
    expect(stored.status).toBe('superseded');
  });

  it('keeps the staff queue behind the appointments capability', async () => {
    const me = await patient(1);
    await request(harness.server)
      .get(`${STAFF}/reschedule-requests`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(403);
  });
});
