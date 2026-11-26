import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { PublishedSlotRepository } from '../src/modules/appointments/repositories/published-slot.repository';
import { SlotConflictChecker } from '../src/modules/appointments/services/slot-conflict.checker';
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
 * rest `409 slot_taken`, one appointment row. The second case removes the
 * application's own "already booked?" and occupancy checks, so only the
 * database guards (the partial unique index on
 * `appointments.published_slot_id`, the `appointments_no_overlap`
 * exclusion, the insert trigger) stand between the requests — and the
 * outcome must be the same.
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

  it('still give exactly one 201 with the application checks removed (database guard)', async () => {
    const slotId = await publishOne(doctor, futureAt(60, '11:00'));

    const live = vi
      .spyOn(harness.app.get(PublishedSlotRepository), 'liveBookingOf')
      .mockResolvedValue(null);
    const occupancy = vi
      .spyOn(harness.app.get(SlotConflictChecker), 'findOccupancy')
      .mockResolvedValue(null);

    expectOneWinner(await race(slotId));
    expect(live).toHaveBeenCalledTimes(N);
    expect(occupancy).toHaveBeenCalledTimes(N);
    expect(await harness.prisma.appointment.count({ where: { publishedSlotId: slotId } })).toBe(1);
  });
});
