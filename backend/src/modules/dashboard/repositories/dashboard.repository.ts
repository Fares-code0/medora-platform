/**
 * The doctor Overview's data (API §16.2, RM M27.1).
 *
 * ## Every figure is counted, none is stored
 *
 * M27.1's verify step is "**KPI values are final, never
 * eventually-consistent** (master guide §12 — the UI does not animate
 * counts)". A cached or incrementally-maintained counter is the thing
 * that makes a count eventually consistent, so there is none: each
 * number is a `COUNT` against an indexed predicate at the instant of the
 * request. Making them fast is **M31.1**'s cache, and it will have to
 * keep this property.
 *
 * ## The KPI block is one transaction
 *
 * The five counts describe one instant. Run separately, a busy clinic
 * could return `completedWeek` from after `todayCount` and show more
 * appointments completed today than booked — the same argument M23.1
 * makes for the clinic overview, and the same fix.
 */

import { Injectable } from '@nestjs/common';

import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/database';

export interface KpiCounts {
  readonly todayCount: number;
  readonly todayCompleted: number;
  readonly nextAt: Date | null;
  readonly pendingRequests: number;
  readonly totalPatients: number;
  readonly completedWeek: number;
  readonly completedPreviousWeek: number;
}

export interface ScheduleRow {
  readonly publicId: string;
  readonly startsAt: Date;
  readonly status: string;
  readonly patient: { readonly fullName: string; readonly dateOfBirth: Date };
  readonly visitType: { readonly name: string };
}

export interface TrendPoint {
  readonly day: string;
  readonly completed: number;
  readonly cancelled: number;
}

export interface SatisfactionRow {
  readonly rating: number;
  readonly count: number;
}

export interface ActivityRow {
  readonly id: string;
  readonly kind: 'note-signed' | 'prescription-issued' | 'lab-released';
  readonly at: Date;
  readonly patientName: string;
  readonly detail: string;
}

@Injectable()
export class DashboardRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** The caller's `doctors` row, or `null` for an account without one. */
  async doctorIdFor(userId: string): Promise<string | null> {
    const row = await this.prisma.db.doctor.findFirst({
      where: { userId },
      select: { id: true },
    });

    return row?.id ?? null;
  }

  /**
   * The five KPI figures, in one transaction — see the header.
   *
   * `nextAt` is the next appointment still ahead of the request's clock,
   * not the next one of the day: a doctor at 16:00 wants the one coming,
   * and "next at 09:00" about an appointment that already happened is
   * the kind of wrong that makes a dashboard untrusted.
   */
  kpis(doctorId: string, now: Date, dayStart: Date, dayEnd: Date, weekStart: Date, previousWeekStart: Date): Promise<KpiCounts> {
    const mine = { doctorId, deletedAt: null };

    return this.prisma.$transaction(async (tx) => {
      const [
        todayCount,
        todayCompleted,
        next,
        pendingRequests,
        totalPatients,
        completedWeek,
        completedPreviousWeek,
      ] = await Promise.all([
        tx.appointment.count({ where: { ...mine, startsAt: { gte: dayStart, lt: dayEnd } } }),
        tx.appointment.count({
          where: { ...mine, status: 'COMPLETED', startsAt: { gte: dayStart, lt: dayEnd } },
        }),
        tx.appointment.findFirst({
          where: {
            ...mine,
            startsAt: { gte: now, lt: dayEnd },
            status: { in: ['SCHEDULED', 'CONFIRMED', 'PENDING'] },
          },
          select: { startsAt: true },
          orderBy: { startsAt: 'asc' },
        }),
        tx.appointment.count({ where: { ...mine, status: 'PENDING' } }),
        // "Active patients" — the care panel, which is what the KPI's
        // own caption in the mock describes. A doctor's patient count is
        // their assignments, not the clinic's roster.
        tx.patient.count({
          where: { deletedAt: null, careAssignments: { some: { doctorId, revokedAt: null } } },
        }),
        tx.appointment.count({
          where: { ...mine, status: 'COMPLETED', startsAt: { gte: weekStart, lt: dayEnd } },
        }),
        tx.appointment.count({
          where: {
            ...mine,
            status: 'COMPLETED',
            startsAt: { gte: previousWeekStart, lt: weekStart },
          },
        }),
      ]);

      return {
        todayCount,
        todayCompleted,
        nextAt: next?.startsAt ?? null,
        pendingRequests,
        totalPatients,
        completedWeek,
        completedPreviousWeek,
      };
    });
  }

  schedule(doctorId: string, dayStart: Date, dayEnd: Date): Promise<ScheduleRow[]> {
    return this.prisma.db.appointment.findMany({
      where: { doctorId, startsAt: { gte: dayStart, lt: dayEnd } },
      select: {
        publicId: true,
        startsAt: true,
        status: true,
        patient: { select: { fullName: true, dateOfBirth: true } },
        visitType: { select: { name: true } },
      },
      orderBy: { startsAt: 'asc' },
    });
  }

  /**
   * Fourteen daily buckets of completed and cancelled appointments.
   *
   * One grouped query rather than twenty-eight counts. `date_trunc` in
   * the database rather than bucketing in Node, because the alternative
   * is pulling every appointment of the fortnight across the wire to
   * count them here.
   *
   * **Every day is returned, including the empty ones** — the service
   * fills the gaps. A fortnight series that skipped quiet days would
   * draw a clinic that closes at random, which is the same rule M23.1
   * applies to its hourly histogram.
   */
  trends(doctorId: string, from: Date, to: Date): Promise<TrendPoint[]> {
    return this.prisma.$queryRaw<TrendPoint[]>`
      SELECT to_char(date_trunc('day', starts_at), 'YYYY-MM-DD') AS day,
             COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
             COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled
      FROM appointments
      WHERE doctor_id = ${doctorId}::uuid
        AND deleted_at IS NULL
        AND starts_at >= ${from}
        AND starts_at < ${to}
      GROUP BY 1
      ORDER BY 1
    `;
  }

  /** Rating histogram for the caller's own surveys, this month. */
  async satisfaction(doctorId: string, from: Date): Promise<SatisfactionRow[]> {
    const rows = await this.prisma.db.satisfactionSurvey.groupBy({
      by: ['rating'],
      where: { doctorId, submittedAt: { gte: from } },
      _count: { _all: true },
    });

    return rows.map((row) => ({ rating: row.rating, count: row._count._all }));
  }

  /**
   * The recent-activity feed, from three clinical sources the caller
   * owns.
   *
   * Deliberately **not** `user_activity_log`: that table's seven kinds
   * are account events (profile, password, login, settings, security,
   * integration, privacy) and the widget shows clinical work — a note
   * signed, a prescription issued, a result released. The two answer
   * different questions for different audiences, which
   * `shared/activity`'s own header states.
   *
   * Nor `audit_events`: that is the administrator's ledger, and M28 owns
   * both its writer and who may read it. A doctor's own recent work is
   * readable from the rows that recorded it.
   */
  async recentActivity(doctorId: string, userId: string, limit: number): Promise<ActivityRow[]> {
    const [notes, prescriptions, labs] = await Promise.all([
      this.prisma.db.recordNote.findMany({
        where: { authorId: userId, signed: true, signedAt: { not: null } },
        select: {
          id: true,
          signedAt: true,
          record: { select: { patient: { select: { fullName: true } } } },
        },
        orderBy: { signedAt: 'desc' },
        take: limit,
      }),
      this.prisma.db.prescription.findMany({
        where: { prescribingDoctorId: doctorId, signedAt: { not: null } },
        select: {
          id: true,
          signedAt: true,
          patient: { select: { fullName: true } },
          medication: { select: { name: true } },
        },
        orderBy: { signedAt: 'desc' },
        take: limit,
      }),
      this.prisma.db.labOrder.findMany({
        where: { orderedBy: doctorId, completedAt: { not: null } },
        select: {
          id: true,
          completedAt: true,
          patient: { select: { fullName: true } },
          test: { select: { name: true } },
        },
        orderBy: { completedAt: 'desc' },
        take: limit,
      }),
    ]);

    const rows: ActivityRow[] = [
      ...notes.map((note) => ({
        id: `note-${note.id}`,
        kind: 'note-signed' as const,
        at: note.signedAt ?? new Date(0),
        patientName: note.record.patient.fullName,
        detail: 'Consultation note signed',
      })),
      ...prescriptions.map((prescription) => ({
        id: `rx-${prescription.id}`,
        kind: 'prescription-issued' as const,
        at: prescription.signedAt ?? new Date(0),
        patientName: prescription.patient.fullName,
        detail: `Prescription issued — ${prescription.medication.name}`,
      })),
      ...labs.map((order) => ({
        id: `lab-${order.id}`,
        kind: 'lab-released' as const,
        at: order.completedAt ?? new Date(0),
        patientName: order.patient.fullName,
        detail: `Lab result released — ${order.test.name}`,
      })),
    ];

    // Merged newest-first and then cut, so the feed is the most recent
    // work across all three rather than the most recent of each.
    return rows.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, limit);
  }
}

/** Kept for the raw trend query's parameter typing. */
export type { Prisma };
