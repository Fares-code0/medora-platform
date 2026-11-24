/**
 * The doctor's action queue (RM M15.4 — API §16.2).
 *
 * > ✅ Verify: each source feeds the queue in a seeded scenario;
 * > response < 200 ms.
 *
 * UX §2.1: "unified 'needs your decision' list — appointment requests,
 * unread lab flags, unsigned consultation notes, unanswered patient
 * messages > 24h. Sorted by urgency then age."
 *
 * ## Why this is its own endpoint and not part of `GET /dashboard/doctor`
 *
 * API §16.2 says the widgets "may also be fetched individually
 * (`/dashboard/doctor/schedule`, `/action-queue`, …)" because "UX loads
 * widgets independently with per-widget errors" — and UX §2.1's loading
 * state names the action queue as one of the two widgets fetched
 * *first*. A queue that could only arrive inside an eight-widget
 * composite would be as slow as the slowest widget beside it, and a
 * failure anywhere in that composite would take the queue with it. The
 * composite itself is **M40**, which composes this.
 *
 * ## Urgency is assigned here, from the source's own vocabulary
 *
 * Nothing stores an "urgency" — it is derived, and each derivation is
 * the owning module's own notion of severity rather than a scale
 * invented for this widget:
 *
 * | Source | Urgency | Why |
 * |---|---|---|
 * | Unreviewed critical lab | `critical` | The M14.4 flag. UX §2.1 also puts this source in the Row 0 banner. |
 * | `urgent` appointment request | `high` | §5's own priority vocabulary, top band. |
 * | Stale message > 24h | `high` | A patient has been waiting a day for an answer. |
 * | Everything else | `normal` | |
 *
 * A prescription is deliberately **not** a source. UX §2.1 lists four,
 * and the pharmacy's own queue (refills due, expiring courses) is the
 * Pharmacy screen's — putting it here would make this list something a
 * doctor cannot finish.
 *
 * ## An administrator has no queue here
 *
 * The route is doctor-scoped. An account with no `doctors` row has no
 * book, no authored notes and no care assignments, so every source is
 * empty by construction — and the service says so with an empty queue
 * rather than a refusal, because §16.2's widget is also reachable by an
 * admin viewing the shell. The admin's own queue is §18's, a different
 * list with different sources (UX §3.1).
 */

import { Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { PatientScopeService, principalOf } from '../../../shared/authz';
import type {
  ActionQueueCountsView,
  ActionQueueItemView,
  ActionQueueView,
} from '../dto/action-queue.dto';
import {
  ActionQueueRepository,
  type AppointmentRequestRow,
  type CriticalLabRow,
  type StaleMessageRow,
  type UnsignedNoteRow,
} from '../repositories/action-queue.repository';
import { ageHoursBetween, orderQueue } from './action-queue.ordering';

/**
 * The widget is a 4-column card, not a work list.
 *
 * Capped rather than paginated: a doctor does not page through their
 * overview, they click into the source screen — which is why every row
 * carries the handle that gets them there. `truncated` is reported so a
 * client can say "and 40 more" rather than quietly implying twenty is
 * all there is.
 */
const MAX_ITEMS = 20;

@Injectable()
export class ActionQueueService {
  constructor(
    private readonly queue: ActionQueueRepository,
    /** S4: the queue is the doctor's active hospital's (server-derived). */
    private readonly scope: PatientScopeService,
  ) {}

  /** API §16.2 — `GET /dashboard/doctor/action-queue`. */
  async forDoctor(user: AuthenticatedUser, now = new Date()): Promise<ActionQueueView> {
    const doctor = await this.scope.clinicalEmployment(principalOf(user));

    // The four queries run together. Serially this endpoint would pay
    // four round trips for a widget UX §2.1 priority-fetches, and the
    // sources share no data, so there is nothing to sequence them for.
    const [requests, labs, notes, messages] = await Promise.all([
      doctor === null
        ? Promise.resolve<readonly AppointmentRequestRow[]>([])
        : this.queue.appointmentRequests(doctor),
      doctor === null
        ? Promise.resolve<readonly CriticalLabRow[]>([])
        : this.queue.criticalLabs(doctor),
      // Keyed by the **user**, not the doctor: authorship is a user fact
      // (`record_notes.author_id` references `users`), and only the
      // author may sign.
      this.queue.unsignedNotes(user.id),
      this.queue.staleMessages(user.id, now),
    ]);

    const items = orderQueue([
      ...requests.map((row) => toRequestItem(row, now)),
      ...labs.map((row) => toLabItem(row, now)),
      ...notes.map((row) => toNoteItem(row, now)),
      ...messages.map((row) => toMessageItem(row, now)),
    ]);

    const counts: ActionQueueCountsView = {
      appointmentRequests: requests.length,
      criticalLabs: labs.length,
      unsignedNotes: notes.length,
      staleMessages: messages.length,
    };

    return {
      items: items.slice(0, MAX_ITEMS),
      counts,
      totalItems: items.length,
      truncated: items.length > MAX_ITEMS,
    };
  }
}

function toRequestItem(row: AppointmentRequestRow, now: Date): ActionQueueItemView {
  return {
    id: row.publicId,
    kind: 'appointment-request',
    // §5's own priority vocabulary decides, rather than a second scale:
    // `urgent` is the top band a booking can carry.
    urgency: row.priority === 'URGENT' ? 'high' : 'normal',
    label: 'Appointment request awaiting your decision',
    patient: { id: row.patient.publicId, name: row.patient.fullName },
    // When the *request* arrived, not when the slot is. A request made
    // last week for a slot next month has waited a week for an answer,
    // and it is the answer this queue is about.
    waitingSince: row.createdAt.toISOString(),
    ageHours: ageHoursBetween(row.createdAt, now),
  };
}

function toLabItem(row: CriticalLabRow, now: Date): ActionQueueItemView {
  // Released, else ordered. `completed_at` is null only if the trigger
  // set the flag while the order was still `processing`, which the M14
  // pipeline does not do — the fallback exists so a row cannot be
  // undatable rather than because it is expected.
  const waitingSince = row.completedAt ?? row.requestedAt;

  return {
    id: row.publicId,
    kind: 'critical-lab',
    urgency: 'critical',
    label: `Critical result awaiting review — ${row.testName}`,
    patient: { id: row.patient.publicId, name: row.patient.fullName },
    waitingSince: waitingSince.toISOString(),
    ageHours: ageHoursBetween(waitingSince, now),
  };
}

function toNoteItem(row: UnsignedNoteRow, now: Date): ActionQueueItemView {
  return {
    id: row.recordPublicId,
    kind: 'unsigned-note',
    urgency: 'normal',
    // The note's **title**, never its body: the body is the clinical
    // narrative, and a dashboard card is not a chart (MG §11.6).
    label: `Unsigned note — ${row.title}`,
    patient: { id: row.patient.publicId, name: row.patient.fullName },
    waitingSince: row.authoredAt.toISOString(),
    ageHours: ageHoursBetween(row.authoredAt, now),
  };
}

function toMessageItem(row: StaleMessageRow, now: Date): ActionQueueItemView {
  return {
    id: row.conversationId,
    kind: 'stale-message',
    // A patient who has waited a day for a reply outranks paperwork,
    // which is why UX §2.1 qualifies this source with "> 24h" at all —
    // the age is not incidental to the row, it is what makes it one.
    urgency: 'high',
    label: row.topic ?? 'Message awaiting your reply',
    patient:
      row.patient === null ? null : { id: row.patient.publicId, name: row.patient.fullName },
    waitingSince: row.lastActivityAt.toISOString(),
    ageHours: ageHoursBetween(row.lastActivityAt, now),
  };
}
