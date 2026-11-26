/**
 * What a patient may do to their own appointment (ADR-049).
 *
 * The owner's decisions of 2026-11-26, written down once and used by both
 * the write routes and the `availableActions` every patient payload
 * carries — so a button the app draws and a request the server accepts are
 * answered by the same function, and cannot drift apart.
 *
 * - **Cancel**: an appointment that is `pending | scheduled | confirmed |
 *   rescheduled | awaiting-patient`, any time **before `startsAt`**. No
 *   window beyond that — none was decided, and inventing one would be
 *   clinical-operations policy in a service class.
 * - **Request a reschedule** (ADR-033 Q2 = R-B): a `scheduled | confirmed
 *   | rescheduled` appointment, before `startsAt`, that belongs to a
 *   hospital (the requested slot must be at the same one) and has no
 *   request already pending. `pending` and `awaiting-patient` are excluded:
 *   the first is still the clinic's to answer, the second already has the
 *   clinic's proposal outstanding (ADR-033 Q3, open).
 *
 * Pure functions over plain values, so the rule is unit-tested without a
 * database and without a clock.
 */

import type { AppointmentStatus } from '../../../generated/prisma/enums';

/** The statuses a patient may cancel from (owner decision 4). */
export const PATIENT_CANCELLABLE: readonly AppointmentStatus[] = [
  'PENDING',
  'SCHEDULED',
  'CONFIRMED',
  'RESCHEDULED',
  'AWAITING_PATIENT',
];

/** The statuses a patient may request a reschedule from (owner decision 5). */
export const PATIENT_RESCHEDULABLE: readonly AppointmentStatus[] = [
  'SCHEDULED',
  'CONFIRMED',
  'RESCHEDULED',
];

/** The closed list of reasons a patient gives for cancelling. */
export const CANCEL_REASON_CODES = [
  'schedule_conflict',
  'feeling_better',
  'booked_elsewhere',
  'transport',
  'cost',
  'other',
] as const;

export type CancelReasonCode = (typeof CANCEL_REASON_CODES)[number];

/** A reschedule request's own lifecycle — distinct from the appointment's. */
export const RESCHEDULE_REQUEST_STATUSES = [
  'pending',
  'approved',
  'rejected',
  'withdrawn',
  'superseded',
] as const;

export type RescheduleRequestStatus = (typeof RESCHEDULE_REQUEST_STATUSES)[number];

export type PatientAction = 'cancel' | 'reschedule';

export interface PatientActionFacts {
  readonly status: AppointmentStatus;
  readonly startsAt: Date;
  /** Whether the appointment belongs to a hospital (legacy rows do not). */
  readonly hasHospital: boolean;
  /** Whether a reschedule request is already pending for it. */
  readonly hasPendingRequest: boolean;
}

/** Strictly before the start: at `startsAt` the visit has begun. */
function notStarted(startsAt: Date, now: Date): boolean {
  return startsAt.getTime() > now.getTime();
}

/** Why a patient may not cancel, or `null` when they may. */
export function cancelRefusal(
  facts: Pick<PatientActionFacts, 'status' | 'startsAt'>,
  now: Date,
): string | null {
  if (!PATIENT_CANCELLABLE.includes(facts.status)) {
    return 'This appointment can no longer be cancelled';
  }
  if (!notStarted(facts.startsAt, now)) {
    return 'An appointment cannot be cancelled once its start time has passed';
  }
  return null;
}

/** Why a patient may not request a reschedule, or `null` when they may. */
export function rescheduleRefusal(facts: PatientActionFacts, now: Date): string | null {
  if (!PATIENT_RESCHEDULABLE.includes(facts.status)) {
    return 'A reschedule can be requested only for a scheduled or confirmed appointment';
  }
  if (!notStarted(facts.startsAt, now)) {
    return 'A reschedule cannot be requested once the appointment has started';
  }
  if (!facts.hasHospital) {
    return 'This appointment is not attached to a hospital and cannot be moved';
  }
  if (facts.hasPendingRequest) {
    return 'A reschedule request for this appointment is already pending';
  }
  return null;
}

/** The server-computed buttons (contract §3): the same rule as the write routes. */
export function patientAvailableActions(facts: PatientActionFacts, now: Date): PatientAction[] {
  const actions: PatientAction[] = [];
  if (cancelRefusal(facts, now) === null) actions.push('cancel');
  if (rescheduleRefusal(facts, now) === null) actions.push('reschedule');
  return actions;
}

/**
 * The `cancelled_reason` a patient cancellation stores: `patient:<code>`,
 * then the optional note. The column is 300 characters and the note is
 * capped at 200 by the schema, so the result always fits.
 */
export function patientCancelledReason(code: CancelReasonCode, note?: string | null): string {
  const trimmed = note?.trim() ?? '';
  return trimmed.length === 0 ? `patient:${code}` : `patient:${code} — ${trimmed}`;
}
