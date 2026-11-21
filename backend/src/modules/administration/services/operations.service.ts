/**
 * Schedule, queue, waiting room, clinic content and the overview
 * (API §18, RM M23.1, M23.3–M23.5, M23.7).
 *
 * ## The waiting-room machine refuses backwards
 *
 * `waiting → called → in-room`, and nothing else. M23.4's verify step
 * names the illegal case explicitly — `in-room → called` → **409** — and
 * the refusal is a compare-and-set rather than a read-then-write, so two
 * receptionists acting at once produce one transition and one conflict
 * instead of a silent overwrite.
 *
 * ## Waiting minutes are derived, and the clock is a parameter
 *
 * "waiting minutes derived from timestamps, not stored" is the verify
 * step. They are computed from `checked_in_at`/`enqueued_at` against the
 * request's own clock, so two reads a minute apart disagree — which is
 * the point of a waiting time.
 *
 * ## Patient identifiers are masked by default
 *
 * M23.4 says so, and names these two surfaces specifically: the queue
 * and the waiting room are where a screen faces a room full of people.
 * The MRN is masked through `shared/phi`; the display name the operator
 * needs to call someone is not, because a queue nobody can be called
 * from is not a queue.
 */

import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';
import { WaitingStatus } from '../../../generated/prisma/enums';
import { isUniqueViolation } from '../../../shared/database';
import { maskMrn } from '../../../shared/phi';
import {
  HOLIDAY_KIND_FROM_WIRE,
  HOLIDAY_KIND_TO_WIRE,
  QUEUE_PRIORITY_TO_WIRE,
  SHIFT_KIND_FROM_WIRE,
  SHIFT_KIND_TO_WIRE,
  TEMPLATE_KIND_FROM_WIRE,
  TEMPLATE_KIND_TO_WIRE,
  WAITING_STATUS_TO_WIRE,
  WEEKDAY_FROM_WIRE,
  WEEKDAY_TO_WIRE,
} from '../dto/administration-enums';
import type {
  AnnouncementBody,
  AnnouncementPatchBody,
  HolidayBody,
  PolicyBody,
  PolicyPatchBody,
  ShiftBody,
  TemplateBody,
  TemplatePatchBody,
  WorkingWeekBody,
} from '../dto/administration.schema';
import {
  OperationsRepository,
  type QueueRow,
  type WaitingRow,
} from '../repositories/operations.repository';

/** `waiting → called → in-room`. Terminal at `in-room`. */
const NEXT: Partial<Record<WaitingStatus, WaitingStatus>> = {
  WAITING: WaitingStatus.CALLED,
  CALLED: WaitingStatus.IN_ROOM,
};

function timeOfDay(value: string): Date {
  const [hours, minutes] = value.split(':');

  return new Date(Date.UTC(1970, 0, 1, Number(hours), Number(minutes), 0));
}

function toTimeString(value: Date): string {
  return `${String(value.getUTCHours()).padStart(2, '0')}:${String(value.getUTCMinutes()).padStart(2, '0')}`;
}

function minutesSince(at: Date, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - at.getTime()) / 60_000));
}

@Injectable()
export class OperationsService {
  constructor(private readonly operations: OperationsRepository) {}

  /* ── M23.3 — schedule ──────────────────────────────────────── */

  async workingDays() {
    return (await this.operations.workingDays()).map((row) => ({
      day: WEEKDAY_TO_WIRE[row.day],
      open: row.open,
      startTime: toTimeString(row.startTime),
      endTime: toTimeString(row.endTime),
      breakLabel: row.breakLabel,
    }));
  }

  async replaceWorkingWeek(body: WorkingWeekBody) {
    await this.operations.replaceWorkingWeek(
      body.map((row) => ({
        day: WEEKDAY_FROM_WIRE[row.day]!,
        open: row.open,
        startTime: timeOfDay(row.startTime),
        endTime: timeOfDay(row.endTime),
        breakLabel: row.breakLabel,
      })),
    );

    return this.workingDays();
  }

  async holidays() {
    return (await this.operations.holidays()).map((row) => ({
      id: row.id,
      name: row.name,
      date: row.date.toISOString().slice(0, 10),
      kind: HOLIDAY_KIND_TO_WIRE[row.kind],
      recurring: row.recurring,
    }));
  }

  /**
   * `holidays_name_date_key` is unique on `(name, date)`.
   *
   * Caught rather than pre-checked: a pre-check cannot see an
   * uncommitted row, so under two administrators saving the same public
   * holiday at once only the constraint is telling the truth. The
   * violation becomes a **409** — the request is well-formed and the
   * world refuses it.
   *
   * Note that a *soft-deleted* holiday still occupies the index, so
   * re-adding one that was removed answers 409 rather than silently
   * creating a second row the unique index would then hide.
   */
  async createHoliday(body: HolidayBody) {
    let row;

    try {
      row = await this.operations.createHoliday({
        name: body.name,
        date: new Date(`${body.date}T00:00:00Z`),
        kind: HOLIDAY_KIND_FROM_WIRE[body.kind]!,
        recurring: body.recurring,
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppException.conflict(`A holiday named "${body.name}" already exists on that date.`);
      }

      throw error;
    }

    return {
      id: row.id,
      name: row.name,
      date: row.date.toISOString().slice(0, 10),
      kind: HOLIDAY_KIND_TO_WIRE[row.kind],
      recurring: row.recurring,
    };
  }

  async deleteHoliday(id: string): Promise<void> {
    if ((await this.operations.deleteHoliday(id)) === 0) {
      throw AppException.notFound('Holiday not found');
    }
  }

  async shifts() {
    return (await this.operations.shifts()).map((row) => ({
      id: row.id,
      staffId: row.staffId,
      kind: SHIFT_KIND_TO_WIRE[row.kind],
      days: row.days,
    }));
  }

  async createShift(body: ShiftBody) {
    if ((await this.operations.staffExists(body.staffId)) === 0) {
      throw AppException.validation({ staffId: ['No such staff member'] }, 'No such staff member');
    }

    const row = await this.operations.createShift({
      staffId: body.staffId,
      kind: SHIFT_KIND_FROM_WIRE[body.kind]!,
      days: body.days,
    });

    return { id: row.id, staffId: row.staffId, kind: SHIFT_KIND_TO_WIRE[row.kind], days: row.days };
  }

  async deleteShift(id: string): Promise<void> {
    if ((await this.operations.deleteShift(id)) === 0) {
      throw AppException.notFound('Shift assignment not found');
    }
  }

  /* ── M23.4 — queue and waiting room ────────────────────────── */

  async queue(now: Date = new Date()) {
    return (await this.operations.queue()).map((row) => toQueueView(row, now));
  }

  /**
   * `POST …/{id}/advance` — the queue's own step.
   *
   * Advancing means the patient has been taken through: the entry
   * leaves the queue. It is a soft delete rather than a status change
   * because `queue_entries` has no status column — the queue *is* the
   * set of people still waiting.
   */
  async advance(id: string): Promise<void> {
    const entry = await this.operations.queueEntry(id);

    if (entry === null) throw AppException.notFound('Queue entry not found');

    await this.operations.removeFromQueue(id);
  }

  async assignRoom(id: string, roomId: string, now: Date = new Date()) {
    const row = await this.operations.assignRoom(id, roomId);

    if (row === null) throw AppException.notFound('Queue entry not found');

    return toQueueView(row, now);
  }

  async removeFromQueue(id: string): Promise<void> {
    if ((await this.operations.removeFromQueue(id)) === 0) {
      throw AppException.notFound('Queue entry not found');
    }
  }

  async waitingRoom(now: Date = new Date()) {
    return (await this.operations.waitingRoom()).map((row) => toWaitingView(row, now));
  }

  /** `call` moves `waiting → called`; `seat` moves `called → in-room`. */
  async moveWaiting(id: string, action: 'call' | 'seat', now: Date = new Date()) {
    const entry = await this.operations.waitingEntry(id);

    if (entry === null) throw AppException.notFound('Waiting-room entry not found');

    const expected = action === 'call' ? WaitingStatus.WAITING : WaitingStatus.CALLED;
    const target = NEXT[expected]!;

    if (entry.status !== expected) {
      // The illegal transition M23.4 names — `in-room → called` is the
      // example, and every other backwards or skipping move lands here.
      throw AppException.conflict(
        `A patient who is ${WAITING_STATUS_TO_WIRE[entry.status]} cannot be ${action === 'call' ? 'called' : 'seated'}.`,
        'invalid_status_transition',
      );
    }

    const moved = await this.operations.transitionWaiting(id, expected, target);

    // Zero means another operator moved the row between the read and the
    // write: the same 409, reached by the compare-and-set rather than by
    // the check above.
    if (moved === 0) {
      throw AppException.conflict(
        'This patient was moved by someone else. Reload the waiting room.',
        'invalid_status_transition',
      );
    }

    const updated = await this.operations.waitingEntry(id);

    return toWaitingView(updated ?? entry, now);
  }

  /* ── M23.5 — announcements, policies, templates ────────────── */

  async announcements(includeExpired: boolean, now: Date = new Date()) {
    return (await this.operations.announcements(includeExpired, now)).map(toAnnouncementView);
  }

  async createAnnouncement(authorId: string, body: AnnouncementBody) {
    return toAnnouncementView(
      await this.operations.createAnnouncement({
        title: body.title,
        body: body.body,
        authorId,
        priority: body.priority.toUpperCase() as never,
        pinned: body.pinned,
        ...(body.expiresAt === null ? {} : { expiresAt: new Date(body.expiresAt) }),
      }),
    );
  }

  async updateAnnouncement(id: string, body: AnnouncementPatchBody) {
    const row = await this.operations.updateAnnouncement(id, {
      ...(body.title === undefined ? {} : { title: body.title }),
      ...(body.body === undefined ? {} : { body: body.body }),
      ...(body.priority === undefined ? {} : { priority: body.priority.toUpperCase() as never }),
      ...(body.pinned === undefined ? {} : { pinned: body.pinned }),
      ...(body.archived === undefined ? {} : { archived: body.archived }),
      ...(body.expiresAt === undefined
        ? {}
        : { expiresAt: body.expiresAt === null ? null : new Date(body.expiresAt) }),
    });

    if (row === null) throw AppException.notFound('Announcement not found');

    return toAnnouncementView(row);
  }

  async deleteAnnouncement(id: string): Promise<void> {
    if ((await this.operations.deleteAnnouncement(id)) === 0) {
      throw AppException.notFound('Announcement not found');
    }
  }

  async policies() {
    return (await this.operations.policies()).map(toPolicyView);
  }

  async createPolicy(body: PolicyBody) {
    return toPolicyView(
      await this.operations.createPolicy({
        title: body.title,
        category: body.category,
        summary: body.summary,
        // Every policy starts at 1; the client cannot choose, so a
        // policy cannot be published already claiming to be at v7.
        version: '1',
      }),
    );
  }

  /**
   * M23.5's verify step: editing a policy increments its version and
   * stamps `updatedAt` **server-side**.
   *
   * `updated_at` is `@updatedAt`, so Prisma stamps it on every write and
   * no client value can reach it. The version is bumped here from the
   * stored one rather than taken from the request — a client that could
   * set it could also freeze it, and a policy whose version never moved
   * would be indistinguishable from one nobody had edited.
   */
  async updatePolicy(id: string, body: PolicyPatchBody) {
    const existing = await this.operations.policyById(id);

    if (existing === null) throw AppException.notFound('Policy not found');

    const next = Number.parseInt(existing.version, 10);
    const row = await this.operations.updatePolicy(id, {
      ...(body.title === undefined ? {} : { title: body.title }),
      ...(body.category === undefined ? {} : { category: body.category }),
      ...(body.summary === undefined ? {} : { summary: body.summary }),
      // A non-numeric stored version restarts at 1 rather than becoming
      // `NaN`: the column is a varchar and a hand-edited value must not
      // be able to poison every later edit.
      version: String(Number.isFinite(next) ? next + 1 : 1),
    });

    if (row === null) throw AppException.notFound('Policy not found');

    return toPolicyView(row);
  }

  async deletePolicy(id: string): Promise<void> {
    if ((await this.operations.deletePolicy(id)) === 0) {
      throw AppException.notFound('Policy not found');
    }
  }

  async templates() {
    return (await this.operations.templates()).map(toTemplateView);
  }

  async createTemplate(body: TemplateBody) {
    return toTemplateView(
      await this.operations.createTemplate({
        name: body.name,
        kind: TEMPLATE_KIND_FROM_WIRE[body.kind]!,
        ...(body.description === undefined ? {} : { description: body.description }),
      }),
    );
  }

  async updateTemplate(id: string, body: TemplatePatchBody) {
    const row = await this.operations.updateTemplate(id, {
      ...(body.name === undefined ? {} : { name: body.name }),
      ...(body.kind === undefined ? {} : { kind: TEMPLATE_KIND_FROM_WIRE[body.kind]! }),
      ...(body.description === undefined ? {} : { description: body.description }),
      ...(body.archived === undefined ? {} : { archived: body.archived }),
      // `usageCount` is absent from the patch shape, so no request can
      // reach it — the server counts uses, a client cannot claim them.
    });

    if (row === null) throw AppException.notFound('Template not found');

    return toTemplateView(row);
  }

  async deleteTemplate(id: string): Promise<void> {
    if ((await this.operations.deleteTemplate(id)) === 0) {
      throw AppException.notFound('Template not found');
    }
  }

  /* ── M23.7 — the thin audit feed ───────────────────────────── */

  async recentAuditEvents(limit: number) {
    return (await this.operations.recentAuditEvents(limit)).map((row) => ({
      id: row.id,
      at: row.occurredAt.toISOString(),
      actorId: row.actorId,
      actorRole: row.actorRole,
      category: String(row.category).toLowerCase(),
      eventType: row.eventType,
      severity: String(row.severity).toLowerCase(),
      summary: row.summary,
      target: row.target,
    }));
  }
}

function toQueueView(row: QueueRow, now: Date) {
  const waitingMinutes = minutesSince(row.enqueuedAt, now);

  return {
    id: row.id,
    ticket: row.ticket,
    // Masked by default (M23.4, M7.3). The display name stays — a queue
    // nobody can be called from is not a queue.
    patientMrn: row.patient === null ? null : maskMrn(row.patient.publicId),
    patientName: row.patientName,
    reason: row.reason,
    priority: QUEUE_PRIORITY_TO_WIRE[row.priority],
    enqueuedAt: row.enqueuedAt.toISOString(),
    // Derived from timestamps, never stored.
    waitingMinutes,
    estimatedMinutes: row.estimatedMinutes,
    roomId: row.roomId,
    // Derived too: waiting longer than the estimate is what "delayed"
    // means, and reading the stored column would let it disagree with
    // the clock the same response is rendering.
    delayed: waitingMinutes > row.estimatedMinutes,
  };
}

function toWaitingView(row: WaitingRow, now: Date) {
  return {
    id: row.id,
    patientMrn: row.patient === null ? null : maskMrn(row.patient.publicId),
    patientName: row.patientName,
    appointmentId: row.appointmentId,
    appointmentTime: row.appointmentTime?.toISOString() ?? null,
    checkedInAt: row.checkedInAt.toISOString(),
    waitingMinutes: minutesSince(row.checkedInAt, now),
    area: row.area,
    status: WAITING_STATUS_TO_WIRE[row.status],
  };
}

function toAnnouncementView(row: {
  id: string;
  title: string;
  body: string;
  priority: string;
  pinned: boolean;
  archived: boolean;
  createdAt: Date;
  expiresAt: Date | null;
}) {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    priority: String(row.priority).toLowerCase(),
    pinned: row.pinned,
    archived: row.archived,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt?.toISOString() ?? null,
  };
}

function toPolicyView(row: {
  id: string;
  title: string;
  category: string;
  summary: string;
  version: string;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    summary: row.summary,
    version: row.version,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function toTemplateView(row: {
  id: string;
  name: string;
  kind: keyof typeof TEMPLATE_KIND_TO_WIRE;
  description: string | null;
  usageCount: number;
  archived: boolean;
}) {
  return {
    id: row.id,
    name: row.name,
    kind: TEMPLATE_KIND_TO_WIRE[row.kind],
    description: row.description,
    usageCount: row.usageCount,
    archived: row.archived,
  };
}
