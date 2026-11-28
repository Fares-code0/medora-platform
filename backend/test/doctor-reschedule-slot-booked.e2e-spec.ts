import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppointmentRepository } from '../src/modules/appointments/repositories/appointment.repository';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  fixtureHospital,
  makeClinicalDoctor,
  markVerified,
  recordPatientAt,
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
 * R-01 (PR-68 audit §9): the doctor's `POST /appointments/:id/reschedule`
 * on an appointment a patient booked onto a published slot.
 *
 * The move must release the slot it held (the phase-21 trigger refuses a
 * slot id whose time no longer matches, and the ADR-049 one-live-booking
 * index would keep holding it), take the destination's published slot
 * when the new time is exactly one, and answer every refusal — the
 * conflict rules, the unique index, the trigger — 409, never 500, with the
 * appointment left as it was.
 */
vi.setConfig({ testTimeout: 120_000 });

let harness: AuthHarness;

const PREFIX = '/api/v1';
const REGISTER = `${PREFIX}/auth/register`;
const LOGIN = `${PREFIX}/auth/login`;
const VERIFY = `${PREFIX}/auth/verify-email`;
const ME_APPOINTMENTS = `${PREFIX}/me/appointments`;
const STAFF = `${PREFIX}/appointments`;
const AVAILABILITY = `${PREFIX}/me/availability`;
const PASSWORD = 'Medora123!';
const PATIENT_TAG = 'dsr';

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

interface StaffView {
  id: string;
  status: string;
  dateTime: string;
  durationMin: number;
}

let records: PatientRecord[];
let doctor: Doctor;

/** Mondays in 2027, one per case, so no two cases share an interval. */
const monday = (week: number, time: string): string =>
  new Date(Date.parse(`2027-03-01T${time}:00.000Z`) + week * 7 * 86_400_000).toISOString();

function week(): unknown[] {
  const open = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((weekday) => ({
    weekday,
    open: open.includes(weekday),
    windows: open.includes(weekday) ? [{ start: '09:00', end: '17:00' }] : [],
    breaks: [],
  }));
}

beforeAll(async () => {
  harness = await createAuthHarness('doctor-reschedule-slot');
  records = await createPatientRecords(harness.prisma, PATIENT_TAG, 3);
  doctor = await seedDoctor('drs', 'dsra');
}, 120_000);

afterAll(async () => {
  if (harness === undefined) return;
  await destroyPatientRecords(harness.prisma, PATIENT_TAG);
  await harness.reset();
  await harness.close();
}, 120_000);

afterEach(() => {
  vi.restoreAllMocks();
});

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
  await request(harness.server)
    .put(AVAILABILITY)
    .set('Authorization', `Bearer ${token}`)
    .send({ week: week(), defaultDurationMin: 30, bufferMin: 0 })
    .expect(200);
  return { token, doctorId, hospitalId, employmentId: employment.id };
}

async function patient(index: number): Promise<Session> {
  const email = testEmail(`p${index}-${randomUUID().slice(0, 6)}`);
  await request(harness.server).post(REGISTER).send(registrationBody({ email, role: 'patient' })).expect(201);
  await request(harness.server)
    .post(VERIFY)
    .send({ token: tokenFromLink(mailBody(harness.sink.lastTo(email)!)) })
    .expect(204);
  const login = await request(harness.server).post(LOGIN).send({ email, password: PASSWORD }).expect(200);
  const row = await harness.prisma.user.findUniqueOrThrow({ where: { email } });
  await harness.prisma.patient.update({ where: { id: records[index]!.id }, data: { userId: row.id } });
  return { token: dataOf<{ accessToken: string }>(login).accessToken, userId: row.id };
}

async function publishSlot(startsAt: string): Promise<string> {
  const slot = await harness.prisma.publishedSlot.create({
    data: {
      hospitalId: doctor.hospitalId,
      doctorEmploymentId: doctor.employmentId,
      startsAt: new Date(startsAt),
      durationMinutes: 30,
    },
    select: { id: true },
  });
  return slot.id;
}

function book(session: Session, slotId: string) {
  return request(harness.server)
    .post(ME_APPOINTMENTS)
    .set('Authorization', `Bearer ${session.token}`)
    .set('Idempotency-Key', randomUUID())
    .send({ slotId, reason: 'Routine check' });
}

/** A patient books `slotId` and the clinic confirms it. Returns the `APT-…` reference. */
async function bookedAndConfirmed(session: Session, slotId: string): Promise<string> {
  const response = await book(session, slotId);
  expect(response.status, JSON.stringify(response.body)).toBe(201);
  const reference = dataOf<{ id: string }>(response).id;
  const approved = await request(harness.server)
    .post(`${STAFF}/${reference}/approve`)
    .set('Authorization', `Bearer ${doctor.token}`);
  expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  return reference;
}

function reschedule(reference: string, dateTime: string) {
  return request(harness.server)
    .post(`${STAFF}/${reference}/reschedule`)
    .set('Authorization', `Bearer ${doctor.token}`)
    .send({ dateTime, reason: 'Doctor called into theatre' });
}

function row(reference: string) {
  return harness.prisma.appointment.findUniqueOrThrow({
    where: { publicId: reference },
    select: { id: true, status: true, startsAt: true, durationMin: true, publishedSlotId: true },
  });
}

async function offeredSlots(session: Session, from: string, to: string): Promise<string[]> {
  const response = await request(harness.server)
    .get(`${PREFIX}/patient/doctors/${doctor.doctorId}/slots?from=${from}&to=${to}`)
    .set('Authorization', `Bearer ${session.token}`)
    .expect(200);
  return dataOf<{ id: string }[]>(response).map((slot) => slot.id);
}

async function rescheduleEvents(appointmentId: string): Promise<number> {
  return harness.prisma.appointmentEvent.count({ where: { appointmentId, action: 'RESCHEDULE' } });
}

describe('doctor reschedule of a slot-booked appointment (R-01)', () => {
  it('moves onto an exactly matching free slot: takes it and releases the old one', async () => {
    const me = await patient(0);
    const oldSlot = await publishSlot(monday(0, '10:00'));
    const newSlot = await publishSlot(monday(0, '14:00'));
    const reference = await bookedAndConfirmed(me, oldSlot);

    const response = await reschedule(reference, monday(0, '14:00'));

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const view = dataOf<StaffView>(response);
    expect(view.status).toBe('rescheduled');
    expect(view.dateTime).toBe(monday(0, '14:00'));

    const moved = await row(reference);
    expect(moved.publishedSlotId).toBe(newSlot);
    expect(moved.startsAt.toISOString()).toBe(monday(0, '14:00'));
    expect(await harness.prisma.appointment.count({ where: { publishedSlotId: oldSlot } })).toBe(0);

    // The vacated slot is offered again; the taken one is not.
    const offered = await offeredSlots(me, monday(0, '00:00'), monday(0, '23:00'));
    expect(offered).toContain(oldSlot);
    expect(offered).not.toContain(newSlot);

    // …and another patient can actually book the vacated slot.
    const other = await patient(1);
    expect((await book(other, oldSlot)).status).toBe(201);
    // The taken slot is refused to them.
    expect((await book(other, newSlot)).status).toBe(409);
  });

  it('moves to a time that is not a published slot: releases the slot and stays slot-less', async () => {
    const me = await patient(0);
    const oldSlot = await publishSlot(monday(1, '10:00'));
    const reference = await bookedAndConfirmed(me, oldSlot);

    const response = await reschedule(reference, monday(1, '12:00'));

    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const moved = await row(reference);
    expect(moved.status).toBe('RESCHEDULED');
    expect(moved.publishedSlotId).toBeNull();
    expect(moved.startsAt.toISOString()).toBe(monday(1, '12:00'));
    expect(await offeredSlots(me, monday(1, '00:00'), monday(1, '23:00'))).toContain(oldSlot);
    expect(await rescheduleEvents(moved.id)).toBe(1);

    // A second move from `rescheduled` works the same way.
    const again = await reschedule(reference, monday(1, '14:00'));
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect((await row(reference)).startsAt.toISOString()).toBe(monday(1, '14:00'));
  });

  it('refuses an occupied destination 409 and leaves time and slot unchanged', async () => {
    const first = await patient(0);
    const second = await patient(1);
    const slotA = await publishSlot(monday(2, '10:00'));
    const slotB = await publishSlot(monday(2, '14:00'));
    const reference = await bookedAndConfirmed(first, slotA);
    await bookedAndConfirmed(second, slotB);
    const before = await row(reference);

    const response = await reschedule(reference, monday(2, '14:00'));

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('slot_conflict');
    expect(await row(reference)).toEqual(before);
    expect(await rescheduleEvents(before.id)).toBe(0);
  });

  it('gives exactly one 200 to two concurrent reschedules onto the same free slot', async () => {
    const first = await patient(0);
    const second = await patient(1);
    const slotA = await publishSlot(monday(3, '10:00'));
    const slotB = await publishSlot(monday(3, '11:00'));
    const target = await publishSlot(monday(3, '14:00'));
    const a = await bookedAndConfirmed(first, slotA);
    const b = await bookedAndConfirmed(second, slotB);

    const responses = await Promise.all([
      reschedule(a, monday(3, '14:00')),
      reschedule(b, monday(3, '14:00')),
    ]);
    const statuses = responses.map((response) => response.status).sort();

    expect(statuses, JSON.stringify(responses.map((r): unknown => r.body))).toEqual([200, 409]);
    const loser = responses.find((response) => response.status === 409)!;
    expect(errorBody(loser).code).toBe('slot_conflict');

    expect(await harness.prisma.appointment.count({ where: { publishedSlotId: target } })).toBe(1);
    const [rowA, rowB] = await Promise.all([row(a), row(b)]);
    const winner = rowA.publishedSlotId === target ? rowA : rowB;
    const unchanged = winner === rowA ? rowB : rowA;
    expect(winner.startsAt.toISOString()).toBe(monday(3, '14:00'));
    expect(unchanged.status).toBe('CONFIRMED');
    expect([slotA, slotB]).toContain(unchanged.publishedSlotId);
    // The winner's old slot is free again.
    expect(await offeredSlots(first, monday(3, '00:00'), monday(3, '23:00'))).toContain(
      winner === rowA ? slotA : slotB,
    );
  });

  it('answers a unique-index refusal (23505) 409 and rolls the move back', async () => {
    const first = await patient(0);
    const second = await patient(1);
    const slotA = await publishSlot(monday(4, '10:00'));
    const slotB = await publishSlot(monday(4, '14:00'));
    const reference = await bookedAndConfirmed(first, slotA);
    const holder = await bookedAndConfirmed(second, slotB);
    // The holder is soft-deleted but still live: the conflict rules no
    // longer see it, the one-live-booking index still does.
    await harness.prisma.appointment.update({ where: { publicId: holder }, data: { deletedAt: new Date() } });
    const before = await row(reference);

    // Without interference the move simply stays slot-less…
    const appointments = harness.app.get(AppointmentRepository);
    const spy = vi.spyOn(appointments, 'freeSlotAt');
    // …so force the binding to the held slot, as a racing writer would.
    spy.mockResolvedValueOnce(slotB);

    const response = await reschedule(reference, monday(4, '14:00'));

    expect(response.status, JSON.stringify(response.body)).toBe(409);
    expect(errorBody(response).code).toBe('slot_conflict');
    expect(await row(reference)).toEqual(before);
    expect(await rescheduleEvents(before.id)).toBe(0);

    // The unforced path: the held slot is not taken, the move succeeds slot-less.
    spy.mockRestore();
    const unforced = await reschedule(reference, monday(4, '14:00'));
    expect(unforced.status, JSON.stringify(unforced.body)).toBe(200);
    expect((await row(reference)).publishedSlotId).toBeNull();
  });

  it('answers a slot-trigger refusal (23514) 409 and rolls the move back', async () => {
    const me = await patient(0);
    const slotA = await publishSlot(monday(5, '10:00'));
    const elsewhere = await publishSlot(monday(5, '11:00'));
    const reference = await bookedAndConfirmed(me, slotA);
    const before = await row(reference);

    // A slot whose time does not match the destination: the phase-21
    // trigger refuses it with SQLSTATE 23514.
    vi.spyOn(harness.app.get(AppointmentRepository), 'freeSlotAt').mockResolvedValueOnce(elsewhere);

    const response = await reschedule(reference, monday(5, '14:00'));

    expect(response.status, JSON.stringify(response.body)).toBe(409);
    expect(errorBody(response).code).toBe('slot_conflict');
    expect(await row(reference)).toEqual(before);
    expect(await rescheduleEvents(before.id)).toBe(0);
  });

  it('still moves a doctor-created, slot-less appointment, and binds it to a matching free slot', async () => {
    const chart = records[2]!;
    await recordPatientAt(harness.prisma, chart.id, doctor.hospitalId);
    const created = await request(harness.server)
      .post(STAFF)
      .set('Authorization', `Bearer ${doctor.token}`)
      .send({
        patientId: chart.publicId,
        dateTime: monday(6, '10:00'),
        visitType: 'Consultation',
        reason: 'Follow-up on blood pressure',
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const reference = dataOf<StaffView>(created).id;
    expect((await row(reference)).publishedSlotId).toBeNull();

    const plain = await reschedule(reference, monday(6, '11:00'));
    expect(plain.status, JSON.stringify(plain.body)).toBe(200);
    expect((await row(reference)).publishedSlotId).toBeNull();
    expect((await row(reference)).startsAt.toISOString()).toBe(monday(6, '11:00'));

    const slot = await publishSlot(monday(6, '14:00'));
    const onto = await reschedule(reference, monday(6, '14:00'));
    expect(onto.status, JSON.stringify(onto.body)).toBe(200);
    expect((await row(reference)).publishedSlotId).toBe(slot);
  });
});
