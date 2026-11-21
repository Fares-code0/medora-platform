/**
 * Appointment oversight — domain types (ADM-05 · UX §3.5).
 *
 * The platform-wide view of scheduling: every doctor's appointments in one
 * table, with the transition history and notification receipts an
 * administrator needs to justify intervening. Distinct from the doctor-side
 * appointments model on purpose — §3.4 forbids one feature module importing
 * another's types, and the two answer different questions ("my day" vs
 * "where is the platform stuck"). The status vocabulary is deliberately the
 * same so a future API can serve both from one DTO.
 */

export type OversightStatus =
  | 'pending'
  | 'scheduled'
  | 'confirmed'
  | 'rescheduled'
  | 'completed'
  | 'cancelled'
  | 'no-show'
  /** Waiting on the patient (a proposed slot, a form) — served live (FE-10.10). */
  | 'awaiting-patient';

/** Everything that can appear in an appointment's history, doctor or admin. */
export type OversightEventKind =
  | 'requested'
  | 'confirmed'
  | 'rescheduled'
  | 'nudged'
  | 'reassigned'
  | 'cancelled'
  | 'cancelled-administratively'
  | 'completed'
  | 'no-show';

export type ActorRole = 'patient' | 'doctor' | 'administrator' | 'system';

/** One transition, with who caused it — the drawer's audit line (§3.5 P3). */
export interface OversightEvent {
  readonly id: string;
  readonly kind: OversightEventKind;
  readonly at: string;
  /** Display name of the actor. Never a patient's name — see `actorRole`. */
  readonly actor: string;
  readonly actorRole: ActorRole;
  readonly detail: string;
}

export type NotifiedParty = 'patient' | 'doctor' | 'receiving-doctor';

export type NotificationChannel = 'email' | 'sms' | 'push' | 'in-app';

/** Delivery is reported per party, never assumed from "we sent it". */
export type DeliveryStatus = 'delivered' | 'sent' | 'pending' | 'failed';

export interface NotificationDelivery {
  readonly id: string;
  readonly party: NotifiedParty;
  /** Non-identifying, e.g. "Patient · APT-2418". Names live behind the mask. */
  readonly recipientLabel: string;
  readonly channel: NotificationChannel;
  readonly status: DeliveryStatus;
  readonly at: string;
  readonly subject: string;
}

export interface LinkedComplaint {
  readonly id: string;
  readonly category: string;
  readonly summary: string;
  readonly openedAt: string;
  readonly status: 'open' | 'under-review' | 'resolved';
}

export interface OversightAppointment {
  readonly id: string;
  /**
   * The handle this appointment is known by in logs, toasts and exports —
   * so an administrator can talk about a case without naming the patient.
   */
  readonly reference: string;
  readonly startsAt: string;
  readonly durationMin: number;
  readonly visitType: string;
  readonly department: string;
  readonly specialty: string;
  readonly doctorId: string;
  readonly doctorName: string;
  readonly patientId: string;
  /**
   * Null where the server withholds it. The live oversight row carries the
   * patient's handle and nothing else — API §0.4 masks admin patient
   * projections at the source — so there is nothing here to reveal.
   */
  readonly patientName: string | null;
  readonly patientMrn: string | null;
  readonly status: OversightStatus;
  /**
   * When the appointment entered its current status. Age-in-state is derived
   * from this, and it is what makes "stuck" visible: a Pending row that has
   * not moved in two days is the intervention signal, not the booking date.
   */
  readonly stateSince: string;
  readonly rescheduleCount: number;
  readonly complaint: LinkedComplaint | null;
  readonly lastNudgedAt: string | null;
  readonly events: readonly OversightEvent[];
  readonly notifications: readonly NotificationDelivery[];
}

/** A doctor as the reassign picker sees them: specialty plus live capacity. */
export interface PlatformDoctor {
  readonly id: string;
  readonly name: string;
  readonly specialty: string;
  readonly department: string;
  /**
   * `unknown` where the roster carries no capacity: the live API serves a
   * doctor's practice status but not today's free slots, and checks
   * availability itself when the reassignment is submitted (FE-10.10).
   */
  readonly availability: 'available' | 'limited' | 'unavailable' | 'unknown';
  /** Null where capacity is not served — see `availability`. */
  readonly openSlotsToday: number | null;
  readonly loadPercent: number | null;
  /** Shown in the picker when availability is not `available`. */
  readonly note: string | null;
}

/** The three intervention signals §3.5 asks the toolbar to filter on. */
export type OversightFlag = 'stuck-pending' | 'repeated-reschedules' | 'complaint-attached';

/**
 * Reason categories for an administrative cancellation. Closed set: the
 * category is what makes the cancellations reviewable in aggregate, the
 * free-text reason is what makes one of them defensible.
 */
export type CancelCategory =
  | 'doctor-unavailable'
  | 'clinic-closure'
  | 'duplicate-booking'
  | 'policy-breach'
  | 'patient-safety';

export type DateRangeKey = 'today' | '7d' | '30d' | 'all';

export interface OversightFilters {
  /**
   * Matches reference, doctor, department and visit type — never the patient
   * name or MRN. A search box that resolves masked identifiers would hand
   * back exactly what ADM-10 withholds.
   */
  readonly query: string;
  readonly status: OversightStatus | 'all';
  /** A doctor id, or the literal `'all'` — the sentinel every filter uses. */
  readonly doctorId: string;
  /** A department name, or `'all'`. */
  readonly department: string;
  readonly range: DateRangeKey;
  readonly flag: OversightFlag | 'all';
}

/** The KPI strip above the table. */
export interface OversightSummary {
  readonly todayTotal: number;
  readonly pendingOverThreshold: number;
  readonly cancellationRate7d: number;
  readonly noShowRate7d: number;
  /** Denominator behind the two rates; 0 means "no basis to quote a rate". */
  readonly window7dTotal: number;
}

/** The row `⋯` menu, as a typed machine rather than four ad-hoc booleans. */
export type OversightAction = 'view' | 'nudge' | 'reassign' | 'cancel';
