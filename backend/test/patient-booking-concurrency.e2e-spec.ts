import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { type AuthHarness, createAuthHarness, errorBody } from './support/auth-app';
import {
  bookingDoctor,
  bookingPatient,
  bookSlot,
  type DoctorSession,
  futureAt,
  type PatientSession,
  publishOne,
  useServer,
} from './support/booking-fixture';
import { createPatientRecords, destroyPatientRecords } from './support/patient-fixture';

/**
 * DR-11 / OD-08 — one booking per slot, enforced by the database.
 *
 * N patients book the same published slot at once: exactly one 201, the
 * rest `409 slot_taken`, one appointment row — through `POST
 * /me/appointments` (ADR-049), whose final guard is the partial unique index
 * `appointments_one_live_booking_per_slot`.
 */
let harness: AuthHarness;
let doctor: DoctorSession;
const patients: PatientSession[] = [];
const N = 8;
const PATIENT_TAG = 'pbconc';

beforeAll(async () => {
  harness = await createAuthHarness('patient-booking-concurrency');
  useServer(harness);
  doctor = await bookingDoctor(harness, 'conc-doc');
  const records = await createPatientRecords(harness.prisma, PATIENT_TAG, N);
  for (const [index, record] of records.entries()) {
    patients.push(await bookingPatient(harness, `conc-p${String(index)}`, record.id));
  }
}, 120_000);

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  if (harness === undefined) return;
  await harness.reset();
  await destroyPatientRecords(harness.prisma, PATIENT_TAG);
  await harness.close();
});

async function race(slotId: string): Promise<request.Response[]> {
  return Promise.all(patients.map((patient) => bookSlot(patient, { slotId, reason: 'Check-up' })));
}

function expectOneWinner(responses: request.Response[]): void {
  const statuses = responses.map((response) => response.status).sort((a, b) => a - b);
  expect(statuses).toEqual([201, ...Array.from({ length: N - 1 }, () => 409)]);
  for (const refused of responses.filter((response) => response.status === 409)) {
    expect(errorBody(refused).code).toBe('slot_taken');
  }
}

describe(`${String(N)} concurrent bookings of one slot`, () => {
  it('give exactly one 201 and one appointment', async () => {
    const slotId = await publishOne(doctor, futureAt(60, '09:00'));

    expectOneWinner(await race(slotId));
    expect(await harness.prisma.appointment.count({ where: { publishedSlotId: slotId } })).toBe(1);
  });
});
