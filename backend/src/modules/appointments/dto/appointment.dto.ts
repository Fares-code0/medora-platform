/**
 * The doctor's and administrator's appointment payloads (API §5).
 *
 * ## The patient snapshot is denormalized, and that is the contract
 *
 * API §5.1 specifies `patient { id, name, mrn, phone, age, gender }` on
 * every list item, and the frontend's `AppointmentPatientSnapshot`
 * carries exactly those six fields. It is served from a join rather than
 * copied into the appointments table: a snapshot column would show a
 * patient's old phone number on an appointment booked before they moved.
 * "Denormalized" here describes the *payload*, not the storage.
 *
 * ## `availableActions` is computed server-side
 *
 * API §5 states the rule plainly — the client must never decide whether
 * an action is allowed. The frontend has a `availableActions()` of its
 * own driving which buttons render; this field is what makes the two
 * agree, because a button that renders and a request that 409s is the
 * exact defect the rule exists to prevent.
 *
 * ## Ages, not dates of birth
 *
 * The list carries `age`. A date of birth is a direct identifier under
 * DB §10 and the appointment book has no use for one — `age` is what
 * the row renders. The narrower field is also the one that cannot
 * become a re-identification vector in an export.
 */

import type { AppointmentActionWire } from '../services/appointment-status.machine';

/** The six fields API §5.1 fixes for the embedded patient. */
export interface AppointmentPatientSnapshot {
  /** `patients.public_id` — `PT-…`. */
  readonly id: string;
  readonly name: string;
  readonly mrn: string;
  readonly phone: string;
  readonly age: number;
  readonly gender: string;
}

export interface AppointmentView {
  /** `appointments.public_id` — `APT-…`. */
  readonly id: string;
  readonly patient: AppointmentPatientSnapshot;
  /** ISO-8601 UTC. The client formats in the clinic's zone; it never computes. */
  readonly dateTime: string;
  readonly durationMin: number;
  readonly visitType: string;
  readonly department: string | null;
  readonly doctorId: string;
  readonly doctor: string;
  readonly status: string;
  readonly priority: string;
  readonly isNewPatient: boolean;
  readonly isFollowUp: boolean;
  readonly reason: string;
  readonly notes: string | null;
  readonly availableActions: readonly AppointmentActionWire[];
}

/** One row of `appointment_events` — API §5.2's history. */
export interface AppointmentEventView {
  readonly id: string;
  readonly action: string;
  readonly fromStatus: string | null;
  readonly toStatus: string | null;
  readonly occurredAt: string;
  /**
   * The display name as it was when the event was written
   * (`appointment_events.actor_name`), or `System` for an actor-less
   * row. ADR-003 §4: served from the snapshot rather than resolved
   * through the FK, so a later rename does not rewrite history.
   *
   * Staff names only. A patient never appears here — the patient-facing
   * projection of this same table deliberately coarsens the actor to a
   * category, and this one is read by the clinic about its own staff.
   */
  readonly actor: string;
  readonly reason: string | null;
  readonly detail: Readonly<Record<string, unknown>> | null;
}

/** One outstanding reschedule proposal (API §5.8, DB §S3). */
export interface AppointmentProposalView {
  readonly id: string;
  readonly status: string;
  readonly slots: readonly string[];
  readonly chosenSlot: number | null;
  readonly createdAt: string;
}

export interface AppointmentDetailView extends AppointmentView {
  readonly cancelledReason: string | null;
  readonly createdAt: string;
  readonly events: readonly AppointmentEventView[];
  readonly proposals: readonly AppointmentProposalView[];
}

/** API §5.11 — the cards above the book. */
export interface AppointmentSummaryView {
  readonly today: number;
  readonly pending: number;
  readonly upcoming: number;
  readonly completedThisWeek: number;
}

/**
 * The administrator's strip (API §5.11), served only to a caller holding
 * an oversight capability.
 *
 * Rates are fractions in `[0, 1]` rounded to four places, never
 * pre-formatted percentages: a percentage is a presentation decision,
 * and the frontend's `OversightSummary` renders its own.
 *
 * `windowTotal` is the denominator and is on the wire deliberately —
 * a rate quoted from three appointments is not a rate, and only the
 * client that can see the denominator can decline to draw it.
 */
export interface AppointmentAdminSummaryView extends AppointmentSummaryView {
  readonly pendingOverDay: number;
  readonly cancellationRate7d: number;
  readonly noShowRate7d: number;
  readonly window7dTotal: number;
}

/** API §5.10 — a row of the cross-doctor oversight table. */
export interface OversightAppointmentView {
  readonly id: string;
  readonly reference: string;
  readonly startsAt: string;
  readonly durationMin: number;
  readonly visitType: string;
  readonly department: string | null;
  readonly specialty: string;
  readonly doctorId: string;
  readonly doctorName: string;
  /**
   * The patient's handle and nothing else.
   *
   * The oversight table is the administrator's surface, and API §0.4
   * makes admin patient projections masked unless revealed. The
   * frontend's `OversightAppointment` declares `patientName` and
   * `patientMrn` against the mock; serving them here would hand an
   * administrator in the clear exactly what the reveal of M7.3 exists
   * to audit. The identity fields are omitted, not blanked — an absent
   * field is a visible gap, an empty string reads as "this patient has
   * no name".
   */
  readonly patientId: string;
  readonly status: string;
  /** When the row entered its current status — the age-in-state anchor. */
  readonly stateSince: string;
  /** Whole hours in the current status, derived server-side. */
  readonly ageInStateHours: number;
  readonly rescheduleCount: number;
  readonly lastNudgedAt: string | null;
  readonly flags: readonly string[];
}

/** Age in whole hours, floored, never negative. */
export function hoursSince(since: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - since.getTime()) / 3_600_000));
}

/** Whole years on a given day — the same rule the patients module uses. */
export function ageOn(dateOfBirth: Date, on: Date): number {
  let age = on.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const monthDelta = on.getUTCMonth() - dateOfBirth.getUTCMonth();

  if (monthDelta < 0 || (monthDelta === 0 && on.getUTCDate() < dateOfBirth.getUTCDate())) {
    age -= 1;
  }

  return Math.max(0, age);
}
