import { randomUUID } from 'node:crypto';

import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { IdempotencyStore } from '../src/shared/idempotency';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  recordPatientAt,
} from './support/auth-app';
import {
  bookingDoctor,
  bookingPatient,
  bookSlot,
  type DoctorSession,
  futureAt,
  ME_APPOINTMENTS,
  type PatientSession,
  publishOne,
  PUBLISHED_SLOTS,
  useServer,
} from './support/booking-fixture';
import {
  createPatientRecords,
  destroyPatientRecords,
  type PatientRecord,
} from './support/patient-fixture';

/**
 * SLT-03 / SLT-04 / SLT-05 — `POST /me/appointments`, a patient booking a
 * doctor-published slot (DR-10, DR-11, OD-08, OD-09, OD-14;
 * `API_CONTRACT_CHANGES.md` §6).
 */
let harness: AuthHarness;
let doctorA: DoctorSession;
let doctorB: DoctorSession;
let records: PatientRecord[];
let alice: PatientSession;
let bob: PatientSession;
let insured: PatientSession;
let unlinked: PatientSession;
const PATIENT_TAG = 'pbook';
const PROVIDER_PREFIX = 'E2E pbook provider';

interface Booked {
  id: string;
  startsAt: string;
  durationMin: number;
  status: string;
  reason: string;
  isNewPatient: boolean;
  doctor: { id: string };
  clinicTimezone: string;
}

let coveredProvider: string;
let uncoveredProvider: string;

beforeAll(async () => {
  harness = await createAuthHarness('patient-booking');
  useServer(harness);
  doctorA = await bookingDoctor(harness, 'book-doc-a');
  doctorB = await bookingDoctor(harness, 'book-doc-b', 'pbookb');
  records = await createPatientRecords(harness.prisma, PATIENT_TAG, 3);
  // Alice already has a record at hospital A only.
  await recordPatientAt(harness.prisma, records[0]!.id, doctorA.hospitalId);
  alice = await bookingPatient(harness, 'book-alice', records[0]!.id);
  bob = await bookingPatient(harness, 'book-bob', records[1]!.id);
  insured = await bookingPatient(harness, 'book-insured', records[2]!.id);
  unlinked = await bookingPatient(harness, 'book-unlinked');

  await harness.prisma.insuranceProvider.deleteMany({
    where: { name: { startsWith: PROVIDER_PREFIX } },
  });
  coveredProvider = (
    await harness.prisma.insuranceProvider.create({
      data: { name: `${PROVIDER_PREFIX} covered` },
      select: { id: true },
    })
  ).id;
  uncoveredProvider = (
    await harness.prisma.insuranceProvider.create({
      data: { name: `${PROVIDER_PREFIX} uncovered` },
      select: { id: true },
    })
  ).id;
  await harness.prisma.hospitalInsuranceCoverage.create({
    data: {
      hospitalId: doctorA.hospitalId,
      providerId: coveredProvider,
      planCode: 'E2E-PBOOK',
      planName: 'E2E pbook plan',
    },
  });
}, 60_000);

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  if (harness === undefined) return;
  await harness.reset();
  await destroyPatientRecords(harness.prisma, PATIENT_TAG);
  await harness.prisma.hospitalInsuranceCoverage.deleteMany({
    where: { providerId: { in: [coveredProvider, uncoveredProvider] } },
  });
  await harness.prisma.insuranceProvider.deleteMany({
    where: { name: { startsWith: PROVIDER_PREFIX } },
  });
  await harness.close();
});

async function insure(patientId: string, providerId: string): Promise<void> {
  await harness.prisma.patientInsurance.deleteMany({ where: { patientId } });
  await harness.prisma.patientInsurance.create({
    data: { patientId, providerId, policyNumber: `POL-${randomUUID().slice(0, 8)}` },
  });
}

describe('POST /me/appointments — the happy path', () => {
  it('books, deriving hospital, doctor and time from the slot, and opens the record (OD-09)', async () => {
    const startsAt = futureAt(20, '09:00');
    const slotId = await publishOne(doctorB, startsAt, 45);

    // Alice has no record at hospital B yet.
    expect(
      await harness.prisma.hospitalMedicalRecord.count({
        where: { patientId: records[0]!.id, hospitalId: doctorB.hospitalId },
      }),
    ).toBe(0);

    const response = await bookSlot(alice, { slotId, reason: 'Recurring headaches' });
    expect(response.status).toBe(201);

    const booked = dataOf<Booked>(response);
    expect(booked.id).toMatch(/^APT-/);
    expect(booked.status).toBe('scheduled');
    expect(booked.startsAt).toBe(startsAt);
    expect(booked.durationMin).toBe(45);
    expect(booked.doctor.id).toBe(doctorB.doctorId);
    expect(booked.isNewPatient).toBe(true);
    expect(booked.clinicTimezone).toBeTruthy();

    const row = await harness.prisma.appointment.findUniqueOrThrow({
      where: { publicId: booked.id },
    });
    const record = await harness.prisma.hospitalMedicalRecord.findUniqueOrThrow({
      where: {
        patientId_hospitalId: { patientId: records[0]!.id, hospitalId: doctorB.hospitalId },
      },
    });
    const slot = await harness.prisma.publishedSlot.findUniqueOrThrow({ where: { id: slotId } });
    expect(row).toMatchObject({
      patientId: records[0]!.id,
      doctorId: doctorB.doctorId,
      hospitalId: doctorB.hospitalId,
      doctorEmploymentId: slot.doctorEmploymentId,
      publishedSlotId: slotId,
      hospitalMedicalRecordId: record.id,
      durationMin: 45,
      status: 'SCHEDULED',
    });
    expect(row.startsAt.toISOString()).toBe(startsAt);

    // The doctor is notified through the existing topic, with the booking.
    expect(
      await harness.prisma.domainEvent.count({
        where: {
          topic: 'appointment.created',
          dedupeKey: { startsWith: `appointment.created:${booked.id}:` },
        },
      }),
    ).toBe(1);

    // The doctor's own view shows the slot as booked.
    const own = await request(harness.server)
      .get(`${PUBLISHED_SLOTS}?from=${futureAt(20, '00:00')}&to=${futureAt(21, '00:00')}`)
      .set('Authorization', `Bearer ${doctorB.token}`)
      .expect(200);
    const view = dataOf<{ items: { id: string; status: string; appointmentId: string }[] }>(
      own,
    ).items.find((item) => item.id === slotId);
    expect(view).toMatchObject({ status: 'booked', appointmentId: booked.id });
  });

  it('reuses the existing record at a hospital the patient already has one', async () => {
    const slotId = await publishOne(doctorA, futureAt(20, '11:00'));
    const response = await bookSlot(alice, { slotId, reason: 'Follow-up' });
    expect(response.status).toBe(201);
    expect(dataOf<Booked>(response).isNewPatient).toBe(false);
    expect(
      await harness.prisma.hospitalMedicalRecord.count({
        where: { patientId: records[0]!.id, hospitalId: doctorA.hospitalId },
      }),
    ).toBe(1);
  });
});

describe('POST /me/appointments — refusals', () => {
  it('refuses client-supplied hospital, doctor, time or duration (422)', async () => {
    const slotId = await publishOne(doctorA, futureAt(21, '09:00'));
    for (const extra of [
      { hospitalId: doctorB.hospitalId },
      { doctorId: doctorB.doctorId },
      { startsAt: futureAt(21, '15:00') },
      { durationMin: 90 },
    ]) {
      const response = await bookSlot(bob, { slotId, reason: 'Check-up', ...extra });
      expect(response.status, JSON.stringify(extra)).toBe(422);
    }
    expect(await harness.prisma.appointment.count({ where: { publishedSlotId: slotId } })).toBe(0);
  });

  it('requires an Idempotency-Key (422)', async () => {
    const slotId = await publishOne(doctorA, futureAt(21, '10:00'));
    const response = await bookSlot(bob, { slotId, reason: 'Check-up' }, null);
    expect(response.status).toBe(422);
    expect(errorBody(response).fieldErrors?.['Idempotency-Key']).toBeDefined();
    expect(await harness.prisma.appointment.count({ where: { publishedSlotId: slotId } })).toBe(0);
  });

  it('answers 409 slot_taken for a booked slot', async () => {
    const slotId = await publishOne(doctorA, futureAt(21, '11:00'));
    expect((await bookSlot(alice, { slotId, reason: 'First' })).status).toBe(201);

    const second = await bookSlot(bob, { slotId, reason: 'Second' });
    expect(second.status).toBe(409);
    expect(errorBody(second)).toMatchObject({ code: 'slot_taken', detail: 'booked' });
    expect(await harness.prisma.appointment.count({ where: { publishedSlotId: slotId } })).toBe(1);
  });

  it('answers 409 slot_taken for a withdrawn and for a past slot, 404 for an unknown one', async () => {
    const withdrawn = await publishOne(doctorA, futureAt(21, '12:00'));
    await request(harness.server)
      .delete(`${PUBLISHED_SLOTS}/${withdrawn}`)
      .set('Authorization', `Bearer ${doctorA.token}`)
      .expect(200);
    const refusedWithdrawn = await bookSlot(bob, { slotId: withdrawn, reason: 'Check-up' });
    expect(refusedWithdrawn.status).toBe(409);
    expect(errorBody(refusedWithdrawn)).toMatchObject({ code: 'slot_taken', detail: 'withdrawn' });

    const employment = await harness.prisma.doctorEmployment.findFirstOrThrow({
      where: { doctorId: doctorA.doctorId, endedAt: null },
    });
    const past = await harness.prisma.publishedSlot.create({
      data: {
        hospitalId: employment.hospitalId,
        doctorEmploymentId: employment.id,
        startsAt: new Date(Date.now() - 3_600_000),
        durationMinutes: 30,
      },
    });
    const refusedPast = await bookSlot(bob, { slotId: past.id, reason: 'Check-up' });
    expect(refusedPast.status).toBe(409);
    expect(errorBody(refusedPast)).toMatchObject({ code: 'slot_taken', detail: 'past' });

    expect((await bookSlot(bob, { slotId: randomUUID(), reason: 'Check-up' })).status).toBe(404);
  });

  it('refuses an account with no linked patient identity (409 patient_identity_required)', async () => {
    const slotId = await publishOne(doctorA, futureAt(21, '13:00'));
    const response = await bookSlot(unlinked, { slotId, reason: 'Check-up' });
    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('patient_identity_required');
  });

  it('is not open to a doctor (403) or without a session (401)', async () => {
    const slotId = await publishOne(doctorA, futureAt(21, '14:00'));
    expect((await bookSlot(doctorB, { slotId, reason: 'Check-up' })).status).toBe(403);
    await request(harness.server)
      .post(ME_APPOINTMENTS)
      .set('Idempotency-Key', randomUUID())
      .send({ slotId, reason: 'Check-up' })
      .expect(401);
    expect(await harness.prisma.appointment.count({ where: { publishedSlotId: slotId } })).toBe(0);
  });
});

describe('POST /me/appointments — idempotency', () => {
  it('replays the same appointment for the same key and writes one row', async () => {
    const slotId = await publishOne(doctorA, futureAt(22, '09:00'));
    const key = randomUUID();

    const first = await bookSlot(bob, { slotId, reason: 'Check-up' }, key);
    const second = await bookSlot(bob, { slotId, reason: 'Check-up' }, key);
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.headers['idempotency-replayed']).toBe('true');
    expect(dataOf<Booked>(second).id).toBe(dataOf<Booked>(first).id);
    expect(await harness.prisma.appointment.count({ where: { publishedSlotId: slotId } })).toBe(1);

    const reused = await bookSlot(bob, { slotId, reason: 'Something else' }, key);
    expect(reused.status).toBe(422);
    expect(errorBody(reused).code).toBe('idempotency_key_reused');
  });
});

describe('POST /me/appointments — idempotency completion failure (APT-02)', () => {
  it('does not release the key when storing the result fails after the booking committed', async () => {
    const slotId = await publishOne(doctorA, futureAt(22, '11:00'));
    const key = randomUUID();
    const complete = vi
      .spyOn(harness.app.get(IdempotencyStore), 'complete')
      .mockRejectedValue(new Error('store unavailable'));

    const first = await bookSlot(bob, { slotId, reason: 'Check-up' }, key);
    expect(first.status).toBe(201);
    expect(complete).toHaveBeenCalledTimes(2);
    complete.mockRestore();

    // The retry is told the key is still in progress — never re-executed.
    const retry = await bookSlot(bob, { slotId, reason: 'Check-up' }, key);
    expect(retry.status).toBe(409);
    expect(errorBody(retry).code).toBe('idempotency_request_in_progress');
    expect(await harness.prisma.appointment.count({ where: { publishedSlotId: slotId } })).toBe(1);
  });
});

describe('POST /me/appointments — insurance (OD-14)', () => {
  it('refuses an insured patient whose provider the hospital does not accept (422)', async () => {
    await insure(records[2]!.id, uncoveredProvider);
    const slotId = await publishOne(doctorA, futureAt(23, '09:00'));
    const response = await bookSlot(insured, { slotId, reason: 'Check-up' });
    expect(response.status).toBe(422);
    expect(errorBody(response).code).toBe('insurance_not_covered');
    expect(await harness.prisma.appointment.count({ where: { publishedSlotId: slotId } })).toBe(0);
    // Nothing was opened either: the transaction rolled back.
    expect(
      await harness.prisma.hospitalMedicalRecord.count({
        where: { patientId: records[2]!.id, hospitalId: doctorA.hospitalId },
      }),
    ).toBe(0);
  });

  it('books an insured patient whose provider the hospital accepts (201)', async () => {
    await insure(records[2]!.id, coveredProvider);
    const slotId = await publishOne(doctorA, futureAt(23, '10:00'));
    expect((await bookSlot(insured, { slotId, reason: 'Check-up' })).status).toBe(201);
  });

  it('does not check an uninsured patient (201 at a hospital with no coverage at all)', async () => {
    expect(
      await harness.prisma.patientInsurance.count({ where: { patientId: records[1]!.id } }),
    ).toBe(0);
    const slotId = await publishOne(doctorB, futureAt(23, '11:00'));
    expect((await bookSlot(bob, { slotId, reason: 'Check-up' })).status).toBe(201);
  });
});

describe('isolation', () => {
  it('patient B cannot read patient A’s booking', async () => {
    const slotId = await publishOne(doctorA, futureAt(24, '09:00'));
    const booked = dataOf<Booked>(await bookSlot(alice, { slotId, reason: 'Private matter' }));

    const foreign = await request(harness.server)
      .get(`${ME_APPOINTMENTS}/${booked.id}`)
      .set('Authorization', `Bearer ${bob.token}`);
    expect(foreign.status).toBe(404);

    const bobsList = await request(harness.server)
      .get(`${ME_APPOINTMENTS}?pageSize=100`)
      .set('Authorization', `Bearer ${bob.token}`)
      .expect(200);
    expect(
      dataOf<{ items: { id: string }[] }>(bobsList).items.map((item) => item.id),
    ).not.toContain(booked.id);

    const own = await request(harness.server)
      .get(`${ME_APPOINTMENTS}/${booked.id}`)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(own.status).toBe(200);
  });

  it('a replayed key never returns another patient’s booking', async () => {
    const slotId = await publishOne(doctorA, futureAt(24, '10:00'));
    const key = randomUUID();
    expect((await bookSlot(alice, { slotId, reason: 'Check-up' }, key)).status).toBe(201);

    const other = await bookSlot(bob, { slotId, reason: 'Check-up' }, key);
    expect(other.status).toBe(409);
    expect(errorBody(other).code).toBe('slot_taken');
  });
});
