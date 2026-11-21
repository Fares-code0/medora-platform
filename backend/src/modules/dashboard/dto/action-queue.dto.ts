/**
 * The doctor's action queue (RM M15.4 — API §16.2).
 *
 * UX §2.1 defines the widget: a unified "needs your decision" list —
 * "appointment requests (Accept / Propose time / Reject inline), unread
 * lab flags, unsigned consultation notes, unanswered patient messages
 * > 24h. Sorted by urgency then age."
 *
 * ## Why the rows are one shape rather than four
 *
 * The widget is one list a doctor works top to bottom, and the sort is
 * across all four sources — so a lab flag can outrank an appointment
 * request. Four differently-shaped arrays would push that sort into the
 * client, where "urgency then age" would be re-decided per renderer and
 * two clients would order the same queue differently. The server does
 * the ordering because the server is the only place it can be done
 * once.
 *
 * Each row therefore carries what the card renders and nothing more:
 * what it is, who it concerns, when it started waiting, and where it
 * goes. The clinical values behind it — the potassium, the note's
 * body — are read on the page the row links to, not here.
 */

/** The four sources UX §2.1 names, in no particular order. */
export type ActionQueueKind =
  | 'appointment-request'
  | 'critical-lab'
  | 'unsigned-note'
  | 'stale-message';

/**
 * How far up the list the row sorts, before age is considered.
 *
 * Three levels rather than a number, because the levels are the
 * product's and a magnitude would invite arithmetic nobody defined.
 * `critical` is reserved for the source UX §2.1 also puts in the Row 0
 * banner — an unreviewed critical result is the one thing on this list
 * that can be a patient-safety event rather than an administrative one.
 */
export type ActionQueueUrgency = 'critical' | 'high' | 'normal';

export interface ActionQueueItemView {
  /** The underlying object's public handle — `APT-…`, `LAB-…`, `MR-…`. */
  readonly id: string;
  readonly kind: ActionQueueKind;
  readonly urgency: ActionQueueUrgency;
  /** One line, already written for display. */
  readonly label: string;
  /** Who it concerns, or `null` for a row with no single patient. */
  readonly patient: ActionQueuePatientView | null;
  /**
   * When this started waiting — the instant "age" is measured from.
   *
   * Deliberately not a pre-formatted "3 days ago": the widget re-renders
   * on a timer and a string computed on the server would freeze at
   * whatever it said when the response was cached.
   */
  readonly waitingSince: string;
  /** Whole hours since `waitingSince`, at the instant of the response. */
  readonly ageHours: number;
}

export interface ActionQueuePatientView {
  /** `PT-…`. */
  readonly id: string;
  readonly name: string;
}

/**
 * `GET /dashboard/doctor/action-queue`.
 *
 * `counts` is per source and is **not** derivable from `items` once the
 * list is capped: a doctor with sixty unsigned notes sees the cap, and a
 * client counting the array would tell them they have twenty.
 */
export interface ActionQueueView {
  readonly items: readonly ActionQueueItemView[];
  readonly counts: ActionQueueCountsView;
  readonly totalItems: number;
  readonly truncated: boolean;
}

export interface ActionQueueCountsView {
  readonly appointmentRequests: number;
  readonly criticalLabs: number;
  readonly unsignedNotes: number;
  readonly staleMessages: number;
}
