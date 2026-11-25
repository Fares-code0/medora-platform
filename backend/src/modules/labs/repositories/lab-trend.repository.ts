/**
 * The trend query (RM M14.6 — API §8.8).
 *
 * One query, not one per analyte: the analytes are asked for together
 * and `analyte: { in: [...] }` rides the same
 * `lab_results (analyte, resulted_at)` index DB §8 created for exactly
 * this chart. Three round trips where one will do is three times the
 * latency on a drawer a clinician opens from a result they are already
 * looking at.
 *
 * ## Which orders count, and which do not
 *
 * **Completed orders only.** A value entered while the order is still
 * `processing` has not been verified or released, and plotting it would
 * put an unreviewed number on a chart beside released ones with nothing
 * to tell them apart. `completedAt` is also the instant the point is
 * plotted at, which is the frontend's `resultedAt(test)` —
 * `completedDate ?? collectedDate ?? requestedDate` — resolved to its
 * first branch, because a completed order always has a `completed_at`.
 *
 * **Numeric values only.** A series of "Negative" is not a line chart,
 * and `value_numeric` is null for every qualitative result by
 * definition (DB §E5).
 *
 * ## Care scope, as a clause
 *
 * The patient is asserted through `PatientScopeService` before this runs
 * — a trend is patient-child data like any other. The `patientId` here
 * is the resolved uuid, so this query cannot be reached with a handle
 * that was never scoped.
 */

import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/database';

const TREND_SELECT = {
  analyte: true,
  valueNumeric: true,
  unit: true,
  refLow: true,
  refHigh: true,
  refText: true,
  flag: true,
  resultedAt: true,
  order: { select: { publicId: true, completedAt: true } },
} satisfies Prisma.LabResultSelect;

export type TrendRow = Prisma.LabResultGetPayload<{ select: typeof TREND_SELECT }>;

@Injectable()
export class LabTrendRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Every released numeric result for these analytes, oldest first. */
  pointsFor(input: {
    readonly patientId: string;
    /** DR-05 at resource level (F-01): the reader's hospital's orders only. */
    readonly hospitalId: string;
    readonly analytes: readonly string[];
    readonly from?: Date | undefined;
    readonly to?: Date | undefined;
  }): Promise<readonly TrendRow[]> {
    return this.prisma.db.labResult.findMany({
      where: {
        deletedAt: null,
        // Case-insensitive on the analyte name, because the parameter is
        // a comma-separated list a client built from a label. The stored
        // spelling is the catalogue's (see `lab-result.repository.ts`),
        // so `mode: 'insensitive'` is the only tolerance needed — no
        // substring matching, which would fold "Free T3" into "Free T4".
        OR: input.analytes.map((analyte) => ({ analyte: { equals: analyte, mode: 'insensitive' as const } })),
        valueNumeric: { not: null },
        order: {
          patientId: input.patientId,
          hospitalId: input.hospitalId,
          status: 'COMPLETED',
          deletedAt: null,
          ...(input.from === undefined && input.to === undefined
            ? {}
            : {
                completedAt: {
                  ...(input.from === undefined ? {} : { gte: input.from }),
                  ...(input.to === undefined ? {} : { lte: input.to }),
                },
              }),
        },
      },
      select: TREND_SELECT,
      // Ordered in the database rather than in memory: the index is
      // `(analyte, resulted_at)`, so this is the sort it already
      // produces, and a client charting a long history should not pay
      // for a sort the query plan gave away for free.
      orderBy: { resultedAt: 'asc' },
      // A patient with a decade of daily potassiums would otherwise
      // stream thousands of points into a 400-pixel chart. 500 per
      // request is well past what a line chart can resolve and far short
      // of what would hurt.
      take: 500,
    });
  }
}
