import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { type AuthHarness, createAuthHarness, dataOf, errorBody } from './support/auth-app';
import {
  bookingDoctor,
  bookingPatient,
  bookSlot,
  type DoctorSession,
  futureAt,
  type PatientSession,
  publish,
  publishOne,
  PUBLISHED_SLOTS,
  useServer,
} from './support/booking-fixture';
import { createPatientRecords, destroyPatientRecords } from './support/patient-fixture';

/**
 * SLT-01 / SLT-02 — doctor-published slots (DR-10, OD-08;
 * `API_CONTRACT_CHANGES.md` §6).
 *
 * The doctor publishes and withdraws at the active hospital, derived from
 * the employment; the patient sees only published, unwithdrawn, unbooked,
 * future slots, and never working hours.
 */
let harness: AuthHarness;
let doctor: DoctorSession;
let other: DoctorSession;
let patient: PatientSession;
const PATIENT_TAG = 'pslot';

interface SlotView {
  id: string;
  startsAt: string;
  durationMin: number;
  status: string;
  appointmentId: string | null;
}

beforeAll(async () => {
  harness = await createAuthHarness('published-slots');
  useServer(harness);
  doctor = await bookingDoctor(harness, 'slot-doc');
  other = await bookingDoctor(harness, 'slot-other', 'pslotb');
  const [record] = await createPatientRecords(harness.prisma, PATIENT_TAG, 1);
  patient = await bookingPatient(harness, 'slot-patient', record!.id);
}, 60_000);

afterAll(async () => {
  if (harness === undefined) return;
  await harness.reset();
  await destroyPatientRecords(harness.prisma, PATIENT_TAG);
  await harness.close();
});

const list = (session: { token: string }, path: string): Promise<request.Response> =>
  request(harness.server)
    .get(path)
    .set('Authorization', `Bearer ${session.token}`)
    .then((response) => response);

const withdraw = (session: { token: string }, id: string): Promise<request.Response> =>
  request(harness.server)
    .delete(`${PUBLISHED_SLOTS}/${id}`)
    .set('Authorization', `Bearer ${session.token}`)
    .then((response) => response);

describe('POST /me/published-slots', () => {
  it('publishes at the active hospital, derived from the employment', async () => {
    const response = await publish(doctor, { startsAt: futureAt(30, '09:00'), durationMin: 30 });
    expect(response.status).toBe(201);

    const [slot] = dataOf<SlotView[]>(response);
    expect(slot).toMatchObject({ durationMin: 30, status: 'published', appointmentId: null });

    const row = await harness.prisma.publishedSlot.findUniqueOrThrow({
      where: { id: slot!.id },
      include: { employment: true },
    });
    expect(row.hospitalId).toBe(doctor.hospitalId);
    expect(row.employment.doctorId).toBe(doctor.doctorId);
    expect(row.employment.endedAt).toBeNull();
  });

  it('publishes a batch, all or nothing', async () => {
    const ok = await publish(doctor, [
      { startsAt: futureAt(31, '09:00'), durationMin: 20 },
      { startsAt: futureAt(31, '10:00'), durationMin: 20 },
    ]);
    expect(ok.status).toBe(201);
    expect(dataOf<SlotView[]>(ok)).toHaveLength(2);

    // The second item overlaps the first published one: nothing is written.
    const before = await harness.prisma.publishedSlot.count({
      where: { employment: { doctorId: doctor.doctorId } },
    });
    const refused = await publish(doctor, [
      { startsAt: futureAt(31, '12:00'), durationMin: 20 },
      { startsAt: futureAt(31, '09:10'), durationMin: 20 },
    ]);
    expect(refused.status).toBe(409);
    expect(errorBody(refused).code).toBe('slot_conflict');
    expect(
      await harness.prisma.publishedSlot.count({
        where: { employment: { doctorId: doctor.doctorId } },
      }),
    ).toBe(before);
  });

  it('refuses a client-supplied hospital or doctor (422)', async () => {
    const response = await publish(doctor, {
      startsAt: futureAt(32, '09:00'),
      durationMin: 30,
      hospitalId: other.hospitalId,
    });
    expect(response.status).toBe(422);
  });

  it('refuses a past slot and out-of-bounds durations (422)', async () => {
    const past = await publish(doctor, {
      startsAt: new Date(Date.now() - 3_600_000).toISOString(),
      durationMin: 30,
    });
    expect(past.status).toBe(422);
    expect(errorBody(past).fieldErrors?.['startsAt']).toBeDefined();

    for (const durationMin of [0, 4, 481]) {
      const response = await publish(doctor, { startsAt: futureAt(32, '11:00'), durationMin });
      expect(response.status, `durationMin ${String(durationMin)}`).toBe(422);
    }
  });

  it('refuses an overlap with one of the doctor’s own slots (409)', async () => {
    await publishOne(doctor, futureAt(33, '09:00'), 30);
    const response = await publish(doctor, { startsAt: futureAt(33, '09:15'), durationMin: 30 });
    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('slot_conflict');

    // Back to back is not an overlap.
    expect(
      (await publish(doctor, { startsAt: futureAt(33, '09:30'), durationMin: 30 })).status,
    ).toBe(201);
  });

  it('refuses an overlap with a live appointment and with time off (409)', async () => {
    const booked = await publishOne(doctor, futureAt(34, '09:00'), 30);
    expect((await bookSlot(patient, { slotId: booked, reason: 'Check-up' })).status).toBe(201);
    // A second slot over the booked appointment's time is refused.
    const overAppointment = await publish(doctor, {
      startsAt: futureAt(34, '09:10'),
      durationMin: 10,
    });
    expect(overAppointment.status).toBe(409);
    expect(errorBody(overAppointment).code).toBe('slot_conflict');

    const employment = await harness.prisma.doctorEmployment.findFirstOrThrow({
      where: { doctorId: doctor.doctorId, endedAt: null },
    });
    await harness.prisma.doctorTimeOff.create({
      data: {
        doctorId: doctor.doctorId,
        hospitalId: employment.hospitalId,
        doctorEmploymentId: employment.id,
        startsAt: new Date(futureAt(35, '08:00')),
        endsAt: new Date(futureAt(35, '12:00')),
        kind: 'vacation',
        autoBehavior: 'block-new',
      },
    });
    const overTimeOff = await publish(doctor, { startsAt: futureAt(35, '10:00'), durationMin: 30 });
    expect(overTimeOff.status).toBe(409);
    expect(errorBody(overTimeOff).code).toBe('slot_conflict');
  });

  it('is not open to a patient (403)', async () => {
    const response = await publish(patient, { startsAt: futureAt(36, '09:00'), durationMin: 30 });
    expect(response.status).toBe(403);
  });

  it('requires authentication (401)', async () => {
    await request(harness.server)
      .post(PUBLISHED_SLOTS)
      .send({ startsAt: futureAt(36, '09:00'), durationMin: 30 })
      .expect(401);
  });
});

describe('GET /me/published-slots', () => {
  it('lists only the caller’s own slots, with status', async () => {
    const mine = await publishOne(doctor, futureAt(40, '09:00'));
    const theirs = await publishOne(other, futureAt(40, '09:00'));

    const response = await list(
      doctor,
      `${PUBLISHED_SLOTS}?from=${futureAt(40, '00:00')}&to=${futureAt(41, '00:00')}`,
    );
    expect(response.status).toBe(200);
    const page = dataOf<{ items: SlotView[]; totalItems: number }>(response);
    const ids = page.items.map((item) => item.id);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs);
    expect(page.items.find((item) => item.id === mine)?.status).toBe('published');
  });

  it('refuses a patient (403)', async () => {
    expect((await list(patient, PUBLISHED_SLOTS)).status).toBe(403);
  });
});

describe('DELETE /me/published-slots/:id', () => {
  it('withdraws an own unbooked slot, idempotently', async () => {
    const id = await publishOne(doctor, futureAt(42, '09:00'));

    const first = await withdraw(doctor, id);
    expect(first.status).toBe(200);
    expect(dataOf<SlotView>(first).status).toBe('withdrawn');

    const again = await withdraw(doctor, id);
    expect(again.status).toBe(200);
    expect(dataOf<SlotView>(again).status).toBe('withdrawn');
  });

  it('answers another doctor’s slot and an unknown id with the same 404', async () => {
    const theirs = await publishOne(other, futureAt(42, '11:00'));

    const foreign = await withdraw(doctor, theirs);
    const unknown = await withdraw(doctor, randomUUID());
    const garbage = await withdraw(doctor, 'not-a-uuid');
    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(garbage.status).toBe(404);
    expect(errorBody(foreign).message).toBe(errorBody(unknown).message);

    const row = await harness.prisma.publishedSlot.findUniqueOrThrow({ where: { id: theirs } });
    expect(row.withdrawnAt).toBeNull();
  });

  it('refuses to withdraw a booked slot (409)', async () => {
    const id = await publishOne(doctor, futureAt(43, '09:00'));
    expect((await bookSlot(patient, { slotId: id, reason: 'Check-up' })).status).toBe(201);

    const response = await withdraw(doctor, id);
    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('slot_booked');

    const page = dataOf<{ items: SlotView[] }>(
      await list(
        doctor,
        `${PUBLISHED_SLOTS}?from=${futureAt(43, '00:00')}&to=${futureAt(44, '00:00')}`,
      ),
    );
    const view = page.items.find((item) => item.id === id);
    expect(view?.status).toBe('booked');
    expect(view?.appointmentId).toMatch(/^APT-/);
  });

  it('is not open to a patient (403)', async () => {
    const id = await publishOne(doctor, futureAt(42, '13:00'));
    expect((await withdraw(patient, id)).status).toBe(403);
  });
});

describe('GET /patient/doctors/:doctorId/slots', () => {
  const path = (doctorId: string, from: string, to: string): string =>
    `/api/v1/patient/doctors/${doctorId}/slots?from=${from}&to=${to}`;

  it('shows only published, unwithdrawn, unbooked, future slots', async () => {
    const open = await publishOne(doctor, futureAt(50, '09:00'));
    const withdrawn = await publishOne(doctor, futureAt(50, '10:00'));
    const booked = await publishOne(doctor, futureAt(50, '11:00'));
    expect((await withdraw(doctor, withdrawn)).status).toBe(200);
    expect((await bookSlot(patient, { slotId: booked, reason: 'Check-up' })).status).toBe(201);

    // A past slot can only exist by time passing; write one directly.
    const employment = await harness.prisma.doctorEmployment.findFirstOrThrow({
      where: { doctorId: doctor.doctorId, endedAt: null },
    });
    const past = await harness.prisma.publishedSlot.create({
      data: {
        hospitalId: employment.hospitalId,
        doctorEmploymentId: employment.id,
        startsAt: new Date(Date.now() - 2 * 3_600_000),
        durationMinutes: 30,
      },
    });

    const response = await list(
      patient,
      path(doctor.doctorId, new Date(Date.now() - 86_400_000).toISOString(), futureAt(51, '00:00')),
    );
    expect(response.status).toBe(200);
    const body = dataOf<{
      asOf: string;
      items: {
        slotId: string;
        startsAt: string;
        durationMin: number;
        timezone: string;
        hospital: { id: string; name: string };
      }[];
    }>(response);

    const ids = body.items.map((item) => item.slotId);
    expect(ids).toContain(open);
    expect(ids).not.toContain(withdrawn);
    expect(ids).not.toContain(booked);
    expect(ids).not.toContain(past.id);
    expect(body.asOf).toBeTruthy();

    const item = body.items.find((entry) => entry.slotId === open)!;
    expect(item.hospital.id).toBe(doctor.hospitalId);
    expect(item.durationMin).toBe(30);
    expect(item.timezone).toBeTruthy();

    // Never working hours (AST-C6), never a booking.
    const raw = JSON.stringify(response.body);
    for (const field of ['weekday', 'startTime', 'endTime', 'isBreak', 'availability', 'patient']) {
      expect(raw).not.toContain(field);
    }
  });

  it('answers an unknown doctor with 404 and refuses non-patients (403)', async () => {
    const from = futureAt(1, '00:00');
    const to = futureAt(2, '00:00');
    expect((await list(patient, path(randomUUID(), from, to))).status).toBe(404);
    expect((await list(patient, path('not-a-uuid', from, to))).status).toBe(404);
    expect((await list(doctor, path(doctor.doctorId, from, to))).status).toBe(403);
    await request(harness.server)
      .get(path(doctor.doctorId, from, to))
      .expect(401);
  });

  it('refuses from after to (422)', async () => {
    expect(
      (await list(patient, path(doctor.doctorId, futureAt(5, '00:00'), futureAt(4, '00:00'))))
        .status,
    ).toBe(422);
  });
});
