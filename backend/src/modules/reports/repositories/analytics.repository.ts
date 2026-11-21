/**
 * The revenue alternate's one query (RM M17.2).
 *
 * "Top visit types" is what UX §2.1 puts in the revenue slot when
 * billing is off, and it is the only thing this milestone computes. The
 * nine other analytics categories of API §12.1 are **M21**'s; a
 * repository that answered them here would be M21 built early and
 * removed later.
 */

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../shared/database';

export interface VisitTypeCount {
  readonly label: string;
  readonly value: number;
}

@Injectable()
export class AnalyticsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * This doctor's most frequent visit types in a window.
   *
   * **Doctor scope = own data only**, which is API §12's own header for
   * this section. Counting the clinic's appointments would put a
   * colleague's practice mix on this doctor's report.
   *
   * Cancelled and no-show appointments are excluded: a visit type is
   * counted by what the doctor actually *did*, and a card headed "Top
   * visit types" listing consultations that never happened would
   * misdescribe the practice. `pending` is excluded for the same reason
   * — it is a request, not a visit.
   */
  async topVisitTypes(
    doctorId: string,
    from: Date,
    to: Date,
    limit: number,
  ): Promise<readonly VisitTypeCount[]> {
    const grouped = await this.prisma.db.appointment.groupBy({
      by: ['visitTypeId'],
      where: {
        doctorId,
        deletedAt: null,
        startsAt: { gte: from, lte: to },
        status: { in: ['SCHEDULED', 'CONFIRMED', 'RESCHEDULED', 'COMPLETED'] },
      },
      _count: { _all: true },
      orderBy: { _count: { visitTypeId: 'desc' } },
      take: limit,
    });

    if (grouped.length === 0) return [];

    // The names in one round trip rather than one per group: the labels
    // are a small catalogue and `groupBy` cannot join.
    const names = await this.prisma.db.visitType.findMany({
      where: { id: { in: grouped.map((row) => row.visitTypeId) } },
      select: { id: true, name: true },
    });
    const nameById = new Map(names.map((row) => [row.id, row.name]));

    return grouped.map((row) => ({
      // A visit type is RESTRICT on delete (DB §9), so a missing name
      // is not reachable; the fallback keeps the row readable rather
      // than rendering `undefined` if that ever stops being true.
      label: nameById.get(row.visitTypeId) ?? 'Unknown',
      value: row._count._all,
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
