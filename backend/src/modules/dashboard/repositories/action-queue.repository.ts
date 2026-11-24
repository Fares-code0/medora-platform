/**
 * The four sources of the doctor's action queue (RM M15.4 — API §16.2).
 *
 * ## Why the dashboard queries these tables itself
 *
 * The widget spans appointments, laboratory, records and messaging, and
 * M2.2's zone 1 forbids importing any of those modules. The rule's own
 * wording says what to do instead: "a module that needs another module's
 * data queries it through its own repository". ADR-036 records the same
 * permission for `PatientTabsRepository`, which reads `appointments` from
 * the patients module — the zones govern *imports between modules*, not
 * which tables a repository selects from.
 *
 * The projections are written out here rather than reused, which is the
 * point rather than duplication: a column added to a lab order must not
 * appear on a doctor's overview by default, and each query below selects
 * only what the row renders.
 *
 * ## Scope: what "mine" means, per source
 *
 * It differs by source, and each difference is the owning module's own
 * rule, transcribed:
 *
 * · **Appointment requests** — `doctor_id`, the doctor's own book
 *   (§5.1). A pending request is addressed to one doctor.
 * · **Critical labs** — ordered by me **or** for a patient in my care,
 *   the disjunction `lab-order.repository.ts` writes as `visibleTo`.
 *   Taking only the first would hide a locum's order on my own patient,
 *   which is precisely the case this row exists for.
 * · **Unsigned notes** — authored by me. Not care scope: only the author
 *   may sign a note (M12.4 refuses a colleague with 403
 *   `not_note_author`), so a colleague's unsigned note in my queue would
 *   be a row I cannot act on.
 * · **Stale messages** — threads I participate in. Membership is the
 *   only scope the messaging schema has.
 *
 * ## The messaging source is real, and today it is empty
 *
 * `conversations`, `conversation_participants` and `messages` exist from
 * M5.9 and the query below is written against them. **M20 owns the
 * messaging feature**, so nothing writes those tables yet and this
 * source contributes no rows in a running deployment — which is the
 * honest state, and different from omitting it. The predicate is
 * derived entirely from columns the schema already defines, so M20
 * inherits a working queue rather than a fourth source still to wire.
 */

import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/database';

/** UX §2.1 — "unanswered patient messages > 24h". */
export const STALE_MESSAGE_HOURS = 24;

export interface QueuePatient {
  readonly publicId: string;
  readonly fullName: string;
}

export interface AppointmentRequestRow {
  readonly publicId: string;
  readonly createdAt: Date;
  readonly startsAt: Date;
  readonly priority: string;
  readonly patient: QueuePatient;
}

export interface CriticalLabRow {
  readonly publicId: string;
  readonly completedAt: Date | null;
  readonly requestedAt: Date;
  readonly testName: string;
  readonly patient: QueuePatient;
}

export interface UnsignedNoteRow {
  readonly recordPublicId: string;
  readonly title: string;
  readonly authoredAt: Date;
  readonly patient: QueuePatient;
}

export interface StaleMessageRow {
  readonly conversationId: string;
  readonly topic: string | null;
  readonly lastActivityAt: Date;
  readonly patient: QueuePatient | null;
}

/**
 * Per source. The queue is capped overall, but each source is fetched
 * with its own headroom so one noisy source cannot starve the others of
 * representation before the sort runs.
 */
const PER_SOURCE_LIMIT = 50;

const QUEUE_PATIENT = { select: { publicId: true, fullName: true } } as const;

@Injectable()
export class ActionQueueRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Pending requests on this doctor's book (§5.1, §5.4). */
  async appointmentRequests(doctorId: string): Promise<readonly AppointmentRequestRow[]> {
    const rows = await this.prisma.db.appointment.findMany({
      where: { doctorId, status: 'PENDING', deletedAt: null, ...atPractice(doctorId) },
      select: {
        publicId: true,
        createdAt: true,
        startsAt: true,
        priority: true,
        patient: QUEUE_PATIENT,
      },
      // Oldest request first: the queue's own sort is age-ascending
      // within an urgency band, and taking the *newest* fifty would drop
      // exactly the requests that have waited longest.
      orderBy: { createdAt: 'asc' },
      take: PER_SOURCE_LIMIT,
    });

    return rows.map((row) => ({ ...row, priority: row.priority }));
  }

  /**
   * Unreviewed critical results (§8.10's chip predicate, verbatim).
   *
   * `hasCriticalResult: true` with `reviewedAt: null` and nothing else,
   * so the query rides `lab_orders_critical_unreviewed_idx` — the
   * partial index M5.8 created on exactly this predicate, and the whole
   * reason DB §14.5-6 permits the column to be stored at all. The scope
   * clause is `OR`ed on top rather than folded in for the same reason.
   */
  criticalLabs(doctorId: string): Promise<readonly CriticalLabRow[]> {
    return this.prisma.db.labOrder.findMany({
      where: {
        deletedAt: null,
        hasCriticalResult: true,
        reviewedAt: null,
        // The doctor's own queue — orders they placed or on a patient in
        // their live care — and only at their current hospital (F-01):
        // neither authorship nor an old assignment reaches another
        // hospital's results.
        AND: [
          atPractice(doctorId),
          {
            OR: [
              { orderedBy: doctorId },
              { patient: { careAssignments: { some: { doctorId, revokedAt: null } } } },
            ],
          },
        ],
      },
      select: {
        publicId: true,
        completedAt: true,
        requestedAt: true,
        test: { select: { name: true } },
        patient: QUEUE_PATIENT,
      },
      orderBy: { completedAt: 'asc' },
      take: PER_SOURCE_LIMIT,
    }).then((rows) =>
      rows.map((row) => ({
        publicId: row.publicId,
        completedAt: row.completedAt,
        requestedAt: row.requestedAt,
        testName: row.test.name,
        patient: row.patient,
      })),
    );
  }

  /**
   * Notes this doctor wrote and has not signed (M12.4).
   *
   * Scoped by **authorship**, not by care: `POST …/notes/{id}/sign`
   * refuses anyone but the author, so a colleague's unsigned note here
   * would be a row with no action behind it.
   */
  unsignedNotes(userId: string): Promise<readonly UnsignedNoteRow[]> {
    return this.prisma.db.recordNote.findMany({
      where: { signed: false, deletedAt: null, authorId: userId },
      select: {
        title: true,
        authoredAt: true,
        record: { select: { publicId: true, patient: QUEUE_PATIENT } },
      },
      orderBy: { authoredAt: 'asc' },
      take: PER_SOURCE_LIMIT,
    }).then((rows) =>
      rows.map((row) => ({
        recordPublicId: row.record.publicId,
        title: row.title,
        authoredAt: row.authoredAt,
        patient: row.record.patient,
      })),
    );
  }

  /**
   * Threads where the last word was not this doctor's, 24 hours on.
   *
   * "Unanswered" is expressed as "the newest live message was written by
   * someone else", which is what the phrase means and what the schema
   * can answer — rather than as `unread_count > 0`, which is a different
   * fact: a doctor who *opened* a thread and did not reply has read it
   * and still owes an answer.
   *
   * Archived threads are excluded. Archiving is the per-viewer act of
   * saying "this is done with"; a queue that kept surfacing an archived
   * thread would make the control meaningless.
   *
   * The two-step — candidates by `last_activity_at`, then the newest
   * message of each — rides `conversations (last_activity_at DESC)` and
   * `messages (conversation_id, sent_at DESC)`, both of which DB §8
   * already creates. A correlated "last author" predicate in one
   * statement would use neither.
   */
  async staleMessages(userId: string, now: Date): Promise<readonly StaleMessageRow[]> {
    const threshold = new Date(now.getTime() - STALE_MESSAGE_HOURS * 60 * 60 * 1000);

    const candidates = await this.prisma.db.conversation.findMany({
      where: {
        deletedAt: null,
        lastActivityAt: { lt: threshold },
        participants: { some: { userId, archived: false } },
      },
      select: {
        id: true,
        topic: true,
        lastActivityAt: true,
        patient: QUEUE_PATIENT,
        messages: {
          where: { deletedAt: null },
          select: { authorId: true },
          orderBy: { sentAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { lastActivityAt: 'asc' },
      take: PER_SOURCE_LIMIT,
    });

    return candidates
      .filter((row) => {
        const newest = row.messages[0];

        // A thread with no messages is not unanswered — nobody has said
        // anything to answer. A system message (`author_id` null) is not
        // a question either.
        return newest !== undefined && newest.authorId !== null && newest.authorId !== userId;
      })
      .map((row) => ({
        conversationId: row.id,
        topic: row.topic,
        lastActivityAt: row.lastActivityAt,
        patient: row.patient,
      }));
  }

  /** The `doctors` row behind an account, or null for a non-clinician. */
  async doctorIdForUser(userId: string): Promise<string | null> {
    const doctor = await this.prisma.db.doctor.findFirst({
      where: { userId },
      select: { id: true },
    });

    return doctor?.id ?? null;
  }
}

/** Kept honest by the compiler: the shape the queries above promise. */
export type QueuePatientSelect = Prisma.PatientGetPayload<{ select: typeof QUEUE_PATIENT.select }>;

/**
 * Resource-level DR-05 for the doctor's own dashboards (audit F-01): rows
 * belonging to a hospital where the doctor practises now, through the
 * patient's Hospital Medical Record there. After a transfer, the former
 * hospital's appointments, orders, notes and alerts leave the dashboard.
 */
function atPractice(doctorId: string) {
  return {
    hospitalMedicalRecord: {
      is: { hospital: { is: { doctorEmployments: { some: { doctorId, endedAt: null } } } } },
    },
  } as const;
}
