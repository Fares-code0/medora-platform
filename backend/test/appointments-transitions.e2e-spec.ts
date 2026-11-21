import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppointmentRepository } from '../src/modules/appointments/repositories/appointment.repository';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  errorBody,
  markVerified,
  registrationBody,
  testEmail,
} from './support/auth-app';

/**
 * The ADR-001 transition matrix through the API (RM M11.3, M11.4).
 *
 * `appointment-status.machine.spec.ts` proves the table in isolation.
 * This file proves the four things only a round trip can:
 *
 * · each action endpoint refuses an illegal transition with **409 and a
 *   `detail`**, rather than 500 or a silent no-op;
 * · the **slot-date gate** is a distinct refusal from an illegal
 *   transition, because "you cannot complete this yet" and "you cannot
 *   complete this ever" are different things for a client to say;
 * · **every transition writes an `appointment_events` row**, in the same
 *   transaction, so the history never omits the move that produced the
 *   current state;
 * · **two concurrent approves yield one 200 and one 409** — the
 *   compare-and-set test ADR-001's consequences name explicitly.
 */
let harness: AuthHarness;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const PATIENTS = '/api/v1/patients';
const APPOINTMENTS = '/api/v1/appointments';
const AVAILABILITY = '/api/v1/me/availability';
const PASSWORD = 'Medora123!';

interface SessionPayload {
  accessToken: string;
}

interface AppointmentView {
  id: string;
  status: string;
  dateTime: string;
  durationMin: number;
  availableActions: string[];
}

interface AppointmentDetailView extends AppointmentView {
  cancelledReason: string | null;
  events: {
    action: string;
    fromStatus: string | null;
    toStatus: string | null;
    actor: string;
    reason: string | null;
  }[];
  proposals: { id: string; status: string; slots: string[]; chosenSlot: number | null }[];
}

/** 2027-03-01 is a Monday; 2024-03-04 is a Monday in the past. */
const FUTURE_MONDAY = '2027-03-01';
const PAST_MONDAY = '2024-03-04';

const slot = (day: string, time: string): string => `${day}T${time}:00.000Z`;

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
}

async function seedDoctor(local: string): Promise<Doctor> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  const token = dataOf<SessionPayload>(
    await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;

  await request(harness.server)
    .put(AVAILABILITY)
    .set('Authorization', `Bearer ${token}`)
    .send({ week: week(), defaultDurationMin: 30, bufferMin: 0 });

  return { token, email };
}

const createdCharts: string[] = [];

async function seedPatient(token: string): Promise<string> {
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
      dateTime: slot(FUTURE_MONDAY, time),
      visitType: 'Consultation',
      reason: 'Follow-up on blood pressure',
    });

  expect(response.status).toBe(201);

  return dataOf<AppointmentView>(response).id;
}

/**
 * A request in `pending`, inserted rather than booked.
 *
 * `pending` is the state a **patient's** request arrives in, and the
 * patient-side booking route deliberately does not exist yet — its
 * policy is unstated (see the appointments module header). There is
 * therefore no API path to a `pending` row, and none should be invented
 * to make a test convenient.
 *
 * The row is inserted directly, which is the honest fixture: an INSERT
 * is not a transition, so the M5.10 trigger is not being bypassed —
 * `UPDATE … SET status = 'pending'` is refused by it, correctly, and
 * this test relies on that refusal holding rather than working around
 * it.
 */
async function seedPending(doctor: Doctor, patientPublicId: string): Promise<string> {
  const doctorRow = await harness.prisma.doctor.findFirstOrThrow({
    where: { user: { email: doctor.email } },
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
      startsAt: new Date(slot(FUTURE_MONDAY, '10:00')),
      durationMin: 30,
      status: 'PENDING',
      reason: 'Requested by the patient',
    },
  });

  return publicId;
}

/** Moves the slot into the past, for the completion and no-show gates. */
async function backdate(publicId: string): Promise<void> {
  await harness.prisma.appointment.update({
    where: { publicId },
    data: { startsAt: new Date(slot(PAST_MONDAY, '10:00')) },
  });
}

function act(
  token: string,
  reference: string,
  action: string,
  body: Record<string, unknown> = {},
) {
  return request(harness.server)
    .post(`${APPOINTMENTS}/${reference}/${action}`)
    .set('Authorization', `Bearer ${token}`)
    .send(body);
}

function detail(token: string, reference: string) {
  return request(harness.server)
    .get(`${APPOINTMENTS}/${reference}`)
    .set('Authorization', `Bearer ${token}`);
}

beforeAll(async () => {
  harness = await createAuthHarness('appointments-transitions');
}, 60_000);

afterAll(async () => {
  if (harness === undefined) return;

  if (createdCharts.length > 0) {
    await harness.prisma.appointment.deleteMany({
      where: { patient: { publicId: { in: createdCharts } } },
    });
    await harness.prisma.patient.deleteMany({ where: { publicId: { in: createdCharts } } });
  }

  await harness.reset();
  await harness.close();
});

describe('approve and reject (§5.4, §5.5)', () => {
  it('moves a pending request to confirmed and records the event', async () => {
    const doctor = await seedDoctor('approve');
    const reference = await seedPending(doctor, await seedPatient(doctor.token));

    const response = await act(doctor.token, reference, 'approve');

    expect(response.status).toBe(200);
    expect(dataOf<AppointmentView>(response).status).toBe('confirmed');

    const events = dataOf<AppointmentDetailView>(await detail(doctor.token, reference)).events;
    const approval = events.find((event) => event.action === 'approve');
    expect(approval?.fromStatus).toBe('pending');
    expect(approval?.toStatus).toBe('confirmed');
  });

  it('refuses to approve an appointment that is not pending', async () => {
    const doctor = await seedDoctor('approve-illegal');
    const reference = await book(doctor.token, await seedPatient(doctor.token));

    const response = await act(doctor.token, reference, 'approve');

    expect(response.status).toBe(409);

    const error = errorBody(response);
    expect(error.code).toBe('invalid_status_transition');
    // The detail names the wire vocabulary, and says what *is* allowed.
    expect(error.detail).toContain('scheduled');
  });

  it('rejects a pending request with a category, and stores the reason', async () => {
    const doctor = await seedDoctor('reject');
    const reference = await seedPending(doctor, await seedPatient(doctor.token));

    const response = await act(doctor.token, reference, 'reject', {
      reasonCategory: 'schedule_conflict',
      reason: 'Clinic emergency block',
    });

    expect(response.status).toBe(200);
    expect(dataOf<AppointmentView>(response).status).toBe('cancelled');

    const view = dataOf<AppointmentDetailView>(await detail(doctor.token, reference));
    expect(view.cancelledReason).toBe('Clinic emergency block');
  });

  it('falls back to the category when no free text is sent', async () => {
    const doctor = await seedDoctor('reject-category');
    const reference = await seedPending(doctor, await seedPatient(doctor.token));

    await act(doctor.token, reference, 'reject', { reasonCategory: 'outside_specialty' });

    const view = dataOf<AppointmentDetailView>(await detail(doctor.token, reference));
    // A blank reason on the history would make a categorised rejection
    // look unexplained.
    expect(view.cancelledReason).toBe('Outside this specialty');
  });

  it('refuses an unknown rejection category', async () => {
    const doctor = await seedDoctor('reject-unknown');
    const reference = await seedPending(doctor, await seedPatient(doctor.token));

    const response = await act(doctor.token, reference, 'reject', { reasonCategory: 'because' });

    expect(response.status).toBe(422);
  });
});

describe('cancel (§5.7) — P4', () => {
  it('cancels with a reason and stores it on the row', async () => {
    const doctor = await seedDoctor('cancel');
    const reference = await book(doctor.token, await seedPatient(doctor.token));

    const response = await act(doctor.token, reference, 'cancel', { reason: 'Patient moved abroad' });

    expect(response.status).toBe(200);
    expect(dataOf<AppointmentView>(response).status).toBe('cancelled');
    expect(dataOf<AppointmentDetailView>(await detail(doctor.token, reference)).cancelledReason).toBe(
      'Patient moved abroad',
    );
  });

  it('refuses a cancellation with no reason', async () => {
    const doctor = await seedDoctor('cancel-no-reason');
    const reference = await book(doctor.token, await seedPatient(doctor.token));

    expect((await act(doctor.token, reference, 'cancel', {})).status).toBe(422);
  });

  it('refuses a cancellation whose reason is only whitespace', async () => {
    const doctor = await seedDoctor('cancel-blank');
    const reference = await book(doctor.token, await seedPatient(doctor.token));

    expect((await act(doctor.token, reference, 'cancel', { reason: '   ' })).status).toBe(422);
  });

  it('refuses to cancel an already-cancelled appointment', async () => {
    const doctor = await seedDoctor('cancel-twice');
    const reference = await book(doctor.token, await seedPatient(doctor.token));

    await act(doctor.token, reference, 'cancel', { reason: 'First' });
    const second = await act(doctor.token, reference, 'cancel', { reason: 'Second' });

    expect(second.status).toBe(409);
    expect(errorBody(second).detail).toContain('cannot change status');
  });
});

describe('complete and no-show (§5.7) — the slot-date gate', () => {
  it('refuses completion before the slot date, with its own code', async () => {
    const doctor = await seedDoctor('complete-early');
    const reference = await book(doctor.token, await seedPatient(doctor.token));

    const response = await act(doctor.token, reference, 'complete');

    expect(response.status).toBe(409);
    // Distinct from `invalid_status_transition`: the move is legal, just
    // not yet. A client that conflated them would tell the doctor this
    // appointment can never be completed.
    expect(errorBody(response).code).toBe('slot_not_reached');
  });

  it('completes once the slot date has passed', async () => {
    const doctor = await seedDoctor('complete');
    const reference = await book(doctor.token, await seedPatient(doctor.token));
    await backdate(reference);

    const response = await act(doctor.token, reference, 'complete');

    expect(response.status).toBe(200);
    expect(dataOf<AppointmentView>(response).status).toBe('completed');
    expect(dataOf<AppointmentView>(response).availableActions).toEqual([]);
  });

  it('marks a no-show once the slot date has passed', async () => {
    const doctor = await seedDoctor('noshow');
    const reference = await book(doctor.token, await seedPatient(doctor.token));
    await backdate(reference);

    const response = await act(doctor.token, reference, 'no-show');

    expect(response.status).toBe(200);
    expect(dataOf<AppointmentView>(response).status).toBe('no-show');
  });

  it('refuses any further move once completed', async () => {
    const doctor = await seedDoctor('complete-terminal');
    const reference = await book(doctor.token, await seedPatient(doctor.token));
    await backdate(reference);
    await act(doctor.token, reference, 'complete');

    expect((await act(doctor.token, reference, 'cancel', { reason: 'Changed mind' })).status).toBe(409);
    expect((await act(doctor.token, reference, 'no-show')).status).toBe(409);
  });
});

describe('reschedule (§5.6)', () => {
  it('moves the slot, keeps the history, and reports the new time', async () => {
    const doctor = await seedDoctor('reschedule');
    const reference = await book(doctor.token, await seedPatient(doctor.token));

    const response = await act(doctor.token, reference, 'reschedule', {
      dateTime: slot(FUTURE_MONDAY, '14:00'),
      reason: 'Doctor called into theatre',
    });

    expect(response.status).toBe(200);

    const view = dataOf<AppointmentView>(response);
    expect(view.status).toBe('rescheduled');
    expect(view.dateTime).toBe(slot(FUTURE_MONDAY, '14:00'));

    const events = dataOf<AppointmentDetailView>(await detail(doctor.token, reference)).events;
    const move = events.find((event) => event.action === 'reschedule');
    expect(move?.reason).toBe('Doctor called into theatre');
  });

  it('conflict-checks the new slot against the grid', async () => {
    const doctor = await seedDoctor('reschedule-conflict');
    const reference = await book(doctor.token, await seedPatient(doctor.token));

    const response = await act(doctor.token, reference, 'reschedule', {
      dateTime: slot(FUTURE_MONDAY, '20:00'),
      reason: 'Later, please',
    });

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('slot_conflict');
  });

  it('does not conflict with the appointment being moved', async () => {
    const doctor = await seedDoctor('reschedule-self');
    const reference = await book(doctor.token, await seedPatient(doctor.token));

    // Fifteen minutes later overlaps the original slot. Excluding the
    // row under move is what makes a small nudge possible at all.
    const response = await act(doctor.token, reference, 'reschedule', {
      dateTime: slot(FUTURE_MONDAY, '10:15'),
      reason: 'Nudged fifteen minutes',
    });

    expect(response.status).toBe(200);
  });

  it('refuses a reschedule with no reason', async () => {
    const doctor = await seedDoctor('reschedule-no-reason');
    const reference = await book(doctor.token, await seedPatient(doctor.token));

    const response = await act(doctor.token, reference, 'reschedule', {
      dateTime: slot(FUTURE_MONDAY, '14:00'),
    });

    expect(response.status).toBe(422);
  });

  it('allows a second reschedule from the rescheduled state', async () => {
    const doctor = await seedDoctor('reschedule-twice');
    const reference = await book(doctor.token, await seedPatient(doctor.token));

    await act(doctor.token, reference, 'reschedule', {
      dateTime: slot(FUTURE_MONDAY, '14:00'),
      reason: 'First move',
    });
    const second = await act(doctor.token, reference, 'reschedule', {
      dateTime: slot(FUTURE_MONDAY, '15:00'),
      reason: 'Second move',
    });

    expect(second.status).toBe(200);
  });
});

describe('propose-slots (§5.8) — awaiting-patient', () => {
  it('moves a pending request to awaiting-patient and stores the proposal', async () => {
    const doctor = await seedDoctor('propose');
    const reference = await seedPending(doctor, await seedPatient(doctor.token));

    const response = await act(doctor.token, reference, 'propose-slots', {
      slots: [slot(FUTURE_MONDAY, '14:00'), slot(FUTURE_MONDAY, '15:00')],
    });

    expect(response.status).toBe(200);

    const view = dataOf<AppointmentDetailView>(response);
    expect(view.status).toBe('awaiting-patient');
    expect(view.proposals).toHaveLength(1);
    expect(view.proposals[0]?.status).toBe('pending');
    // Nulls dropped: two slots were offered, so two are on the wire.
    expect(view.proposals[0]?.slots).toHaveLength(2);
  });

  it('refuses more than three slots', async () => {
    const doctor = await seedDoctor('propose-four');
    const reference = await seedPending(doctor, await seedPatient(doctor.token));

    const response = await act(doctor.token, reference, 'propose-slots', {
      slots: [
        slot(FUTURE_MONDAY, '14:00'),
        slot(FUTURE_MONDAY, '15:00'),
        slot(FUTURE_MONDAY, '16:00'),
        slot(FUTURE_MONDAY, '16:30'),
      ],
    });

    expect(response.status).toBe(422);
  });

  it('refuses a proposal containing an unbookable slot, naming which one', async () => {
    const doctor = await seedDoctor('propose-conflict');
    const reference = await seedPending(doctor, await seedPatient(doctor.token));

    const response = await act(doctor.token, reference, 'propose-slots', {
      slots: [slot(FUTURE_MONDAY, '14:00'), slot(FUTURE_MONDAY, '21:00')],
    });

    expect(response.status).toBe(409);
    expect(errorBody(response).detail).toContain('Slot 2');
  });

  it('leaves the appointment untouched when a proposed slot is refused', async () => {
    const doctor = await seedDoctor('propose-atomic');
    const reference = await seedPending(doctor, await seedPatient(doctor.token));

    await act(doctor.token, reference, 'propose-slots', { slots: [slot(FUTURE_MONDAY, '21:00')] });

    const view = dataOf<AppointmentDetailView>(await detail(doctor.token, reference));
    // A proposal the patient accepts and the server then refuses is the
    // worst outcome of this endpoint, so nothing is offered until every
    // slot has been checked.
    expect(view.status).toBe('pending');
    expect(view.proposals).toHaveLength(0);
  });

  it('refuses a proposal from a state ADR-001 does not allow it from', async () => {
    const doctor = await seedDoctor('propose-scheduled');
    const reference = await book(doctor.token, await seedPatient(doctor.token));

    // RA-001.1: only `pending` until product confirms the wider set.
    const response = await act(doctor.token, reference, 'propose-slots', {
      slots: [slot(FUTURE_MONDAY, '14:00')],
    });

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('invalid_status_transition');
  });

  it('expires the outstanding proposal when the appointment resolves', async () => {
    const doctor = await seedDoctor('propose-expire');
    const reference = await seedPending(doctor, await seedPatient(doctor.token));
    await act(doctor.token, reference, 'propose-slots', { slots: [slot(FUTURE_MONDAY, '14:00')] });

    await act(doctor.token, reference, 'cancel', { reason: 'Patient withdrew the request' });

    const view = dataOf<AppointmentDetailView>(await detail(doctor.token, reference));
    expect(view.proposals[0]?.status).toBe('expired');
  });
});

describe('concurrency — compare-and-set', () => {
  it('yields one 200 and one 409 for two simultaneous approves', async () => {
    const doctor = await seedDoctor('race');
    const reference = await seedPending(doctor, await seedPatient(doctor.token));

    const [first, second] = await Promise.all([
      act(doctor.token, reference, 'approve'),
      act(doctor.token, reference, 'approve'),
    ]);

    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([200, 409]);
  });

  it('writes exactly one transition event for the winning approve', async () => {
    const doctor = await seedDoctor('race-events');
    const reference = await seedPending(doctor, await seedPatient(doctor.token));

    await Promise.all([act(doctor.token, reference, 'approve'), act(doctor.token, reference, 'approve')]);

    const events = dataOf<AppointmentDetailView>(await detail(doctor.token, reference)).events;
    // An event row for a transition that did not happen is a lie in the
    // history, so the loser writes nothing at all.
    expect(events.filter((event) => event.action === 'approve')).toHaveLength(1);
  });
});

/**
 * Another doctor's appointment, written to (ADR-022).
 *
 * `appointments-book.e2e-spec.ts` proves the *reads* answer 404 for a
 * foreign appointment. The writes resolve the row through the same
 * doctor-scoped lookup, and each is asserted here: 404 identical to a
 * missing reference, and the row left exactly as it was.
 */
describe('writes to another doctor’s appointment', () => {
  const cases: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
    ['approve', {}],
    ['cancel', { reason: 'Not my patient' }],
    ['reschedule', { dateTime: slot(FUTURE_MONDAY, '14:00'), reason: 'Moving it' }],
    ['propose-slots', { slots: [slot(FUTURE_MONDAY, '14:00')] }],
  ];

  for (const [action, body] of cases) {
    it(`answers 404 for ${action}, identically to a missing one, and changes nothing`, async () => {
      const owner = await seedDoctor(`foreign-${action}-owner`);
      const intruder = await seedDoctor(`foreign-${action}-intruder`);
      const reference = await seedPending(owner, await seedPatient(owner.token));
      const before = await harness.prisma.appointment.findUniqueOrThrow({
        where: { publicId: reference },
        select: { status: true, startsAt: true, updatedAt: true },
      });

      const foreign = await act(intruder.token, reference, action, body);
      const missing = await act(intruder.token, 'APT-99999999', action, body);

      expect(foreign.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(foreign.body).toEqual(missing.body);

      const after = await harness.prisma.appointment.findUniqueOrThrow({
        where: { publicId: reference },
        select: { status: true, startsAt: true, updatedAt: true },
      });
      expect(after).toEqual(before);
    });
  }
});

/**
 * Reschedule and propose-slots losing a compare-and-set.
 *
 * The approve race above is left to timing, and either check can be the
 * one that refuses: the status machine, if the loser read the row late,
 * or the compare-and-set, if it read early. These two stage the second
 * case. The spy runs the same transition once on the other request's
 * behalf, then lets this request's own compare-and-set run against a
 * row that has already moved.
 */
describe('a reschedule or proposal that loses the race', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function loseTheNextTransition(): void {
    const appointments = harness.app.get(AppointmentRepository);
    const transition = appointments.transition.bind(appointments);
    vi.spyOn(appointments, 'transition').mockImplementationOnce(async (input) => {
      if ((await transition(input)) === null) {
        throw new Error('fixture: the other request should win');
      }
      return transition(input);
    });
  }

  it('answers a losing reschedule 409 stale_write and records the move once', async () => {
    const doctor = await seedDoctor('reschedule-race');
    const reference = await book(doctor.token, await seedPatient(doctor.token));
    loseTheNextTransition();

    const response = await act(doctor.token, reference, 'reschedule', {
      dateTime: slot(FUTURE_MONDAY, '14:00'),
      reason: 'Doctor called into theatre',
    });

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('stale_write');

    const events = dataOf<AppointmentDetailView>(await detail(doctor.token, reference)).events;
    expect(events.filter((event) => event.action === 'reschedule')).toHaveLength(1);
  });

  it('answers a losing proposal 409 stale_write and stores no proposal for it', async () => {
    const doctor = await seedDoctor('propose-race');
    const reference = await seedPending(doctor, await seedPatient(doctor.token));
    loseTheNextTransition();

    const response = await act(doctor.token, reference, 'propose-slots', {
      slots: [slot(FUTURE_MONDAY, '14:00'), slot(FUTURE_MONDAY, '15:00')],
    });

    expect(response.status).toBe(409);
    expect(errorBody(response).code).toBe('stale_write');

    // The winner in this staging is a bare transition, so any proposal row
    // would be the loser's. A patient must never be offered times by a
    // request that was refused.
    expect(
      await harness.prisma.appointmentRescheduleProposal.count({
        where: { appointment: { publicId: reference } },
      }),
    ).toBe(0);
  });
});
