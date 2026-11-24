/**
 * A doctor's own weekly grid and time off (RM M9.4, DB §S2).
 *
 * ## Every method resolves the doctor from a user id, never a parameter
 *
 * API §3.8 and §3.9 are `/me/…` routes: the subject is the token, and
 * `doctors.user_id` is the link. There is no `doctorId` parameter in
 * this file, so a caller cannot edit someone else's grid — not because a
 * check refuses it, but because there is nothing to substitute.
 *
 * ## The grid is replaced, never merged
 *
 * `PUT` means the week as it now stands. A merge would leave a window
 * the doctor believes they deleted, and the schema's
 * `@@unique([doctorId, weekday, startTime])` would then reject the save
 * with a constraint error rather than the field error the client can
 * render. Delete-then-insert inside one transaction is both simpler and
 * the only shape that matches the verb.
 */

import { Injectable } from '@nestjs/common';

import type { Weekday } from '../../../generated/prisma/enums';
import { PrismaService } from '../../../shared/database';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AvailabilityRow {
  readonly weekday: Weekday;
  readonly startTime: Date;
  readonly endTime: Date;
  readonly isBreak: boolean;
}

export interface DoctorSchedulingRow {
  readonly id: string;
  readonly defaultDurationMin: number;
  readonly bufferMin: number;
  readonly availability: readonly AvailabilityRow[];
}

export interface TimeOffRow {
  readonly id: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly kind: string;
  readonly autoBehavior: string;
  readonly createdAt: Date;
}

export interface ImpactedAppointmentRow {
  readonly publicId: string;
  readonly startsAt: Date;
  readonly durationMin: number;
  readonly status: string;
  readonly patient: { readonly publicId: string };
}

/** The statuses a time-off block can actually disturb. */
const LIVE_APPOINTMENT_STATUSES = [
  'SCHEDULED',
  'CONFIRMED',
  'PENDING',
  'AWAITING_PATIENT',
] as const;

@Injectable()
export class AvailabilityRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The caller's `doctors` row id, or null when they are not a doctor. */
  async doctorIdForUser(userId: string): Promise<string | null> {
    if (!UUID.test(userId)) return null;

    const doctor = await this.prisma.db.doctor.findUnique({
      where: { userId },
      select: { id: true },
    });

    return doctor?.id ?? null;
  }

  /** The grid plus the two scheduling defaults that live on `doctors`. */
  async schedulingFor(userId: string): Promise<DoctorSchedulingRow | null> {
    if (!UUID.test(userId)) return null;

    return this.prisma.db.doctor.findUnique({
      where: { userId },
      select: {
        id: true,
        defaultDurationMin: true,
        bufferMin: true,
        availability: {
          select: { weekday: true, startTime: true, endTime: true, isBreak: true },
          orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
        },
      },
    });
  }

  /**
   * Replaces the whole grid and the two defaults in one transaction.
   *
   * Both halves together, because they are saved together by one screen:
   * a slot duration that landed while the windows did not would produce
   * a grid nobody chose.
   */
  async replaceGrid(input: {
    readonly doctorId: string;
    readonly actorId: string;
    readonly rows: readonly {
      readonly weekday: Weekday;
      readonly startTime: Date;
      readonly endTime: Date;
      readonly isBreak: boolean;
    }[];
    readonly defaultDurationMin: number;
    readonly bufferMin: number;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.doctorAvailability.deleteMany({ where: { doctorId: input.doctorId } });
      const employment = await currentEmployment(tx, input.doctorId);

      if (input.rows.length > 0) {
        await tx.doctorAvailability.createMany({
          data: input.rows.map((row) => ({
            ...employment,
            doctorId: input.doctorId,
            weekday: row.weekday,
            startTime: row.startTime,
            endTime: row.endTime,
            isBreak: row.isBreak,
            ...(UUID.test(input.actorId) ? { createdBy: input.actorId } : {}),
          })),
        });
      }

      await tx.doctor.update({
        where: { id: input.doctorId },
        data: {
          defaultDurationMin: input.defaultDurationMin,
          bufferMin: input.bufferMin,
          ...(UUID.test(input.actorId) ? { updatedBy: input.actorId } : {}),
        },
      });
    });
  }

  /** Time-off blocks that have not finished yet, soonest first. */
  async upcomingTimeOff(doctorId: string): Promise<readonly TimeOffRow[]> {
    return this.prisma.db.doctorTimeOff.findMany({
      where: { doctorId, endsAt: { gte: new Date() } },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        kind: true,
        autoBehavior: true,
        createdAt: true,
      },
      orderBy: { startsAt: 'asc' },
    });
  }

  async createTimeOff(input: {
    readonly doctorId: string;
    readonly actorId: string;
    readonly startsAt: Date;
    readonly endsAt: Date;
    readonly kind: string;
    readonly autoBehavior: string;
  }): Promise<TimeOffRow> {
    const employment = await currentEmployment(this.prisma.db, input.doctorId);
    return this.prisma.db.doctorTimeOff.create({
      data: {
        ...employment,
        doctorId: input.doctorId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        kind: input.kind,
        autoBehavior: input.autoBehavior,
        ...(UUID.test(input.actorId) ? { createdBy: input.actorId } : {}),
      },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        kind: true,
        autoBehavior: true,
        createdAt: true,
      },
    });
  }

  /** Deletes one of the caller's own blocks. Returns rows removed — 0 or 1. */
  async removeTimeOff(doctorId: string, timeOffId: string): Promise<number> {
    if (!UUID.test(timeOffId)) return 0;

    const result = await this.prisma.db.doctorTimeOff.deleteMany({
      where: { id: timeOffId, doctorId },
    });

    return result.count;
  }

  /**
   * Live appointments from `from` on — what a new weekly grid could strand
   * (BR-DEC-005). The same live statuses and projection as the time-off
   * preview, so the two lists mean the same thing.
   */
  liveAppointmentsFrom(
    doctorId: string,
    from: Date,
  ): Promise<readonly ImpactedAppointmentRow[]> {
    return this.prisma.db.appointment.findMany({
      where: {
        doctorId,
        startsAt: { gte: from },
        status: { in: [...LIVE_APPOINTMENT_STATUSES] },
      },
      select: {
        publicId: true,
        startsAt: true,
        durationMin: true,
        status: true,
        patient: { select: { publicId: true } },
      },
      orderBy: { startsAt: 'asc' },
    });
  }

  /**
   * `platform_settings.localization.timezone` — the zone the weekly grid's
   * wall clock is read in. `null` when the slice or the field is absent or
   * not a string; the service decides the fallback.
   */
  async clinicTimezone(): Promise<string | null> {
    const row = await this.prisma.db.platformSetting.findUnique({
      where: { key: 'localization' },
      select: { value: true },
    });

    const value: unknown = row?.value;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

    const timezone = (value as Record<string, unknown>)['timezone'];
    return typeof timezone === 'string' ? timezone : null;
  }

  /**
   * Appointments the block would disturb (ADR-005 §7).
   *
   * Only live statuses: a cancelled or completed appointment inside the
   * window is history, and listing it would inflate the blast radius the
   * confirmation screen puts in front of the doctor.
   *
   * The overlap test is `starts_at < to AND starts_at >= from`, which
   * treats an appointment as a point rather than an interval. That is
   * deliberate and is the conservative direction for this list: an
   * appointment starting before the window and running into it is still
   * *scheduled* outside the time off, and the doctor's own judgement —
   * not a duration arithmetic rule nobody has specified — decides
   * whether it moves. M11.5 owns the resolution.
   */
  async impactedAppointments(
    doctorId: string,
    from: Date,
    to: Date,
  ): Promise<readonly ImpactedAppointmentRow[]> {
    return this.prisma.db.appointment.findMany({
      where: {
        doctorId,
        startsAt: { gte: from, lt: to },
        status: { in: [...LIVE_APPOINTMENT_STATUSES] },
      },
      select: {
        publicId: true,
        startsAt: true,
        durationMin: true,
        status: true,
        patient: { select: { publicId: true } },
      },
      orderBy: { startsAt: 'asc' },
    });
  }
}

/**
 * The schedule belongs to the hospital the doctor works at (F-06): rows
 * carry its id and the employment, so the hospital's own policy admits them
 * and a transfer leaves them with the old hospital. No active employment, no
 * stamp — such a doctor is outside clinical standing and cannot reach the
 * schedule routes at all (F-09).
 */
async function currentEmployment(
  client: { doctorEmployment: { findFirst(args: object): Promise<{ id: string; hospitalId: string } | null> } },
  doctorId: string,
): Promise<{ hospitalId: string; doctorEmploymentId: string } | Record<string, never>> {
  const row = await client.doctorEmployment.findFirst({
    where: { doctorId, endedAt: null },
    select: { id: true, hospitalId: true },
  });
  return row === null ? {} : { hospitalId: row.hospitalId, doctorEmploymentId: row.id };
}
