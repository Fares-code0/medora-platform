/**
 * Which domain events become notifications, and what they look like
 * (RM M19.2).
 *
 * ## The table is transcribed, not invented
 *
 * Every row below names the source that says a notification happens and
 * who receives it. That constraint is the point: "notify someone when X"
 * is a product decision, and a rules table written from intuition would
 * page clinicians about events nobody asked to hear about while staying
 * silent on ones they did.
 *
 * Every published topic without a source therefore has **no rule**, and
 * its absence is deliberate — see `UNSOURCED_TOPICS` at the foot of this
 * file. An event with no rule is marked delivered and drops; it is
 * not an error, because publishing an event and choosing to notify
 * someone about it are different decisions.
 *
 * ## Priority is the one field almost nothing states
 *
 * `critical` appears in exactly one source — UX 2.9, quoted on the
 * `notifications.pinned` column: "Critical lab alerts stay pinned until
 * acted on". So `lab_result.critical` is the only `critical` rule, and
 * pinning follows from it rather than being set independently.
 *
 * The frontend's `mock-data.ts` assigns priority with `weighted(...)`
 * and a random source, and pins by `index % 23` — decorative data, not a
 * specification. It **is** a real source for the category×kind pairings
 * ("Critical lab result released" is laboratory+alert, "Appointment
 * request" is appointments+update), and those are taken from it. Its
 * priorities are not.
 *
 * Everything else is `normal`. Grading the other rules to `important`
 * would be inventing the product rule this file exists to avoid.
 */

import {
  NotificationCategory,
  NotificationKind,
  NotificationPriority,
} from '../../../generated/prisma/enums';

/**
 * Who a notification goes to, resolved against the database later.
 *
 * These are roles in the event, not user ids: the dispatcher turns
 * `patient` into `patients.user_id` and `doctor` into `doctors.user_id`,
 * and a role that resolves to nobody produces no notification rather
 * than a failure — a patient with no account is an ordinary case
 * (ADR-030 links the two, it does not require the link).
 */
export type Audience = 'patient' | 'doctor' | 'administrators';

export interface NotificationRule {
  readonly category: NotificationCategory;
  readonly priority: NotificationPriority;
  readonly kind: NotificationKind;
  readonly audiences: readonly Audience[];
  readonly title: string;
  /** Why this rule exists, and where it is written down. */
  readonly source: string;
}

/**
 * `pinned` is derived, never configured.
 *
 * UX 2.9 pins *critical* alerts, so pinning is a consequence of priority
 * rather than a second switch that could disagree with it. A rule that
 * could be `critical` and unpinned would be a rule that can contradict
 * the column's own documentation.
 */
export function isPinned(rule: NotificationRule): boolean {
  return rule.priority === NotificationPriority.CRITICAL;
}

const {
  APPOINTMENTS,
  LABORATORY,
  MEDICAL_RECORDS,
  SYSTEM,
} = NotificationCategory;
const { NORMAL, CRITICAL } = NotificationPriority;
const { ALERT, UPDATE, REMINDER } = NotificationKind;

export const NOTIFICATION_RULES: Readonly<Record<string, NotificationRule>> = {
  /**
   * The one critical rule, and the one M19.2's verify step names.
   * API §8.7 raises the alert; UX 2.9 pins it until acted on.
   */
  'lab_result.critical': {
    category: LABORATORY,
    priority: CRITICAL,
    kind: ALERT,
    audiences: ['doctor'],
    title: 'Critical lab result released',
    source: 'API §8.7 (alert) + UX 2.9 (pinned until acted on)',
  },

  'appointment.created': {
    category: APPOINTMENTS,
    priority: NORMAL,
    kind: UPDATE,
    audiences: ['doctor'],
    title: 'Appointment request',
    source: 'API §5.1–5.4 — a pending request is the doctor’s to approve',
  },

  'appointment.confirmed': {
    category: APPOINTMENTS,
    priority: NORMAL,
    kind: UPDATE,
    audiences: ['patient'],
    title: 'Appointment confirmed',
    source: 'API §5.4 — "patient notified after commit"',
  },

  'appointment.rejected': {
    category: APPOINTMENTS,
    priority: NORMAL,
    kind: UPDATE,
    audiences: ['patient'],
    title: 'Appointment request declined',
    source: 'API §5.5 — "patient notified"',
  },

  /**
   * The patient, because today only a doctor can reach this transition:
   * ADR-033 (patient appointment actions) is **proposed, not accepted**,
   * so no patient-initiated cancellation route exists to notify the
   * other way round. If ADR-033 is accepted this rule gains a second
   * audience rather than changing.
   */
  'appointment.cancelled': {
    category: APPOINTMENTS,
    priority: NORMAL,
    kind: UPDATE,
    audiences: ['patient'],
    title: 'Appointment cancelled',
    source: 'API §5.7 + ADR-033 (patient-initiated cancellation not in scope)',
  },

  'appointment.rescheduled': {
    category: APPOINTMENTS,
    priority: NORMAL,
    kind: UPDATE,
    audiences: ['patient'],
    title: 'Appointment rescheduled',
    source: 'API §5.7 + ADR-033, as above',
  },

  'appointment.slots_proposed': {
    category: APPOINTMENTS,
    priority: NORMAL,
    kind: UPDATE,
    audiences: ['patient'],
    title: 'New appointment times proposed',
    source: 'API §5.8 — `awaiting-patient` exists so the patient can choose',
  },

  'appointment.nudged': {
    category: APPOINTMENTS,
    priority: NORMAL,
    kind: REMINDER,
    audiences: ['patient'],
    title: 'Reminder: your appointment needs attention',
    source: 'API §5.10 — admin nudge, "templated, logged"',
  },

  'appointment.reassigned': {
    category: APPOINTMENTS,
    priority: NORMAL,
    kind: UPDATE,
    audiences: ['patient', 'doctor'],
    title: 'Appointment reassigned',
    source: 'API §5.10 — "both parties notified"',
  },

  'appointment.cancelled_administratively': {
    category: APPOINTMENTS,
    priority: NORMAL,
    kind: UPDATE,
    audiences: ['patient', 'doctor'],
    title: 'Appointment cancelled by the clinic',
    source: 'API §5.10 — administrative action affecting both parties',
  },

  /**
   * The licence-expiry warning M30.2's sweep publishes.
   *
   * **The practitioner, and only the practitioner.** They are the one
   * party who can act on it — a licence is renewed by its holder — and
   * that is the whole of what any source supports. Adding the
   * administrators would be defensible by analogy with the rule below
   * (verification is theirs, API §3.2/§3.4) and it would still be an
   * invented recipient, which is the one thing this table refuses: "a
   * rules table written from intuition would page clinicians about
   * events nobody asked to hear about". Recorded as **RA-M30.3**; it is
   * one word in `audiences` the day a product owner says so.
   *
   * `REMINDER` rather than `ALERT`: nothing has gone wrong yet, and 60
   * days of alerts is how a feed stops being read.
   */
  'doctor.license_expiring': {
    category: SYSTEM,
    priority: NORMAL,
    kind: REMINDER,
    audiences: ['doctor'],
    title: 'Practising licence expires soon',
    source: 'RM M30.2 (<60/<30-day warnings) — the holder is the only party who can renew',
  },

  /**
   * A clinician flagged a data error on a record (API §6.9, "flag data
   * error → admin queue"). RM M12.7's verify step names the recipient:
   * "report creates a queue row **+ admin notification**" — the one
   * `medical_record.*` topic a source routes to anyone. The body names the
   * record and nothing else; the description stays in the queue, behind
   * its own route, because a notification is a pointer, not a record.
   */
  'medical_record.issue_reported': {
    category: MEDICAL_RECORDS,
    priority: NORMAL,
    kind: UPDATE,
    audiences: ['administrators'],
    title: 'Record data issue reported',
    source: 'API §6.9 ("→ admin queue") + RM M12.7 verify ("+ admin notification")',
  },

  'doctor.verification_reopened': {
    category: SYSTEM,
    priority: NORMAL,
    kind: UPDATE,
    audiences: ['administrators'],
    title: 'Doctor verification reopened',
    source: 'API §3.2 — "license-field edits ⇒ pending + admin notification"',
  },
};

/**
 * Published today, and deliberately without a rule.
 *
 * Listed rather than left implicit so that the gap is answerable: each
 * needs a product owner to say **who** hears about it, and inventing a
 * recipient is how a clinician ends up with a feed they stop reading.
 *
 * `appointment.completed` and `appointment.no_show` are the clearest
 * case — no source says anyone is notified when a visit is closed out,
 * and the doctor performing the transition is the one who would be told.
 */
export const UNSOURCED_TOPICS: readonly string[] = [
  'appointment.completed',
  'appointment.no_show',
  'medical_record.created',
  'medical_record.updated',
  'medical_record.status_changed',
  'medical_record.note_added',
  'medical_record.note_signed',
  'medical_record.attachment_added',
  'prescription.prescribed',
  'prescription.discontinued',
];
