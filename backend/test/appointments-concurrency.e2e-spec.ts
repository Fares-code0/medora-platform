import { Secret, TOTP } from 'otpauth';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppException } from '../src/common/errors/app.exception';
import { Prisma } from '../src/generated/prisma/client';
import {
  AppointmentRepository,
  type ScheduleTx,
} from '../src/modules/appointments/repositories/appointment.repository';
import {
  type BookabilityRequest,
  SlotConflictChecker,
} from '../src/modules/appointments/services/slot-conflict.checker';
import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  markVerified,
  registrationBody,
  testEmail,
  makeClinicalDoctor,
  purgeHospitalRecords,
  fixtureHospital,
} from './support/auth-app';
import { createGate, scheduleLockWaiters, waitUntil } from './support/barrier';

/**
 * BE-1 — booking is atomic per doctor.
 *
 * The slot check (ADR-005 §4) and the write that occupies the slot used
 * to be two separate steps under READ COMMITTED, so two requests could
 * both pass the check before either had written. These tests reproduce
 * that interleaving on purpose rather than hoping for it.
 *
 * ## How the interleaving is forced
 *
 * `SlotConflictChecker.assertBookable` is wrapped: the real check runs,
 * and a caller whose check *passed* then parks at a gate. The test opens
 * the gate on observed state only — one of:
 *
 * - **both requests parked**: both passed the check concurrently, which
 *   is the race; or
 * - **one parked and the other is blocked on this doctor's row lock**:
 *   the second request was stopped before it could run its check.
 *
 * Nothing is decided by a timeout. `waitUntil` throws if neither state
 * appears, which turns a hang into a readable failure instead of a
 * verdict.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const PATIENTS = '/api/v1/patients';
const APPOINTMENTS = '/api/v1/appointments';
const AVAILABILITY = '/api/v1/me/availability';
const PASSWORD = 'Medora123!';

/** 2027-03-01 is a Monday, well clear of "today". */
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
  /** `doctors.id` — the row the booking lock is taken on. */
  readonly id: string;
}

async function seedDoctor(local: string, bufferMin = 0): Promise<Doctor> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  // Clinical standing at the fixture hospital (§2.6, DR-05).
  await makeClinicalDoctor(harness.prisma, email);

  const token = dataOf<{ accessToken: string }>(
    await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;

  const saved = await request(harness.server)
    .put(AVAILABILITY)
    .set('Authorization', `Bearer ${token}`)
    .send({ week: week(), defaultDurationMin: 30, bufferMin });
  expect(saved.status).toBe(200);

  const { id } = await harness.prisma.doctor.findFirstOrThrow({
    where: { user: { email } },
    select: { id: true },
  });

  return { token, id };
}

const createdCharts: string[] = [];

async function seedPatient(token: string, fullName: string): Promise<string> {
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

function book(
  doctor: Doctor,
  patientId: string,
  time: string,
  overrides: Record<string, unknown> = {},
): Promise<request.Response> {
  return request(harness.server)
    .post(APPOINTMENTS)
    .set('Authorization', `Bearer ${doctor.token}`)
    .send({
      patientId,
      dateTime: slot(time),
      visitType: 'Consultation',
      reason: 'Follow-up on blood pressure',
      ...overrides,
    })
    .then((response) => response);
}

function bookWithKey(
  doctor: Doctor,
  key: string,
  patientId: string,
  time: string,
  overrides: Record<string, unknown> = {},
): Promise<request.Response> {
  return request(harness.server)
    .post(APPOINTMENTS)
    .set('Authorization', `Bearer ${doctor.token}`)
    .set('Idempotency-Key', key)
    .send({
      patientId,
      dateTime: slot(time),
      visitType: 'Consultation',
      reason: 'Follow-up on blood pressure',
      ...overrides,
    })
    .then((response) => response);
}

function reschedule(
  doctor: Doctor,
  appointmentId: string,
  time: string,
): Promise<request.Response> {
  return request(harness.server)
    .post(`${APPOINTMENTS}/${appointmentId}/reschedule`)
    .set('Authorization', `Bearer ${doctor.token}`)
    .send({ dateTime: slot(time), reason: 'Clinic asked to move the visit' })
    .then((response) => response);
}

async function bookOk(doctor: Doctor, patientId: string, time: string): Promise<string> {
  const response = await book(doctor, patientId, time);
  expect(response.status).toBe(201);
  return dataOf<{ id: string }>(response).id;
}

/**
 * Pairs of live appointments of one doctor whose intervals overlap — the
 * invariant BE-1 protects, checked in SQL rather than through the code
 * under test. Half-open, so back-to-back slots are not a pair.
 */
async function overlappingPairs(doctorId: string): Promise<number> {
  const rows = await harness.prisma.$queryRaw<{ pairs: number }[]>`
    SELECT count(*)::int AS pairs
    FROM appointments a
    JOIN appointments b
      ON a.doctor_id = b.doctor_id AND a.id < b.id
     AND a.starts_at < b.starts_at + make_interval(mins => b.duration_min)
     AND b.starts_at < a.starts_at + make_interval(mins => a.duration_min)
    WHERE a.doctor_id = ${doctorId}::uuid
      AND a.deleted_at IS NULL AND b.deleted_at IS NULL
      AND a.status::text IN ('scheduled','confirmed','pending','rescheduled','awaiting-patient')
      AND b.status::text IN ('scheduled','confirmed','pending','rescheduled','awaiting-patient')`;

  return rows[0]?.pairs ?? 0;
}

/** Whether another transaction could take the doctor's row lock right now. */
async function scheduleLockIsFree(doctorId: string): Promise<boolean> {
  try {
    await harness.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM doctors WHERE id = ${doctorId}::uuid FOR NO KEY UPDATE NOWAIT`;
    });
    return true;
  } catch {
    return false;
  }
}

async function liveAppointmentsOf(doctorId: string): Promise<number> {
  return harness.prisma.appointment.count({
    where: {
      doctorId,
      deletedAt: null,
      status: { in: ['SCHEDULED', 'CONFIRMED', 'PENDING', 'RESCHEDULED', 'AWAITING_PATIENT'] },
    },
  });
}

type Decision = 'both-passed-the-check' | 'second-blocked-on-lock';

interface RaceResult {
  readonly responses: request.Response[];
  readonly decision: Decision;
  /** Calls to `assertBookable` for the gated doctors when the gate opened. */
  readonly checksAtDecision: number;
}

/**
 * Fires `requests` together and holds each one, after a check for one of
 * `doctorIds` that passed, until the interleaving is known.
 */
async function raceThroughCheck(
  doctorIds: string | readonly string[],
  requests: (() => Promise<request.Response>)[],
): Promise<RaceResult> {
  const gated = typeof doctorIds === 'string' ? [doctorIds] : doctorIds;
  const checker = harness.app.get(SlotConflictChecker);
  const realCheck = checker.assertBookable.bind(checker);
  const gate = createGate();
  let checks = 0;

  vi.spyOn(checker, 'assertBookable').mockImplementation(async (req: BookabilityRequest) => {
    if (!gated.includes(req.doctorId)) return realCheck(req);
    checks += 1;
    await realCheck(req); // a refusal propagates without parking
    await gate.arrive();
  });

  const inFlight = requests.map((fire) => fire());

  const decision = await waitUntil<Decision>(async () => {
    if (gate.arrivals() >= 2) return 'both-passed-the-check';
    if (gate.arrivals() === 1) {
      for (const id of gated) {
        if ((await scheduleLockWaiters(harness.prisma, id)) > 0) return 'second-blocked-on-lock';
      }
    }
    return undefined;
  }, 'either both requests to pass the check, or one to block on a doctor row lock');

  const checksAtDecision = checks;
  gate.open();

  return { responses: await Promise.all(inFlight), decision, checksAtDecision };
}

const statusesOf = (responses: request.Response[]): number[] =>
  responses.map((r) => r.status).sort((a, b) => a - b);

beforeAll(async () => {
  harness = await createAuthHarness('appointments-concurrency');
}, 60_000);

afterEach(() => {
  vi.restoreAllMocks();
});

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

describe('BE-1 — concurrent booking for one doctor', () => {
  it('lets exactly one of two simultaneous identical bookings through', async () => {
    const doctor = await seedDoctor('race-same');
    const first = await seedPatient(doctor.token, 'Layla Morsi');
    const second = await seedPatient(doctor.token, 'Omar Hassan');

    const race = await raceThroughCheck(doctor.id, [
      () => book(doctor, first, '10:00'),
      () => book(doctor, second, '10:00'),
    ]);

    // The invariant first, so a regression reports what went wrong.
    expect(statusesOf(race.responses)).toEqual([201, 409]);
    expect(await liveAppointmentsOf(doctor.id)).toBe(1);

    const refused = race.responses.find((r) => r.status === 409);
    expect(errorBody(refused!).code).toBe('slot_conflict');

    // And the mechanism: the loser never reached its check while the
    // winner held the slot — it was waiting on the doctor's row lock.
    expect(race.decision).toBe('second-blocked-on-lock');
    expect(race.checksAtDecision).toBe(1);
  });
});

describe('BE-1 — overlap shapes under concurrency', () => {
  it('refuses a partial overlap (10:00–10:30 against 10:15–10:45)', async () => {
    const doctor = await seedDoctor('race-partial');
    const first = await seedPatient(doctor.token, 'Layla Morsi');
    const second = await seedPatient(doctor.token, 'Omar Hassan');

    const race = await raceThroughCheck(doctor.id, [
      () => book(doctor, first, '10:00'),
      () => book(doctor, second, '10:15'),
    ]);

    expect(statusesOf(race.responses)).toEqual([201, 409]);
    expect(await liveAppointmentsOf(doctor.id)).toBe(1);
    expect(race.decision).toBe('second-blocked-on-lock');
  });

  it('books both back-to-back slots when the buffer is zero', async () => {
    const doctor = await seedDoctor('race-adjacent', 0);
    const first = await seedPatient(doctor.token, 'Layla Morsi');
    const second = await seedPatient(doctor.token, 'Omar Hassan');

    const race = await raceThroughCheck(doctor.id, [
      () => book(doctor, first, '10:00'),
      () => book(doctor, second, '10:30'),
    ]);

    expect(statusesOf(race.responses)).toEqual([201, 201]);
    expect(await liveAppointmentsOf(doctor.id)).toBe(2);
    expect(await overlappingPairs(doctor.id)).toBe(0);
  });

  it('still applies a configured buffer to the same back-to-back pair', async () => {
    const doctor = await seedDoctor('race-buffer', 5);
    const first = await seedPatient(doctor.token, 'Layla Morsi');
    const second = await seedPatient(doctor.token, 'Omar Hassan');

    const race = await raceThroughCheck(doctor.id, [
      () => book(doctor, first, '10:00'),
      () => book(doctor, second, '10:30'),
    ]);

    expect(statusesOf(race.responses)).toEqual([201, 409]);
    const refused = race.responses.find((r) => r.status === 409);
    expect(errorBody(refused!).code).toBe('slot_conflict');
  });

  it('does not serialise bookings for different doctors', async () => {
    const a = await seedDoctor('race-doctor-a');
    const b = await seedDoctor('race-doctor-b');
    const patientOfA = await seedPatient(a.token, 'Layla Morsi');
    const patientOfB = await seedPatient(b.token, 'Omar Hassan');

    const race = await raceThroughCheck(
      [a.id, b.id],
      [() => book(a, patientOfA, '10:00'), () => book(b, patientOfB, '10:00')],
    );

    // Both were inside their locked transactions at the same moment:
    // neither waited for the other.
    expect(race.decision).toBe('both-passed-the-check');
    expect(statusesOf(race.responses)).toEqual([201, 201]);
  });
});

describe('BE-1 — concurrent reschedule', () => {
  it('lets only one of two reschedules into overlapping slots through', async () => {
    const doctor = await seedDoctor('race-reschedule');
    const first = await seedPatient(doctor.token, 'Layla Morsi');
    const second = await seedPatient(doctor.token, 'Omar Hassan');
    const one = await bookOk(doctor, first, '10:00');
    const two = await bookOk(doctor, second, '11:00');

    const race = await raceThroughCheck(doctor.id, [
      () => reschedule(doctor, one, '14:00'),
      () => reschedule(doctor, two, '14:15'),
    ]);

    expect(statusesOf(race.responses)).toEqual([200, 409]);
    expect(await overlappingPairs(doctor.id)).toBe(0);
    expect(race.decision).toBe('second-blocked-on-lock');
  });

  it('refuses a reschedule onto a slot a concurrent booking just took', async () => {
    const doctor = await seedDoctor('race-reschedule-book');
    const first = await seedPatient(doctor.token, 'Layla Morsi');
    const second = await seedPatient(doctor.token, 'Omar Hassan');
    const moving = await bookOk(doctor, first, '10:00');

    const race = await raceThroughCheck(doctor.id, [
      () => reschedule(doctor, moving, '15:00'),
      () => book(doctor, second, '15:10'),
    ]);

    // Whichever won the lock succeeds (200 reschedule or 201 booking);
    // the other is refused on the slot.
    const [rescheduled, booked] = race.responses;
    expect([rescheduled!.status, booked!.status].sort()).toSatisfy(
      (s: number[]) => (s[0] === 200 && s[1] === 409) || (s[0] === 201 && s[1] === 409),
    );
    expect(race.decision).toBe('second-blocked-on-lock');
    expect(await overlappingPairs(doctor.id)).toBe(0);
  });
});

describe('BE-1 — idempotency is unchanged', () => {
  it('replays a repeated key with the same body and books once', async () => {
    const doctor = await seedDoctor('idem-replay');
    const patient = await seedPatient(doctor.token, 'Layla Morsi');

    const original = await bookWithKey(doctor, 'be1-replay-0001', patient, '10:00');
    const repeated = await bookWithKey(doctor, 'be1-replay-0001', patient, '10:00');

    expect(original.status).toBe(201);
    expect(repeated.status).toBe(201);
    expect(repeated.headers['idempotency-replayed']).toBe('true');
    expect(dataOf<{ id: string }>(repeated).id).toBe(dataOf<{ id: string }>(original).id);
    expect(await liveAppointmentsOf(doctor.id)).toBe(1);
  });

  it('answers 409 in-progress to the same key while the first request holds the slot', async () => {
    const doctor = await seedDoctor('idem-inflight');
    const patient = await seedPatient(doctor.token, 'Layla Morsi');
    const checker = harness.app.get(SlotConflictChecker);
    const realCheck = checker.assertBookable.bind(checker);
    const gate = createGate();
    vi.spyOn(checker, 'assertBookable').mockImplementation(async (req: BookabilityRequest) => {
      await realCheck(req);
      await gate.arrive();
    });

    const first = bookWithKey(doctor, 'be1-inflight-01', patient, '10:00');
    await waitUntil(
      () => (gate.arrivals() === 1 ? true : undefined),
      'the first request to pass its check',
    );

    const second = await bookWithKey(doctor, 'be1-inflight-01', patient, '10:00');
    gate.open();

    expect(second.status).toBe(409);
    expect(errorBody(second).code).toBe('idempotency_request_in_progress');
    expect((await first).status).toBe(201);
    expect(await liveAppointmentsOf(doctor.id)).toBe(1);
  });

  it('refuses the same key with a different body (422)', async () => {
    const doctor = await seedDoctor('idem-mismatch');
    const patient = await seedPatient(doctor.token, 'Layla Morsi');

    expect((await bookWithKey(doctor, 'be1-mismatch-01', patient, '10:00')).status).toBe(201);
    const reused = await bookWithKey(doctor, 'be1-mismatch-01', patient, '11:00');

    expect(reused.status).toBe(422);
    expect(errorBody(reused).code).toBe('idempotency_key_reused');
    expect(await liveAppointmentsOf(doctor.id)).toBe(1);
  });

  it('gives different keys for overlapping slots one 201 and one 409', async () => {
    const doctor = await seedDoctor('idem-distinct');
    const first = await seedPatient(doctor.token, 'Layla Morsi');
    const second = await seedPatient(doctor.token, 'Omar Hassan');

    const race = await raceThroughCheck(doctor.id, [
      () => bookWithKey(doctor, 'be1-distinct-01', first, '10:00'),
      () => bookWithKey(doctor, 'be1-distinct-02', second, '10:15'),
    ]);

    expect(statusesOf(race.responses)).toEqual([201, 409]);
    expect(await liveAppointmentsOf(doctor.id)).toBe(1);
  });

  it('runs a key again after its request failed on a conflict', async () => {
    const doctor = await seedDoctor('idem-retry');
    const blocker = await seedPatient(doctor.token, 'Omar Hassan');
    const patient = await seedPatient(doctor.token, 'Layla Morsi');
    const blocking = await bookOk(doctor, blocker, '10:00');

    const refused = await bookWithKey(doctor, 'be1-retry-0001', patient, '10:00');
    expect(refused.status).toBe(409);
    expect(errorBody(refused).code).toBe('slot_conflict');

    const cancelled = await request(harness.server)
      .post(`${APPOINTMENTS}/${blocking}/cancel`)
      .set('Authorization', `Bearer ${doctor.token}`)
      .send({ reason: 'Patient called to cancel' });
    expect(cancelled.status).toBe(200);

    const retried = await bookWithKey(doctor, 'be1-retry-0001', patient, '10:00');
    expect(retried.status).toBe(201);
    expect(retried.headers['idempotency-replayed']).toBeUndefined();
  });
});

describe('BE-1 — failure paths release the lock', () => {
  it('rolls back a booking that fails after its insert, and frees the doctor', async () => {
    const doctor = await seedDoctor('rollback');
    const patient = await seedPatient(doctor.token, 'Layla Morsi');
    const repository = harness.app.get(AppointmentRepository);
    const realCreate = repository.create.bind(repository);
    vi.spyOn(repository, 'create').mockImplementationOnce(async (input, tx) => {
      await realCreate(input, tx);
      throw new Error('BE-1 injected failure after the insert');
    });

    const failed = await book(doctor, patient, '10:00');

    expect(failed.status).toBe(500);
    expect(JSON.stringify(failed.body)).not.toContain('injected');
    expect(await harness.prisma.appointment.count({ where: { doctorId: doctor.id } })).toBe(0);
    expect(await scheduleLockIsFree(doctor.id)).toBe(true);
    expect((await book(doctor, patient, '10:00')).status).toBe(201);
  });

  it('answers 503 without internals when the lock is not granted, and the key can be retried', async () => {
    const doctor = await seedDoctor('lock-timeout');
    const patient = await seedPatient(doctor.token, 'Layla Morsi');

    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const holder = harness.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM doctors WHERE id = ${doctor.id}::uuid FOR NO KEY UPDATE`;
        await held;
      },
      { timeout: 30_000 },
    );
    await waitUntil(
      async () => ((await scheduleLockIsFree(doctor.id)) ? undefined : true),
      'the test transaction to hold the doctor row lock',
    );

    const busy = await bookWithKey(doctor, 'be1-timeout-001', patient, '10:00');
    release();
    await holder;

    expect(busy.status).toBe(503);
    expect(errorBody(busy).code).toBe('service_unavailable');
    const text = JSON.stringify(busy.body);
    for (const leak of ['55P03', 'lock timeout', 'SELECT', 'doctors', doctor.id, 'Layla']) {
      expect(text).not.toContain(leak);
    }
    expect(await liveAppointmentsOf(doctor.id)).toBe(0);

    const retried = await bookWithKey(doctor, 'be1-timeout-001', patient, '10:00');
    expect(retried.status).toBe(201);
  }, 30_000);
});

/**
 * Two schedule-locked transactions that each hold one doctor and then
 * reach for the other's: a real deadlock, which PostgreSQL breaks by
 * aborting one of them after `deadlock_timeout`. Production code cannot
 * do this — it locks every doctor up front, in sorted order — so the test
 * does it on purpose, to get the error PostgreSQL and Prisma really raise
 * rather than a hand-built imitation of it.
 */
async function deadlockAcross(
  local: string,
  reach: (tx: ScheduleTx, otherDoctorId: string) => Promise<unknown>,
): Promise<{ outcomes: PromiseSettledResult<unknown>[]; raised: unknown[]; doctors: Doctor[] }> {
  const doctors = [await seedDoctor(`${local}-a`), await seedDoctor(`${local}-b`)];
  const [a, b] = doctors as [Doctor, Doctor];
  const checker = harness.app.get(SlotConflictChecker);
  const gate = createGate();
  const raised: unknown[] = [];

  const holdThenReach = (own: Doctor, other: Doctor): Promise<unknown> =>
    checker.underScheduleLock([own.id], async (tx) => {
      await gate.arrive();
      try {
        return await reach(tx, other.id);
      } catch (error) {
        raised.push(error);
        throw error;
      }
    });

  const inFlight = [holdThenReach(a, b), holdThenReach(b, a)];
  await waitUntil(
    () => (gate.arrivals() === 2 ? true : undefined),
    'both transactions to hold their own doctor row',
  );
  gate.open();

  return { outcomes: await Promise.allSettled(inFlight), raised, doctors };
}

function expectOneAnsweredBusy(outcomes: PromiseSettledResult<unknown>[]): void {
  expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
  const refused = outcomes.filter((o): o is PromiseRejectedResult => o.status === 'rejected');
  expect(refused).toHaveLength(1);

  const reason: unknown = refused[0]?.reason;
  expect(reason).toBeInstanceOf(AppException);
  const busy = reason as AppException;
  expect(busy.getStatus()).toBe(503);
  expect(busy.code).toBe('service_unavailable');
  const text = `${busy.message} ${busy.detail ?? ''}`;
  for (const leak of ['40P01', 'P2034', 'deadlock', 'SELECT', 'doctors']) {
    expect(text).not.toContain(leak);
  }
}

describe('BE-1 — a deadlock is answered 503, not 500', () => {
  it('maps PostgreSQL 40P01 on a raw lock statement (P2010) to 503', async () => {
    const { outcomes, raised, doctors } = await deadlockAcross(
      'deadlock-raw',
      (tx, other) =>
        tx.$queryRaw`SELECT id FROM doctors WHERE id = ${other}::uuid FOR NO KEY UPDATE`,
    );

    expect(raised).toHaveLength(1);
    const error = raised[0] as Prisma.PrismaClientKnownRequestError;
    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(error.code).toBe('P2010');
    expect(error.meta).toMatchObject({ driverAdapterError: { cause: { originalCode: '40P01' } } });
    expectOneAnsweredBusy(outcomes);
    for (const doctor of doctors) expect(await scheduleLockIsFree(doctor.id)).toBe(true);
  }, 30_000);

  it('maps the Prisma write-conflict code P2034 (a deadlock in a model query) to 503', async () => {
    const { outcomes, raised, doctors } = await deadlockAcross('deadlock-orm', (tx, other) =>
      tx.doctor.update({ where: { id: other }, data: { updatedAt: new Date() } }),
    );

    expect(raised).toHaveLength(1);
    const error = raised[0] as Prisma.PrismaClientKnownRequestError;
    expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
    expect(error.code).toBe('P2034');
    expectOneAnsweredBusy(outcomes);
    for (const doctor of doctors) expect(await scheduleLockIsFree(doctor.id)).toBe(true);
  }, 30_000);
});

describe('BE-1 — soft-deleted appointments', () => {
  it('does not let a soft-deleted appointment block its slot inside the locked check', async () => {
    const doctor = await seedDoctor('soft-deleted');
    const patient = await seedPatient(doctor.token, 'Layla Morsi');
    const removed = await bookOk(doctor, patient, '10:00');

    // Control: while live, the appointment does block the slot.
    expect((await book(doctor, patient, '10:15')).status).toBe(409);

    await harness.prisma.appointment.update({
      where: { publicId: removed },
      data: { deletedAt: new Date() },
    });

    expect((await book(doctor, patient, '10:15')).status).toBe(201);
    // The removed row is still there — soft-deleted, not gone.
    expect(await harness.prisma.appointment.count({ where: { doctorId: doctor.id } })).toBe(2);
    expect(await liveAppointmentsOf(doctor.id)).toBe(1);
    expect(await overlappingPairs(doctor.id)).toBe(0);
  });
});

describe('BE-1 — stress', () => {
  it('books exactly one of eight concurrent overlapping requests, five rounds running', async () => {
    const doctor = await seedDoctor('stress');
    const patients: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      patients.push(await seedPatient(doctor.token, `Stress Patient ${String(i)}`));
    }

    for (const hour of ['09', '10', '11', '13', '14']) {
      // 0, 4, … 28 minutes past the hour: every pair overlaps a 30-minute slot.
      const responses = await Promise.all(
        patients.map((patient, i) =>
          book(doctor, patient, `${hour}:${String(i * 4).padStart(2, '0')}`),
        ),
      );

      expect(responses.filter((r) => r.status >= 500)).toHaveLength(0);
      expect(responses.filter((r) => r.status === 201)).toHaveLength(1);
      const refused = responses.filter((r) => r.status === 409);
      expect(refused).toHaveLength(7);
      for (const r of refused) expect(errorBody(r).code).toBe('slot_conflict');
    }

    expect(await liveAppointmentsOf(doctor.id)).toBe(5);
    expect(await overlappingPairs(doctor.id)).toBe(0);
  }, 60_000);
});

const ADMIN_APPOINTMENTS = '/api/v1/admin/appointments';

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

  const bootstrap = dataOf<{ accessToken: string }>(
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
  const admin = await harness.prisma.user.update({
    where: { email },
    data: { roleId: adminRole.id },
    select: { id: true },
  });
  // Appointment oversight is a hospital function (F-01, OD-07).
  await harness.prisma.hospitalRoleAssignment.create({
    data: { userId: admin.id, hospitalId: await fixtureHospital(harness.prisma), roleId: adminRole.id },
  });
  await harness.prisma.doctor.deleteMany({ where: { user: { email } } });

  const login = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });

  return dataOf<{ accessToken: string }>(
    await request(harness.server)
      .post('/api/v1/auth/otp/verify')
      .send({ otpToken: dataOf<{ otpToken: string }>(login).otpToken, code: currentCode(secret) }),
  ).accessToken;
}

async function sameSpecialty(...doctors: Doctor[]): Promise<void> {
  await harness.prisma.doctor.updateMany({
    where: { id: { in: doctors.map((d) => d.id) } },
    data: { specialty: 'Cardiology' },
  });
}

function reassign(admin: string, appointmentId: string, to: Doctor): Promise<request.Response> {
  return request(harness.server)
    .post(`${ADMIN_APPOINTMENTS}/${appointmentId}/reassign`)
    .set('Authorization', `Bearer ${admin}`)
    .send({ doctorId: to.id, reason: 'Original doctor on emergency leave' })
    .then((response) => response);
}

describe('BE-1 — concurrent admin reassign', () => {
  it('lets only one of a reassign into a slot and a booking of that slot through', async () => {
    const admin = await seedAdmin('reassign-race-admin');
    const from = await seedDoctor('reassign-race-from');
    const to = await seedDoctor('reassign-race-to');
    await sameSpecialty(from, to);
    const moving = await bookOk(from, await seedPatient(from.token, 'Layla Morsi'), '10:00');
    const patientOfTo = await seedPatient(to.token, 'Omar Hassan');

    const race = await raceThroughCheck(to.id, [
      () => reassign(admin, moving, to),
      () => book(to, patientOfTo, '10:00'),
    ]);

    const [reassigned, booked] = race.responses;
    expect(
      (reassigned!.status === 200 && booked!.status === 409) ||
        (reassigned!.status === 409 && booked!.status === 201),
    ).toBe(true);
    expect(await liveAppointmentsOf(to.id)).toBe(1);
    expect(await overlappingPairs(to.id)).toBe(0);
    expect(race.decision).toBe('second-blocked-on-lock');
  });

  it('never lands a reassigned appointment on an unchecked time when its doctor reschedules it', async () => {
    const admin = await seedAdmin('reassign-move-admin');
    const from = await seedDoctor('reassign-move-from');
    const to = await seedDoctor('reassign-move-to');
    await sameSpecialty(from, to);
    const moving = await bookOk(from, await seedPatient(from.token, 'Layla Morsi'), '10:00');
    // The receiving doctor is free at 10:00 but busy at 15:00.
    await bookOk(to, await seedPatient(to.token, 'Omar Hassan'), '15:00');

    const race = await raceThroughCheck(
      [from.id, to.id],
      [() => reassign(admin, moving, to), () => reschedule(from, moving, '15:00')],
    );

    // Whichever order the lock allowed, the receiving doctor never holds
    // two overlapping live appointments.
    expect(await overlappingPairs(to.id)).toBe(0);
    expect(await overlappingPairs(from.id)).toBe(0);
    expect(race.responses.filter((r) => r.status >= 500)).toHaveLength(0);
    expect(race.responses.filter((r) => r.status === 200)).toHaveLength(1);
    expect(race.decision).toBe('second-blocked-on-lock');
  });
});
