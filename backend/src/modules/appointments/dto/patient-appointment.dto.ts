/**
 * The patient's view of their own appointments — contract §4.1/§4.2, and
 * the patient actions of ADR-049.
 *
 * ## `availableActions` is the server's answer
 *
 * Every payload carries the actions the patient may take *now*, computed by
 * `patient-appointment.policy.ts` — the same functions the write routes
 * call. The client renders buttons from it and never computes the rule
 * itself (contract §4). It was omitted until the owner decided the policy
 * (2026-11-26: cancel any time before `startsAt`; reschedule by request).
 */

import type { PatientAction, RescheduleRequestStatus } from '../services/patient-appointment.policy';

/** The hospital an appointment belongs to — `null` for legacy rows. */
export interface AppointmentHospitalView {
  readonly id: string;
  readonly name: string;
}

/** A reschedule request as the patient (and staff) see it. */
export interface RescheduleRequestView {
  readonly id: string;
  /** The appointment's `APT-…` reference. */
  readonly appointmentId: string;
  readonly status: RescheduleRequestStatus;
  readonly requestedSlot: {
    readonly id: string;
    readonly startsAt: string;
    readonly durationMin: number;
  };
  readonly note: string | null;
  readonly decisionReason: string | null;
  readonly createdAt: string;
  readonly decidedAt: string | null;
}

/** A bookable published slot (`GET /patient/doctors/:doctorId/slots`). */
export interface PatientSlotView {
  readonly id: string;
  readonly startsAt: string;
  readonly durationMin: number;
  readonly hospital: AppointmentHospitalView;
}

/** An active visit type (`GET /patient/visit-types`). */
export interface PatientVisitTypeView {
  readonly id: string;
  readonly name: string;
  readonly durationMin: number | null;
}

/** The doctor as a patient may see them — the §3 projection, embedded. */
export interface AppointmentDoctorView {
  readonly id: string;
  readonly fullName: string;
  readonly title: string | null;
  readonly specialty: string;
  readonly photoUrl: string | null;
}

export interface PatientAppointmentSummary {
  /** `appointments.public_id` — `APT-…`. */
  readonly id: string;
  /** ISO-8601 **UTC**. The client formats; it never computes. */
  readonly startsAt: string;
  readonly durationMin: number;
  /** ADR-001 wire vocabulary, kebab-case: `no-show`, `awaiting-patient`. */
  readonly status: string;
  readonly priority: string;
  readonly reason: string;
  readonly isNewPatient: boolean;
  readonly isFollowUp: boolean;
  readonly visitType: string;
  readonly departmentName: string | null;
  readonly doctor: AppointmentDoctorView;
  readonly hospital: AppointmentHospitalView | null;
  /** Server-computed (ADR-049); the client never derives it. */
  readonly availableActions: readonly PatientAction[];
}

/** One entry of the appointment's history (`appointment_events`). */
export interface PatientAppointmentEvent {
  readonly action: string;
  readonly fromStatus: string | null;
  readonly toStatus: string | null;
  readonly occurredAt: string;
  /**
   * A **coarse category**, never a staff member's name, id or email.
   *
   * `appointment_events` stores `actor_name` — the display name as it was
   * at the time — and it is not projected here. An appointment history is
   * not a route into the clinic's staff directory, and a patient does not
   * need to know which receptionist moved their booking. `system` covers
   * an actor-less row.
   */
  readonly actor: 'patient' | 'clinic' | 'system';
  readonly reason: string | null;
}

export interface PatientAppointmentDetail extends PatientAppointmentSummary {
  readonly notes: string | null;
  readonly cancelledReason: string | null;
  readonly events: readonly PatientAppointmentEvent[];
  readonly pendingRescheduleRequest: RescheduleRequestView | null;
}
