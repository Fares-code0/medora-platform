/**
 * Recent activity — checklist F-06.
 *
 * ── The strongest PHI rule in the app, and why it is here ────────────
 *
 * Home is the screen a phone is most likely to be showing when someone
 * else glances at it: it is what the app opens on, what a patient looks
 * at in a waiting room, and what sits under a notification banner. A
 * notification already says *that* something happened and never *what*
 * (`notifications/model/types.ts`). This feed goes one step further.
 *
 * **The server does not send the words.** An `ActivityEvent` carries a
 * `kind`, a timestamp and — at most — an appointment id. The sentence a
 * patient reads is written here, in the message catalogue, keyed by that
 * kind. So there is no field on this type through which a diagnosis, a
 * result value, a doctor's name or a free-text note can reach the front
 * screen, whatever a future endpoint decides to include.
 *
 * That is a deliberate difference from `PatientNotification`, which does
 * render the server's title and body: a notification is a message
 * composed for the patient and read one screen deep, and this is a
 * standing list on the app's front page.
 *
 * ── The link is one id, for the same reason ──────────────────────────
 *
 * Only `appointmentId`, and only because `/me/appointments/{id}` is a
 * route that enforces its own authorization and answers 404 for anything
 * that is not the caller's. **"The patient was told" must never be read
 * as "the patient may see it"** — the record, lab and prescription
 * routes are governed by AD-5, which is undecided, so a link to one
 * would imply a disclosure decision nobody has made.
 */
export const ACTIVITY_KINDS = [
  'appointment-booked',
  'appointment-confirmed',
  'appointment-cancelled',
  'appointment-rescheduled',
  'record-updated',
  'result-available',
  'prescription-updated',
  'message-received',
] as const;

export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

export interface ActivityEvent {
  readonly id: string;
  readonly kind: ActivityKind;
  /** ISO-8601. The client formats; it never computes (audit R-12). */
  readonly occurredAt: string;
  /** The one linkable entity. `null` for everything else — see above. */
  readonly appointmentId: string | null;
}

export interface ActivityService {
  /**
   * The most recent events, newest first, already limited by the server.
   * There is no paging: this is a Home section, and a patient who wants
   * the whole history wants Appointments or Notifications.
   */
  listRecentActivity(): Promise<readonly ActivityEvent[]>;
}
