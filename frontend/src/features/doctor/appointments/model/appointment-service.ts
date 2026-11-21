import type { Appointment, AppointmentPatientSnapshot, AppointmentPriority } from './types';

/**
 * The appointments port (FE-10.3) — the doctor's own appointment book.
 *
 * Typed from the backend's contract (`backend/src/modules/appointments`,
 * API §5), not from the old mock's `{ status, dateTime, notes }` patch: the
 * server exposes one endpoint per transition, each with its own body, and
 * enforces the status machine itself. A generic patch would let the
 * client write a status the machine never allows; a command can only ask
 * for a transition, and the server answers whether it happened.
 */

/** The five categories the API accepts for declining a request (API §5.4). */
export type RejectCategory =
  | 'schedule_conflict'
  | 'outside_specialty'
  | 'insufficient_information'
  | 'patient_unreachable'
  | 'other';

export const REJECT_CATEGORY_LABELS: Readonly<Record<RejectCategory, string>> = {
  schedule_conflict: 'Schedule conflict',
  outside_specialty: 'Outside my specialty',
  insufficient_information: 'Insufficient information',
  patient_unreachable: 'Patient unreachable',
  other: 'Other',
};

export type AppointmentCommand =
  | { readonly kind: 'approve' }
  | { readonly kind: 'reject'; readonly category: RejectCategory; readonly detail: string }
  /** `reason` is sent to the patient; the API requires one (1–300 chars). */
  | { readonly kind: 'cancel'; readonly reason: string }
  | { readonly kind: 'reschedule'; readonly dateTime: string; readonly reason: string }
  /**
   * Up to three alternative start times for a pending request; the request
   * then waits on the patient (`awaiting-patient`). The reason is optional
   * here, unlike a reschedule, because the API makes it so (API §5.8).
   */
  | { readonly kind: 'propose-slots'; readonly slots: readonly string[]; readonly reason: string }
  | { readonly kind: 'complete' }
  | { readonly kind: 'no-show' };

/** The most alternatives one proposal may carry — the API's own limit (API §5.8). */
export const MAX_PROPOSED_SLOTS = 3;

export interface CreateAppointmentInput {
  readonly patient: AppointmentPatientSnapshot;
  readonly dateTime: string;
  readonly durationMin: number;
  readonly visitType: string;
  readonly department: string;
  /** Display name the mock stamps; the server books the caller itself. */
  readonly doctor: string;
  readonly priority: AppointmentPriority;
  /** Required by the API (1–300 chars). */
  readonly reason: string;
  /**
   * One key per booking intent, reused when that exact booking is retried
   * (`Idempotency-Key`, ADR-014). `POST /appointments` is `@Idempotent()`, so
   * a retry after a lost response replays the first result instead of
   * booking twice. Optional: without it the request behaves as before.
   */
  readonly idempotencyKey?: string;
}

export interface AppointmentService {
  /** Every appointment in the doctor's book. */
  listAppointments(): Promise<readonly Appointment[]>;
  createAppointment(input: CreateAppointmentInput): Promise<Appointment>;
  /** Runs one transition; resolves with the appointment as the server now holds it. */
  runAction(appointmentId: string, command: AppointmentCommand): Promise<Appointment>;
  readonly capabilities: {
    /**
     * Whether the reschedule picker may mark slots busy from a seeded
     * pattern. True only for the mock, whose book is too sparse to look
     * like a real day; over HTTP the server alone decides what is free and
     * answers a 409 `slot_conflict` for a slot it refuses.
     */
    readonly simulatedBusySlots: boolean;
  };
}
