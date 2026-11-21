import type { PagedResult } from '@/api/paged';
import type { AppointmentPriority, AppointmentStatus } from '@/types/vocabularies';

/**
 * Appointments.
 *
 * ── The rule for this whole feature ──────────────────────────────────
 *
 * **The client never computes whether an action is allowed.**
 *
 * The server owns every transition (ADR-001, enforced twice — in
 * `shared/status/status-machine.ts` and by a database trigger). A
 * cancellation window, a reschedule cut-off, a "too late to cancel" rule
 * are all the server's. The client renders the actions the payload
 * offers, and renders `409 conflict` when it loses a race.
 *
 * That is why `Appointment` carries `availableActions` as DATA rather
 * than the client deriving actions from `status`. It is also why there is
 * no transition table anywhere in this tree — `vocabularies.ts` has the
 * eight statuses and deliberately not the arrows between them.
 * `appointments.test.ts` asserts no action is derived from `status`.
 */

/** What the server says this patient may do to this appointment, now. */
export type AppointmentAction = 'cancel' | 'reschedule' | 'confirm';

export interface AppointmentDoctorSummary {
  readonly id: string;
  readonly fullName: string;
  readonly title: string | null;
  readonly specialty: string;
  readonly photoUrl: string | null;
}

export interface Appointment {
  /** `APT-…` */
  readonly id: string;
  /** ISO-8601 UTC. The client FORMATS; it never computes (audit R-12). */
  readonly startsAt: string;
  readonly durationMin: number;
  readonly status: AppointmentStatus;
  /**
   * The clinic's triage priority — and **nothing renders it**.
   *
   * It is mapped from the wire and carried here because the payload sends
   * it and dropping a field to keep a type tidy is how a client ends up
   * unable to show something later. But `low | normal | high | urgent` is
   * the clinic's own scheduling judgement about this patient, and putting
   * it on a screen is a clinical-communication decision rather than a
   * rendering one:
   *
   * - "Urgent" on a card can read as *you are in danger* to someone who
   *   was told nothing of the kind, and this client has no way to add the
   *   sentence a clinician would have added beside it;
   * - "Low" is worse in the other direction — it is a reason a patient
   *   gives themselves for not attending.
   *
   * Neither is a word this app may choose. W-10 signs off clinical copy
   * and AD-5 governs what a patient sees of their own record; this field
   * needs one of them to say what it means to a patient before it can
   * appear. Until then the absence is deliberate and
   * `appointment-detail.test.tsx` asserts it, so the next reader finds a
   * decision rather than an oversight.
   */
  readonly priority: AppointmentPriority;
  readonly doctor: AppointmentDoctorSummary;
  readonly departmentName: string | null;
  readonly visitType: string;
  /** Required, <=300 chars, collected at booking. */
  readonly reason: string;
  readonly notes: string | null;
  readonly cancelledReason: string | null;
  /**
   * The clinic's IANA zone, as the server sends it — on the page for a
   * list row, on the appointment itself for a detail.
   *
   * **Every time on this appointment renders in it.** "Today" is a
   * question about the clinic's zone and not the device's: a travelling
   * patient changes their device zone, not their appointment
   * (`api/endpoints/appointments.ts`, audit R-12). The schema has parsed
   * this field since it was written and the mapper dropped it until
   * 2026-09-12, so a patient one zone from their clinic read the wrong
   * time for their own appointment.
   *
   * `null` where no zone was supplied — a fixture, or a payload from
   * before the field existed. The formatters then fall back to the
   * device's zone, which is what every other screen does, rather than
   * this client guessing a zone for a clinic.
   */
  readonly clinicTimezone: string | null;
  /**
   * Server-provided. Never derived here — and **optional, because the
   * live payload does not carry it yet**.
   *
   * The distinction is the whole point. `undefined` means *the server
   * has not said*, which is the truth while ADR-033 is unanswered: the
   * transition table in ADR-001 says which statuses may follow which and
   * not who may make a transition, so no source in this repository
   * states whether a patient may cancel. `[]` would mean *the server
   * says no action is available* — a claim nobody has the authority to
   * make, and one this client would then render as a missing cancel
   * button with no explanation.
   *
   * An omitted field is a visible gap; a wrong one is a silent defect
   * (contract §4). The field becomes required again when the routes it
   * describes exist.
   */
  readonly availableActions?: readonly AppointmentAction[];
  /** Up to 3 alternatives when the status is `awaiting-patient`. Absent for the same reason. */
  readonly proposedSlots?: readonly ProposedSlot[];
}

export interface ProposedSlot {
  readonly id: string;
  readonly startsAt: string;
  readonly durationMin: number;
}

/** One row of `appointment_events`. Rendered as a timeline. */
export interface AppointmentEvent {
  /**
   * A render key, not an identifier. `appointment_events` rows have no
   * public handle and the patient projection does not invent one, so the
   * HTTP adapter derives this from the event's own timestamp and
   * position. It is never sent back to the server and never displayed.
   */
  readonly id: string;
  readonly at: string;
  readonly fromStatus: AppointmentStatus | null;
  /**
   * Null for an event that did not change the status. The wire allows it
   * (contract §4.2), so this type does too rather than dropping a row
   * from a clinical history to keep a type tidy.
   */
  readonly toStatus: AppointmentStatus | null;
  /** "You", "Dr Haddad", "The clinic" — a display string, never an id. */
  readonly actor: string;
  readonly reason: string | null;
}

export interface AppointmentDetail extends Appointment {
  readonly events: readonly AppointmentEvent[];
}

/**
 * A bookable slot.
 *
 * **Server-computed, always.** Availability minus time-off minus booked
 * minus buffer, in the clinic's timezone, is business logic; §2 of the
 * brief forbids duplicating it in the client and audit BE-06 is the
 * endpoint that will own it. There is no slot generator in this tree and
 * there must not be one — the fixture returns a canned list, it does not
 * compute one from availability rules.
 */
export interface BookableSlot {
  readonly id: string;
  readonly startsAt: string;
  readonly durationMin: number;
}

export interface BookingRequest {
  readonly doctorId: string;
  readonly slotId: string;
  readonly startsAt: string;
  readonly reason: string;
  readonly notes?: string;
}

/**
 * One page of a patient's appointments.
 *
 * `GET /me/appointments` has always been paginated — the envelope
 * carries `page`, `pageSize`, `totalItems` and `totalPages`. This port
 * used to return `readonly Appointment[]`, which meant the adapter read
 * page one and dropped the rest of the response on the floor: a patient
 * with more than one page of history simply could not reach it, and
 * nothing on the screen said so.
 */
export type AppointmentPage = PagedResult<Appointment>;

export interface AppointmentService {
  /** `page` is 1-based, as the contract's `page` parameter is. */
  list(scope: 'upcoming' | 'past', page?: number): Promise<AppointmentPage>;
  getById(id: string): Promise<AppointmentDetail>;
  /** Returns slots the SERVER computed. Never a rule the client applies. */
  listSlots(doctorId: string, fromIso: string, toIso: string): Promise<readonly BookableSlot[]>;
  /** Creates in status `pending`, for the clinic to approve. */
  book(request: BookingRequest, idempotencyKey: string): Promise<Appointment>;
  /** `cancelled_reason` is CHECK-required server-side, so it is required here. */
  cancel(id: string, reason: string): Promise<Appointment>;
  requestReschedule(id: string, reason: string): Promise<Appointment>;
  /** Accepts one of the doctor's proposed slots. */
  acceptProposal(id: string, slotId: string): Promise<Appointment>;
}
