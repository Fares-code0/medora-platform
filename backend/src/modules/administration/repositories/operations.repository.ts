/**
 * Schedule, queue, waiting room and clinic content
 * (API §18, DB §K5–K12, RM M23.3–M23.5, M23.7).
 *
 * ## The seven weekday rows are updated, never created or deleted
 *
 * `clinic_working_days` is keyed by the `Weekday` enum, so the table has
 * exactly seven possible rows by construction. The repository offers an
 * upsert per day and no delete — M23.3's verify step asks for precisely
 * that shape, and a schema that made it possible to delete Wednesday
 * would leave the clinic with a week that has a hole in it.
 */

import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../generated/prisma/client';
import { Weekday, type WaitingStatus } from '../../../generated/prisma/enums';
import { PrismaService } from '../../../shared/database';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const QUEUE_SELECT = {
  id: true,
  ticket: true,
  patientId: true,
  patientName: true,
  reason: true,
  priority: true,
  enqueuedAt: true,
  estimatedMinutes: true,
  roomId: true,
  delayed: true,
  patient: { select: { publicId: true } },
} as const;

const WAITING_SELECT = {
  id: true,
  patientId: true,
  appointmentId: true,
  patientName: true,
  appointmentTime: true,
  checkedInAt: true,
  area: true,
  status: true,
  patient: { select: { publicId: true } },
} as const;

@Injectable()
export class OperationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /* ── Working days ──────────────────────────────────────────── */

  workingDays() {
    return this.prisma.db.clinicWorkingDay.findMany({ orderBy: { day: 'asc' } });
  }

  /**
   * Writes all seven rows in one transaction.
   *
   * A partial week is not a state the clinic can be in — a save that
   * committed Monday through Thursday and then failed would leave the
   * schedule half-changed with no record of which half.
   */
  replaceWorkingWeek(
    rows: readonly {
      day: Weekday;
      open: boolean;
      startTime: Date;
      endTime: Date;
      breakLabel: string | null;
    }[],
  ) {
    return this.prisma.$transaction(
      rows.map((row) =>
        this.prisma.db.clinicWorkingDay.upsert({
          where: { day: row.day },
          create: row,
          update: row,
        }),
      ),
    );
  }

  /* ── Holidays ──────────────────────────────────────────────── */

  holidays() {
    return this.prisma.db.holiday.findMany({ orderBy: { date: 'asc' } });
  }

  createHoliday(data: Prisma.HolidayUncheckedCreateInput) {
    return this.prisma.db.holiday.create({ data });
  }

  async deleteHoliday(id: string): Promise<number> {
    if (!UUID.test(id)) return 0;

    const result = await this.prisma.db.holiday.updateMany({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return result.count;
  }

  /* ── Shifts ────────────────────────────────────────────────── */

  shifts() {
    return this.prisma.db.staffShiftAssignment.findMany({
      select: { id: true, staffId: true, kind: true, days: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  createShift(data: Prisma.StaffShiftAssignmentUncheckedCreateInput) {
    return this.prisma.db.staffShiftAssignment.create({
      data,
      select: { id: true, staffId: true, kind: true, days: true },
    });
  }

  async deleteShift(id: string): Promise<number> {
    if (!UUID.test(id)) return 0;

    const result = await this.prisma.db.staffShiftAssignment.updateMany({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return result.count;
  }

  staffExists(id: string): Promise<number> {
    if (!UUID.test(id)) return Promise.resolve(0);

    return this.prisma.db.staffMember.count({ where: { id } });
  }

  /* ── Queue ─────────────────────────────────────────────────── */

  /* Every queue and waiting-room read and write is confined to one hospital
   * (F-01, OD-07): the operator's own. */

  queue(hospitalId: string) {
    return this.prisma.db.queueEntry.findMany({
      where: { hospitalId },
      select: QUEUE_SELECT,
      // Urgent first, then longest waiting — the order a receptionist
      // works the list in, and the one the estimate assumes.
      orderBy: [{ priority: 'desc' }, { enqueuedAt: 'asc' }],
    });
  }

  queueEntry(id: string, hospitalId: string) {
    if (!UUID.test(id)) return Promise.resolve(null);

    return this.prisma.db.queueEntry.findFirst({ where: { id, hospitalId }, select: QUEUE_SELECT });
  }

  async assignRoom(id: string, roomId: string, hospitalId: string) {
    if (!UUID.test(id)) return null;
    const moved = await this.prisma.db.queueEntry.updateMany({ where: { id, hospitalId }, data: { roomId } });

    return moved.count === 0 ? null : this.queueEntry(id, hospitalId);
  }

  async removeFromQueue(id: string, hospitalId: string): Promise<number> {
    if (!UUID.test(id)) return 0;

    const result = await this.prisma.db.queueEntry.updateMany({
      where: { id, hospitalId },
      data: { deletedAt: new Date() },
    });

    return result.count;
  }

  /* ── Waiting room ──────────────────────────────────────────── */

  waitingRoom(hospitalId: string) {
    return this.prisma.db.waitingRoomEntry.findMany({
      where: { hospitalId },
      select: WAITING_SELECT,
      orderBy: { checkedInAt: 'asc' },
    });
  }

  waitingEntry(id: string, hospitalId: string) {
    if (!UUID.test(id)) return Promise.resolve(null);

    return this.prisma.db.waitingRoomEntry.findFirst({ where: { id, hospitalId }, select: WAITING_SELECT });
  }

  /**
   * Compare-and-set on the current status.
   *
   * The predicate carries the state the caller believed the row was in,
   * so two receptionists calling the same patient at once produce one
   * write and one 409 — rather than the second silently overwriting a
   * transition the first had already made.
   */
  async transitionWaiting(id: string, from: WaitingStatus, to: WaitingStatus, hospitalId: string): Promise<number> {
    if (!UUID.test(id)) return 0;

    const result = await this.prisma.db.waitingRoomEntry.updateMany({
      where: { id, hospitalId, status: from },
      data: { status: to },
    });

    return result.count;
  }

  /* ── Announcements, policies, templates ────────────────────── */

  announcements(includeExpired: boolean, now: Date) {
    return this.prisma.db.announcement.findMany({
      where: includeExpired
        ? {}
        : {
            archived: false,
            // An expired announcement drops out of the active list —
            // M23.5's verify step. `null` never expires.
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
      orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
    });
  }

  createAnnouncement(data: Prisma.AnnouncementUncheckedCreateInput) {
    return this.prisma.db.announcement.create({ data });
  }

  async updateAnnouncement(id: string, data: Prisma.AnnouncementUncheckedUpdateInput) {
    if (!UUID.test(id)) return null;

    const moved = await this.prisma.db.announcement.updateMany({ where: { id }, data });

    return moved.count === 0 ? null : this.prisma.db.announcement.findUnique({ where: { id } });
  }

  async deleteAnnouncement(id: string): Promise<number> {
    if (!UUID.test(id)) return 0;

    const result = await this.prisma.db.announcement.updateMany({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return result.count;
  }

  policies() {
    return this.prisma.db.policy.findMany({ orderBy: { title: 'asc' } });
  }

  policyById(id: string) {
    if (!UUID.test(id)) return Promise.resolve(null);

    return this.prisma.db.policy.findUnique({ where: { id } });
  }

  createPolicy(data: Prisma.PolicyUncheckedCreateInput) {
    return this.prisma.db.policy.create({ data });
  }

  async updatePolicy(id: string, data: Prisma.PolicyUncheckedUpdateInput) {
    if (!UUID.test(id)) return null;

    const moved = await this.prisma.db.policy.updateMany({ where: { id }, data });

    return moved.count === 0 ? null : this.prisma.db.policy.findUnique({ where: { id } });
  }

  async deletePolicy(id: string): Promise<number> {
    if (!UUID.test(id)) return 0;

    const result = await this.prisma.db.policy.updateMany({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return result.count;
  }

  templates() {
    return this.prisma.db.documentTemplate.findMany({ orderBy: { name: 'asc' } });
  }

  createTemplate(data: Prisma.DocumentTemplateUncheckedCreateInput) {
    return this.prisma.db.documentTemplate.create({ data });
  }

  async updateTemplate(id: string, data: Prisma.DocumentTemplateUncheckedUpdateInput) {
    if (!UUID.test(id)) return null;

    const moved = await this.prisma.db.documentTemplate.updateMany({ where: { id }, data });

    return moved.count === 0
      ? null
      : this.prisma.db.documentTemplate.findUnique({ where: { id } });
  }

  async deleteTemplate(id: string): Promise<number> {
    if (!UUID.test(id)) return 0;

    const result = await this.prisma.db.documentTemplate.updateMany({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return result.count;
  }

  /* ── M23.1 overview and M23.7 audit feed ───────────────────── */

  overviewCounts(from: Date, to: Date) {
    const window = { gte: from, lt: to };

    return this.prisma.$transaction([
      this.prisma.db.appointment.count({ where: { startsAt: window } }),
      this.prisma.db.appointment.count({ where: { startsAt: window, status: 'COMPLETED' } }),
      this.prisma.db.appointment.count({ where: { startsAt: window, status: 'CANCELLED' } }),
      this.prisma.db.waitingRoomEntry.count({ where: { status: 'WAITING' } }),
      this.prisma.db.queueEntry.count(),
      this.prisma.db.doctor.count(),
      this.prisma.db.room.count(),
      this.prisma.db.room.count({ where: { status: 'OCCUPIED' } }),
    ]);
  }

  /** Distinct patients with an appointment today. */
  async todaysPatients(from: Date, to: Date): Promise<number> {
    const grouped = await this.prisma.db.appointment.groupBy({
      by: ['patientId'],
      where: { startsAt: { gte: from, lt: to } },
    });

    return grouped.length;
  }

  /** Start times, for the hourly-activity histogram. */
  todaysStarts(from: Date, to: Date) {
    return this.prisma.db.appointment.findMany({
      where: { startsAt: { gte: from, lt: to } },
      select: { startsAt: true },
    });
  }

  /** Doctors with at least one appointment today, for utilisation. */
  async busyDoctors(from: Date, to: Date): Promise<number> {
    const grouped = await this.prisma.db.appointment.groupBy({
      by: ['doctorId'],
      where: { startsAt: { gte: from, lt: to } },
    });

    return grouped.length;
  }

  /** Waiting-room check-in times, for the average wait. */
  waitingSince() {
    return this.prisma.db.waitingRoomEntry.findMany({
      where: { status: 'WAITING' },
      select: { checkedInAt: true },
    });
  }

  /** M23.7 — the thin recent feed. The full surface is M28. */
  recentAuditEvents(take: number) {
    return this.prisma.auditEvent.findMany({
      select: {
        id: true,
        occurredAt: true,
        actorId: true,
        actorRole: true,
        category: true,
        eventType: true,
        severity: true,
        summary: true,
        target: true,
      },
      orderBy: { occurredAt: 'desc' },
      take,
    });
  }
}

export type QueueRow = Prisma.QueueEntryGetPayload<{ select: typeof QUEUE_SELECT }>;
export type WaitingRow = Prisma.WaitingRoomEntryGetPayload<{ select: typeof WAITING_SELECT }>;
