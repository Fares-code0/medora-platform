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

/**
 * S5 scope filter: `null` is platform-wide (a Platform Admin, or a non-admin
 * role a route admits unchanged); a hospital id restricts to that hospital's
 * rows. Rows with no hospital (legacy) are never in a hospital's scope.
 */
function inHospital(hospitalId: string | null): { hospitalId?: string } {
  return hospitalId === null ? {} : { hospitalId };
}

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

  shifts(hospitalId: string | null) {
    return this.prisma.db.staffShiftAssignment.findMany({
      where: inHospital(hospitalId),
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

  async deleteShift(id: string, hospitalId: string | null): Promise<number> {
    if (!UUID.test(id)) return 0;

    const result = await this.prisma.db.staffShiftAssignment.updateMany({
      where: { id, ...inHospital(hospitalId) },
      data: { deletedAt: new Date() },
    });

    return result.count;
  }

  staffExists(id: string): Promise<number> {
    if (!UUID.test(id)) return Promise.resolve(0);

    return this.prisma.db.staffMember.count({ where: { id } });
  }

  /** The staff member's active affiliation at the hospital, if any (S5). */
  async activeAffiliation(staffId: string, hospitalId: string): Promise<string | null> {
    if (!UUID.test(staffId)) return null;

    const row = await this.prisma.db.hospitalStaffAffiliation.findFirst({
      where: { staffId, hospitalId, endedAt: null, staff: { is: { deletedAt: null } } },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  /* ── Queue ─────────────────────────────────────────────────── */

  queue(hospitalId: string | null) {
    return this.prisma.db.queueEntry.findMany({
      where: inHospital(hospitalId),
      select: QUEUE_SELECT,
      // Urgent first, then longest waiting — the order a receptionist
      // works the list in, and the one the estimate assumes.
      orderBy: [{ priority: 'desc' }, { enqueuedAt: 'asc' }],
    });
  }

  queueEntry(id: string, hospitalId: string) {
    if (!UUID.test(id)) return Promise.resolve(null);

    return this.prisma.db.queueEntry.findFirst({
      where: { id, hospitalId },
      select: QUEUE_SELECT,
    });
  }

  /** A live room of the hospital (S5: a room is assigned only within its hospital). */
  roomInHospital(roomId: string, hospitalId: string): Promise<number> {
    if (!UUID.test(roomId)) return Promise.resolve(0);

    return this.prisma.db.room.count({ where: { id: roomId, hospitalId } });
  }

  async assignRoom(id: string, roomId: string, hospitalId: string) {
    if (!UUID.test(id)) return null;

    const moved = await this.prisma.db.queueEntry.updateMany({
      where: { id, hospitalId },
      data: { roomId },
    });

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

  waitingRoom(hospitalId: string | null) {
    return this.prisma.db.waitingRoomEntry.findMany({
      where: inHospital(hospitalId),
      select: WAITING_SELECT,
      orderBy: { checkedInAt: 'asc' },
    });
  }

  waitingEntry(id: string, hospitalId: string) {
    if (!UUID.test(id)) return Promise.resolve(null);

    return this.prisma.db.waitingRoomEntry.findFirst({
      where: { id, hospitalId },
      select: WAITING_SELECT,
    });
  }

  /**
   * Compare-and-set on the current status.
   *
   * The predicate carries the state the caller believed the row was in,
   * so two receptionists calling the same patient at once produce one
   * write and one 409 — rather than the second silently overwriting a
   * transition the first had already made.
   */
  async transitionWaiting(
    id: string,
    hospitalId: string,
    from: WaitingStatus,
    to: WaitingStatus,
  ): Promise<number> {
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

  /**
   * S5: a Hospital Admin's overview counts its hospital's rows only — the
   * appointments, queue, waiting room and rooms stamped with its hospital,
   * and the doctors with an active employment there. Platform-wide (`null`)
   * is unchanged.
   */
  overviewCounts(from: Date, to: Date, hospitalId: string | null) {
    const window = { gte: from, lt: to };
    const own = inHospital(hospitalId);
    const doctors =
      hospitalId === null ? {} : { employments: { some: { hospitalId, endedAt: null } } };

    return this.prisma.$transaction([
      this.prisma.db.appointment.count({ where: { startsAt: window, ...own } }),
      this.prisma.db.appointment.count({
        where: { startsAt: window, status: 'COMPLETED', ...own },
      }),
      this.prisma.db.appointment.count({
        where: { startsAt: window, status: 'CANCELLED', ...own },
      }),
      this.prisma.db.waitingRoomEntry.count({ where: { status: 'WAITING', ...own } }),
      this.prisma.db.queueEntry.count({ where: own }),
      this.prisma.db.doctor.count({ where: doctors }),
      this.prisma.db.room.count({ where: own }),
      this.prisma.db.room.count({ where: { status: 'OCCUPIED', ...own } }),
    ]);
  }

  /** Distinct patients with an appointment today. */
  async todaysPatients(from: Date, to: Date, hospitalId: string | null): Promise<number> {
    const grouped = await this.prisma.db.appointment.groupBy({
      by: ['patientId'],
      where: { startsAt: { gte: from, lt: to }, ...inHospital(hospitalId) },
    });

    return grouped.length;
  }

  /** Start times, for the hourly-activity histogram. */
  todaysStarts(from: Date, to: Date, hospitalId: string | null) {
    return this.prisma.db.appointment.findMany({
      where: { startsAt: { gte: from, lt: to }, ...inHospital(hospitalId) },
      select: { startsAt: true },
    });
  }

  /** Doctors with at least one appointment today, for utilisation. */
  async busyDoctors(from: Date, to: Date, hospitalId: string | null): Promise<number> {
    const grouped = await this.prisma.db.appointment.groupBy({
      by: ['doctorId'],
      where: { startsAt: { gte: from, lt: to }, ...inHospital(hospitalId) },
    });

    return grouped.length;
  }

  /** Waiting-room check-in times, for the average wait. */
  waitingSince(hospitalId: string | null) {
    return this.prisma.db.waitingRoomEntry.findMany({
      where: { status: 'WAITING', ...inHospital(hospitalId) },
      select: { checkedInAt: true },
    });
  }

  /** M23.7 — the thin recent feed. The full surface is M28. */
  recentAuditEvents(take: number, hospitalId: string | null) {
    return this.prisma.auditEvent.findMany({
      // S5: a Hospital Admin reads only `audit_events.hospital_id` = its hospital.
      where: inHospital(hospitalId),
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
