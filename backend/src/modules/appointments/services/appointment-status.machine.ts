/**
 * The ADR-001 transition matrix (RM M11.3, API §5).
 *
 * ## One table, three enforcement points
 *
 * The same matrix is written down three times in this system, and that
 * is deliberate rather than duplication: the frontend's
 * `availableActions()` decides which buttons render, this machine
 * decides which requests succeed, and the `appointments_enforce_transition`
 * trigger from M5.10 decides which rows may exist. The trigger is a
 * backstop for a migration or a psql session; this is the rule the API
 * enforces, because it is the only one of the three that can answer with
 * the 409 and the `detail` API §0.3 requires.
 *
 * ## Why the machine is stricter than the trigger
 *
 * The trigger also permits `pending → scheduled`. No endpoint in API §5
 * performs that move — a `pending` request is approved into `confirmed`
 * — so the machine does not offer it. A backstop may be looser than the
 * rule it backs; the reverse would be the defect.
 *
 * ## What the table deliberately does NOT encode
 *
 * ADR-001 gates `completed` and `no-show` on the slot date having
 * arrived **in the clinic's timezone**, and a transition table has no
 * place to put a clock. That rule lives in `assertSlotDateArrived`
 * below, called by the service after the table has agreed — so an
 * illegal transition and a premature completion produce different
 * `detail` strings, which is what makes either one diagnosable.
 */

import { AppException } from '../../../common/errors/app.exception';
import type { AppointmentStatus } from '../../../generated/prisma/enums';
import { defineStatusMachine, type TransitionTable } from '../../../shared/status';
import { appointmentStatusToWire } from '../dto/appointment-enums';

import { slotDateHasArrived } from './clinic-calendar';

/**
 * ADR-001 §2, verbatim.
 *
 * `Record<AppointmentStatus, …>` through `TransitionTable` makes
 * exhaustiveness the compiler's problem: a ninth status stops the build
 * here rather than silently having no outbound transitions at runtime.
 */
const TABLE: TransitionTable<AppointmentStatus> = {
  // The patient asked; the doctor answers. `awaiting-patient` is reached
  // only from here (ADR-001 RA-001.1's safe reading) — see
  // `proposeSlots` in the service.
  PENDING: ['CONFIRMED', 'CANCELLED', 'AWAITING_PATIENT'],
  SCHEDULED: ['RESCHEDULED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'],
  CONFIRMED: ['RESCHEDULED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'],
  RESCHEDULED: ['RESCHEDULED', 'CANCELLED', 'COMPLETED', 'NO_SHOW'],
  AWAITING_PATIENT: ['CONFIRMED', 'CANCELLED', 'RESCHEDULED'],
  // Terminal. A completed visit is a clinical fact; a cancelled one is a
  // decision someone is accountable for. Neither is edited into
  // something else — a correction is a new appointment.
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

/**
 * The machine speaks wire values in its 409 `detail`, not Prisma members.
 *
 * `AppException.conflict('… cannot move from NO_SHOW to COMPLETED')`
 * names a vocabulary no client has; the contract's §11 header calls the
 * kebab-case literals law. The table is keyed by Prisma member because
 * that is what a row carries, so the wrapper below translates at the one
 * place the message is built.
 */
const machine = defineStatusMachine<AppointmentStatus>('Appointment', TABLE);

export const appointmentStatusMachine = {
  statuses: machine.statuses,
  isTerminal: (status: AppointmentStatus): boolean => machine.isTerminal(status),
  allowedFrom: (status: AppointmentStatus): readonly AppointmentStatus[] =>
    machine.allowedFrom(status),
  can: (from: AppointmentStatus, to: AppointmentStatus): boolean => machine.can(from, to),

  /** Throws 409 `invalid_status_transition`, worded in wire values. */
  assert(from: AppointmentStatus, to: AppointmentStatus): void {
    if (machine.can(from, to)) return;

    const next = machine.allowedFrom(from);
    const detail =
      next.length === 0
        ? `Appointment is ${appointmentStatusToWire(from)} and cannot change status`
        : `Appointment cannot move from ${appointmentStatusToWire(from)} to ` +
          `${appointmentStatusToWire(to)}; allowed: ` +
          next.map(appointmentStatusToWire).join(', ');

    throw AppException.conflict(detail, 'invalid_status_transition');
  },
} as const;

/** The two statuses ADR-001 gates on the slot date having arrived. */
const REQUIRES_SLOT_ARRIVED: readonly AppointmentStatus[] = ['COMPLETED', 'NO_SHOW'];

/**
 * ADR-001's second gate: a visit is not completed before it happens.
 *
 * Separate from the table and raised with its own `detail` so the two
 * failures are distinguishable. "Cannot move from confirmed to
 * completed" would be an untrue message for an appointment that is
 * simply in the future — that move is legal tomorrow.
 */
export function assertSlotDateArrived(
  target: AppointmentStatus,
  slotStart: Date,
  timeZone: string,
  now: Date,
): void {
  if (!REQUIRES_SLOT_ARRIVED.includes(target)) return;
  if (slotDateHasArrived(slotStart, timeZone, now)) return;

  throw AppException.conflict(
    `An appointment cannot be marked ${appointmentStatusToWire(target)} before its slot date`,
    'slot_not_reached',
  );
}

/**
 * The actions a doctor may take, mirroring the frontend's
 * `availableActions()` exactly (API §5: "the client must never compute
 * whether an action is allowed").
 *
 * Returned on every appointment payload so the row menu is drawn from
 * the server's answer rather than from a second copy of the matrix that
 * can drift out of step with it.
 */
export type AppointmentActionWire =
  | 'approve'
  | 'reject'
  | 'cancel'
  | 'reschedule'
  | 'complete'
  | 'no-show'
  | 'propose-slots';

export function availableActions(
  status: AppointmentStatus,
  slotStart: Date,
  timeZone: string,
  now: Date,
): readonly AppointmentActionWire[] {
  const arrived = slotDateHasArrived(slotStart, timeZone, now);

  switch (status) {
    case 'PENDING':
      return ['approve', 'reject', 'propose-slots'];
    case 'SCHEDULED':
    case 'CONFIRMED':
    case 'RESCHEDULED':
      return arrived
        ? ['complete', 'no-show', 'reschedule', 'cancel']
        : ['reschedule', 'cancel'];
    case 'AWAITING_PATIENT':
      // The proposal is outstanding, so a second one would replace an
      // answer the patient may already be looking at. What remains is
      // resolving it in either direction.
      return ['reschedule', 'cancel'];
    case 'COMPLETED':
    case 'CANCELLED':
    case 'NO_SHOW':
      return [];
  }
}
