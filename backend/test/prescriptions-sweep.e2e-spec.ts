import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  markVerified,
  registrationBody,
  testEmail,
} from './support/auth-app';
import { PrescriptionSweepService } from '../src/modules/pharmacy/services/prescription-sweep.service';

/**
 * The expiry sweep and the refill-due pass (RM M13.5).
 *
 * RM M13.5's verify step is "job test with clock control", and that is
 * what this is: `sweep(now)` takes its clock as an argument, so every
 * case below drives the job to a chosen instant rather than waiting for
 * one. Nothing here sleeps, and nothing depends on the system date.
 *
 * The properties worth asserting:
 *
 * · **The boundary.** A prescription ending *today* has not expired; one
 *   ending yesterday has. `end_date` is a `DATE`, and comparing it to a
 *   timestamp would expire a whole day's prescriptions early for every
 *   timezone behind UTC.
 * · **Only the three statuses ADR-002 §3 names.** A `draft` is not
 *   swept — it was never prescribed — and the terminal statuses are
 *   already terminal.
 * · **Idempotence.** A second pass at the same instant moves nothing,
 *   because every row the first touched has left the statuses it selects.
 * · **The sweep is not a status change in isolation** — it writes the
 *   `expired` timeline event and completes the patient's medication row
 *   in the same transaction.
 * · **No refill window is configured**, and the sweep says so rather
 *   than reporting "none found". See PD-13.5.
 */
let harness: AuthHarness;
let sweeper: PrescriptionSweepService;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const PATIENTS = '/api/v1/patients';
const PASSWORD = 'Medora123!';

interface SessionPayload {
  accessToken: string;
}

const createdCharts: string[] = [];
let amoxilId = '';

/**
 * A fixed instant, so every case reads against one calendar — and one
 * deliberately far in the **past**.
 *
 * The sweep is a job: it selects across the whole table, not a doctor's
 * own rows, because that is what a job does. In a shared test database
 * that makes it the one spec here capable of reaching into another's
 * fixtures. Dating this spec's calendar to 2025 means every other spec's
 * prescriptions — which live in 2026 — are comfortably in the future
 * relative to it, so this sweep can never expire one of them.
 */
const TODAY = new Date('2025-06-20T09:00:00.000Z');

async function seedDoctor(local: string): Promise<{ token: string; doctorId: string }> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  const token = dataOf<SessionPayload>(
    await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;

  const me = dataOf<{ doctor: { id: string } | null }>(
    await request(harness.server).get('/api/v1/me/profile').set('Authorization', `Bearer ${token}`),
  );
  // `/me/profile` nests the practitioner under `doctor`; it has no
  // top-level `id`. This lookup used to read `me.id`, which is undefined,
  // and Prisma drops an undefined filter — so it matched whichever doctor
  // the shared table returned first, and the prescriptions below were
  // written against another suite's doctor, failing that suite's teardown
  // on `prescriptions_prescribing_doctor_id_fkey`.
  if (me.doctor === null) throw new Error('The signed-in account has no doctor profile');
  const doctor = { id: me.doctor.id };

  return { token, doctorId: doctor.id };
}

async function seedPatient(token: string): Promise<{ publicId: string; id: string }> {
  const response = await request(harness.server)
    .post(PATIENTS)
    .set('Authorization', `Bearer ${token}`)
    .send({
      fullName: 'Layla Morsi',
      dateOfBirth: '1988-04-12',
      gender: 'female',
      bloodType: 'A+',
      phone: '+20 100 777 1234',
      allergies: [],
      chronicConditions: [],
    });

  expect(response.status).toBe(201);
  const publicId = dataOf<{ id: string }>(response).id;
  createdCharts.push(publicId);

  const patient = await harness.prisma.patient.findFirstOrThrow({
    where: { publicId },
    select: { id: true },
  });

  return { publicId, id: patient.id };
}

let sequence = 0;

/**
 * A prescription in a chosen state, dated however the case needs.
 *
 * Written directly because the sweep is about *time*, and the API
 * cannot produce a prescription that ended last week.
 */
async function givePrescription(input: {
  patientId: string;
  doctorId: string;
  status: 'ACTIVE' | 'DISPENSED' | 'PENDING_APPROVAL' | 'DRAFT' | 'COMPLETED' | 'DISCONTINUED';
  endDate: string;
  startDate?: string;
  refillsAllowed?: number;
  refillsRemaining?: number;
  refillStatus?: 'NONE' | 'AVAILABLE' | 'DUE' | 'PENDING';
  withMedicationRow?: boolean;
}): Promise<string> {
  sequence += 1;
  const publicId = `RX-S${String(Date.now() % 1_000_000)}${String(sequence)}`;
  const signed = input.status !== 'DRAFT';

  const created = await harness.prisma.prescription.create({
    data: {
      publicId,
      patientId: input.patientId,
      medicationId: amoxilId,
      prescribingDoctorId: input.doctorId,
      strength: '500 mg',
      dosage: '1 capsule',
      frequency: 'Three times daily',
      route: 'ORAL',
      durationDays: 7,
      quantity: 21,
      instructions: 'Take with food.',
      status: input.status,
      ...(signed ? { signedAt: new Date('2025-06-01T09:00:00.000Z') } : {}),
      ...(input.status === 'DISCONTINUED' ? { discontinuedReason: 'Test fixture.' } : {}),
      startDate: new Date(input.startDate ?? '2025-06-01'),
      endDate: new Date(input.endDate),
      refillsAllowed: input.refillsAllowed ?? 0,
      refillsRemaining: input.refillsRemaining ?? 0,
      refillStatus: input.refillStatus ?? 'NONE',
    },
    select: { id: true },
  });

  if (input.withMedicationRow === true) {
    await harness.prisma.patientMedication.create({
      data: {
        patientId: input.patientId,
        prescriptionId: created.id,
        name: 'Amoxil',
        dosage: '1 capsule',
        frequency: 'Three times daily',
        startDate: new Date(input.startDate ?? '2025-06-01'),
        endDate: new Date(input.endDate),
        status: 'ACTIVE',
      },
    });
  }

  return publicId;
}

async function statusOf(publicId: string): Promise<string> {
  const row = await harness.prisma.prescription.findFirstOrThrow({
    where: { publicId },
    select: { status: true },
  });

  return row.status;
}

beforeAll(async () => {
  harness = await createAuthHarness('rx-sweep');
  sweeper = harness.app.get(PrescriptionSweepService);

  amoxilId = (
    await harness.prisma.medication.findFirstOrThrow({
      where: { name: 'Amoxil' },
      select: { id: true },
    })
  ).id;
}, 60_000);

afterAll(async () => {
  if (harness === undefined) return;

  if (createdCharts.length > 0) {
    await harness.prisma.patientMedication.deleteMany({
      where: { patient: { publicId: { in: createdCharts } } },
    });
    await harness.prisma.prescription.deleteMany({
      where: { patient: { publicId: { in: createdCharts } } },
    });
    await harness.prisma.patient.deleteMany({ where: { publicId: { in: createdCharts } } });
  }

  await harness.reset();
  await harness.close();
});

describe('RM M13.5 verify — the expiry sweep, under clock control', () => {
  it('expires a course that ended yesterday and spares one ending today', async () => {
    const doctor = await seedDoctor('sweep-boundary');
    const patient = await seedPatient(doctor.token);

    const yesterday = await givePrescription({
      patientId: patient.id,
      doctorId: doctor.doctorId,
      status: 'ACTIVE',
      endDate: '2025-06-19',
    });
    const endsToday = await givePrescription({
      patientId: patient.id,
      doctorId: doctor.doctorId,
      status: 'ACTIVE',
      endDate: '2025-06-20',
    });
    const future = await givePrescription({
      patientId: patient.id,
      doctorId: doctor.doctorId,
      status: 'ACTIVE',
      endDate: '2025-07-01',
    });

    const result = await sweeper.sweep(TODAY);

    expect(result.expired).toContain(yesterday);
    // The boundary that matters: `end_date` is a DATE, so a course
    // ending today runs until the day is over. Comparing the column to a
    // timestamp would expire this one at midnight UTC — a day early for
    // every timezone behind UTC.
    expect(result.expired).not.toContain(endsToday);
    expect(result.expired).not.toContain(future);

    expect(await statusOf(yesterday)).toBe('EXPIRED');
    expect(await statusOf(endsToday)).toBe('ACTIVE');
    expect(await statusOf(future)).toBe('ACTIVE');
  });

  it('expires the course ending today once the clock moves on a day', async () => {
    const doctor = await seedDoctor('sweep-nextday');
    const patient = await seedPatient(doctor.token);

    const reference = await givePrescription({
      patientId: patient.id,
      doctorId: doctor.doctorId,
      status: 'ACTIVE',
      endDate: '2025-06-20',
    });

    expect((await sweeper.sweep(TODAY)).expired).not.toContain(reference);

    // Same row, same job, one day later — the only thing that changed is
    // the clock the caller passed.
    const tomorrow = new Date('2025-06-21T00:30:00.000Z');
    expect((await sweeper.sweep(tomorrow)).expired).toContain(reference);

    expect(await statusOf(reference)).toBe('EXPIRED');
  });

  it('sweeps all three statuses ADR-002 §3 names, and no others', async () => {
    const doctor = await seedDoctor('sweep-statuses');
    const patient = await seedPatient(doctor.token);
    const ended = '2025-06-10';

    const active = await givePrescription({
      patientId: patient.id,
      doctorId: doctor.doctorId,
      status: 'ACTIVE',
      endDate: ended,
    });
    const dispensed = await givePrescription({
      patientId: patient.id,
      doctorId: doctor.doctorId,
      status: 'DISPENSED',
      endDate: ended,
    });
    const pending = await givePrescription({
      patientId: patient.id,
      doctorId: doctor.doctorId,
      status: 'PENDING_APPROVAL',
      endDate: ended,
    });
    // Not swept: a draft was never prescribed, so there is no course to
    // expire (ADR-002 §1).
    const draft = await givePrescription({
      patientId: patient.id,
      doctorId: doctor.doctorId,
      status: 'DRAFT',
      endDate: ended,
    });
    // Not swept: already terminal.
    const discontinued = await givePrescription({
      patientId: patient.id,
      doctorId: doctor.doctorId,
      status: 'DISCONTINUED',
      endDate: ended,
    });

    const result = await sweeper.sweep(TODAY);

    expect(result.expired).toEqual(expect.arrayContaining([active, dispensed, pending]));
    expect(result.expired).not.toContain(draft);
    expect(result.expired).not.toContain(discontinued);

    expect(await statusOf(draft)).toBe('DRAFT');
    expect(await statusOf(discontinued)).toBe('DISCONTINUED');
  });

  it('writes the `expired` timeline event, attributed to nobody', async () => {
    const doctor = await seedDoctor('sweep-timeline');
    const patient = await seedPatient(doctor.token);
    const reference = await givePrescription({
      patientId: patient.id,
      doctorId: doctor.doctorId,
      status: 'ACTIVE',
      endDate: '2025-06-10',
    });

    await sweeper.sweep(TODAY);

    const events = await harness.prisma.prescriptionTimelineEvent.findMany({
      where: { prescription: { publicId: reference } },
      select: { kind: true, actorId: true, actorName: true, detail: true },
    });

    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe('EXPIRED');
    // Nobody did this; the calendar did. `actor_name` is nullable for
    // exactly this case and the projection renders it as "System".
    expect(events[0]?.actorId).toBeNull();
    expect(events[0]?.actorName).toBeNull();
    expect(events[0]?.detail).toBe('The prescription passed its end date');
  });

  it('completes the patient’s medication row in the same pass', async () => {
    const doctor = await seedDoctor('sweep-medlist');
    const patient = await seedPatient(doctor.token);
    const reference = await givePrescription({
      patientId: patient.id,
      doctorId: doctor.doctorId,
      status: 'ACTIVE',
      endDate: '2025-06-10',
      withMedicationRow: true,
    });

    await sweeper.sweep(TODAY);

    const medication = await harness.prisma.patientMedication.findFirstOrThrow({
      where: { prescription: { publicId: reference } },
      select: { status: true },
    });

    // `completed`, not `discontinued`: the course ran its length, which
    // is not the same act as someone deciding to stop it.
    expect(medication.status).toBe('COMPLETED');
  });

  it('clears the refill counts on an expired course', async () => {
    const doctor = await seedDoctor('sweep-refills');
    const patient = await seedPatient(doctor.token);
    const reference = await givePrescription({
      patientId: patient.id,
      doctorId: doctor.doctorId,
      status: 'ACTIVE',
      endDate: '2025-06-10',
      refillsAllowed: 3,
      refillsRemaining: 3,
      refillStatus: 'AVAILABLE',
    });

    await sweeper.sweep(TODAY);

    const row = await harness.prisma.prescription.findFirstOrThrow({
      where: { publicId: reference },
      select: { refillsRemaining: true, refillStatus: true },
    });

    // ADR-002 §3's row is unqualified — refills remaining do not exempt
    // a course from expiry, and nothing is refillable once it has ended.
    expect(row.refillsRemaining).toBe(0);
    expect(row.refillStatus).toBe('NONE');
  });

  it('is idempotent: a second pass at the same instant moves nothing', async () => {
    const doctor = await seedDoctor('sweep-idempotent');
    const patient = await seedPatient(doctor.token);
    const reference = await givePrescription({
      patientId: patient.id,
      doctorId: doctor.doctorId,
      status: 'ACTIVE',
      endDate: '2025-06-10',
    });

    expect((await sweeper.sweep(TODAY)).expired).toContain(reference);
    expect((await sweeper.sweep(TODAY)).expired).not.toContain(reference);

    // And exactly one timeline event, not two.
    const events = await harness.prisma.prescriptionTimelineEvent.count({
      where: { prescription: { publicId: reference }, kind: 'EXPIRED' },
    });
    expect(events).toBe(1);
  });

  it('finds nothing to do on a clock before every end date', async () => {
    const doctor = await seedDoctor('sweep-early');
    const patient = await seedPatient(doctor.token);
    await givePrescription({
      patientId: patient.id,
      doctorId: doctor.doctorId,
      status: 'ACTIVE',
      endDate: '2025-06-30',
    });

    const result = await sweeper.sweep(new Date('2025-06-02T09:00:00.000Z'));

    expect(result.expired).toEqual([]);
  });
});

describe('RM M13.5 — the refill-due pass', () => {
  it('computes nothing and says why when no window is configured', async () => {
    // PD-13.5: no source states how many days before `end_date` a refill
    // becomes due. The mechanism is built; the number is the caller's.
    // Reporting `refillDueWindowDays: null` is what stops "the sweep ran
    // and found none" being read as "no window is configured".
    const doctor = await seedDoctor('refilldue-nowindow');
    const patient = await seedPatient(doctor.token);
    const reference = await givePrescription({
      patientId: patient.id,
      doctorId: doctor.doctorId,
      status: 'ACTIVE',
      endDate: '2025-06-22',
      refillsAllowed: 2,
      refillsRemaining: 2,
      refillStatus: 'AVAILABLE',
    });

    const result = await sweeper.sweep(TODAY);

    expect(result.refillDueWindowDays).toBeNull();
    expect(result.refillDue).toEqual([]);

    const row = await harness.prisma.prescription.findFirstOrThrow({
      where: { publicId: reference },
      select: { refillStatus: true },
    });
    expect(row.refillStatus).toBe('AVAILABLE');
  });

  it('marks a prescription due when a window is supplied', async () => {
    const doctor = await seedDoctor('refilldue-window');
    const patient = await seedPatient(doctor.token);

    const inWindow = await givePrescription({
      patientId: patient.id,
      doctorId: doctor.doctorId,
      status: 'ACTIVE',
      endDate: '2025-06-22',
      refillsAllowed: 2,
      refillsRemaining: 2,
      refillStatus: 'AVAILABLE',
    });
    const outsideWindow = await givePrescription({
      patientId: patient.id,
      doctorId: doctor.doctorId,
      status: 'ACTIVE',
      endDate: '2025-07-15',
      refillsAllowed: 2,
      refillsRemaining: 2,
      refillStatus: 'AVAILABLE',
    });

    const result = await sweeper.sweep(TODAY, { refillDueWindowDays: 5 });

    expect(result.refillDueWindowDays).toBe(5);
    expect(result.refillDue).toContain(inWindow);
    expect(result.refillDue).not.toContain(outsideWindow);
  });

  it('ignores a prescription with no refills left', async () => {
    const doctor = await seedDoctor('refilldue-none');
    const patient = await seedPatient(doctor.token);
    const reference = await givePrescription({
      patientId: patient.id,
      doctorId: doctor.doctorId,
      status: 'ACTIVE',
      endDate: '2025-06-22',
      refillsAllowed: 1,
      refillsRemaining: 0,
      refillStatus: 'NONE',
    });

    const result = await sweeper.sweep(TODAY, { refillDueWindowDays: 5 });

    expect(result.refillDue).not.toContain(reference);
  });

  it('does not overwrite a refill that has already been requested', async () => {
    // Moving `pending` back to `due` would lose the request.
    const doctor = await seedDoctor('refilldue-pending');
    const patient = await seedPatient(doctor.token);
    const reference = await givePrescription({
      patientId: patient.id,
      doctorId: doctor.doctorId,
      status: 'ACTIVE',
      endDate: '2025-06-22',
      refillsAllowed: 2,
      refillsRemaining: 2,
      refillStatus: 'PENDING',
    });

    const result = await sweeper.sweep(TODAY, { refillDueWindowDays: 5 });

    expect(result.refillDue).not.toContain(reference);

    const row = await harness.prisma.prescription.findFirstOrThrow({
      where: { publicId: reference },
      select: { refillStatus: true },
    });
    expect(row.refillStatus).toBe('PENDING');
  });

  it('expires rather than marking due when the course has already ended', async () => {
    // Expiry runs first on purpose: a finished course is expired, not
    // due for a refill.
    const doctor = await seedDoctor('refilldue-expired');
    const patient = await seedPatient(doctor.token);
    const reference = await givePrescription({
      patientId: patient.id,
      doctorId: doctor.doctorId,
      status: 'ACTIVE',
      endDate: '2025-06-10',
      refillsAllowed: 2,
      refillsRemaining: 2,
      refillStatus: 'AVAILABLE',
    });

    const result = await sweeper.sweep(TODAY, { refillDueWindowDays: 5 });

    expect(result.expired).toContain(reference);
    expect(result.refillDue).not.toContain(reference);
    expect(await statusOf(reference)).toBe('EXPIRED');
  });
});
