/**
 * Analyte trends (RM M14.6 — API §8.8).
 *
 * > "Time series per analyte (max 3), reference band included."
 * > ✅ Verify: series shape matches the chart contract.
 *
 * The chart contract is `AnalyteTrend` in
 * `features/doctor/labs/model/trends.ts`, and this is the server side of
 * the two rules that module enforces in the model rather than the view:
 *
 * 1. **A trend needs a patient, not a test.** The points come from every
 *    completed order this patient has for that analyte — the only
 *    reading of "over time" that means anything clinically. This
 *    endpoint is therefore mounted under `/patients/{patientId}` rather
 *    than under an order, and the patient is care-scoped like any other
 *    chart read.
 * 2. **The most recent result's range wins.** A reference interval can
 *    be revised, and the one a reader is comparing against is the
 *    current one. The points keep the flags they were given at their own
 *    time — the snapshot, which is what makes a historical abnormal stay
 *    abnormal — while the *band* comes from the newest point. That is
 *    `buildAnalyteTrend`'s behaviour, verbatim: it overwrites `unit`,
 *    `referenceLow`, `referenceHigh` and `referenceText` on each pass
 *    through an ascending series, so the last one read wins.
 *
 * ## The cap is the contract's, and it is a 422 rather than a truncation
 *
 * `MAX_TREND_SERIES = 3`. The schema refuses a fourth. Silently
 * returning three of four would leave a client charting a patient's
 * potassium while its legend named their sodium.
 */

import { Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import { PatientScopeService, principalOf } from '../../../shared/authz';
import type { AnalyteTrendView, LabTrendsView, TrendPointView } from '../dto/lab-trend.dto';
import type { LabTrendQuery } from '../dto/lab-order.schema';
import { labResultFlagToWire } from '../dto/labs-enums';
import { LabOrderRepository } from '../repositories/lab-order.repository';
import { LabTrendRepository, type TrendRow } from '../repositories/lab-trend.repository';

@Injectable()
export class LabTrendService {
  constructor(
    private readonly trends: LabTrendRepository,
    private readonly orders: LabOrderRepository,
    private readonly scope: PatientScopeService,
  ) {}

  /** API §8.8. */
  async forPatient(
    user: AuthenticatedUser,
    patientPublicId: string,
    query: LabTrendQuery,
  ): Promise<LabTrendsView> {
    // A trend is patient-child data: same gate, same non-disclosing
    // refusal as every other chart read (RM M7.2, ADR-022).
    await this.scope.assertCanReach(principalOf(user), patientPublicId);

    const patient = await this.orders.patientByPublicId(patientPublicId);
    if (patient === null) throw AppException.notFound('Patient not found');

    const rows = await this.trends.pointsFor({
      patientId: patient.id,
      analytes: query.analytes,
      from: query.from,
      to: query.to,
    });

    const series: AnalyteTrendView[] = [];
    const empty: string[] = [];

    // Iterated in the order the client asked for, not the order the
    // database returned: the client assigns series colours by index
    // (`toneForSeries`), so a response that reordered them would recolour
    // the chart between two identical requests.
    for (const requested of query.analytes) {
      const matching = rows.filter(
        (row) => row.analyte.toLowerCase() === requested.toLowerCase(),
      );

      if (matching.length === 0) {
        empty.push(requested);
        continue;
      }

      series.push(toTrendView(matching));
    }

    return { patientId: patient.publicId, series, empty };
  }
}

/**
 * One analyte's history, oldest first.
 *
 * The rows arrive ascending by `resulted_at` from the repository, and
 * the plotted instant is the order's `completed_at` — the frontend's
 * `resultedAt(test)` resolved to its first branch, since only completed
 * orders are selected. The two can differ: a corrected value is resulted
 * again after release. Sorting on the plotted instant rather than
 * trusting the query's key keeps the line monotonic in the dimension it
 * is actually drawn in.
 */
function toTrendView(rows: readonly TrendRow[]): AnalyteTrendView {
  const points: TrendPointView[] = rows
    .map((row) => ({
      labId: row.order.publicId,
      at: (row.order.completedAt ?? row.resultedAt).toISOString(),
      // Non-null by the repository's `valueNumeric: { not: null }`; the
      // fallback is the type system's price for that, not a real branch.
      value: row.valueNumeric?.toNumber() ?? 0,
      flag: labResultFlagToWire(row.flag),
    }))
    .sort((a, b) => a.at.localeCompare(b.at));

  // The newest row's range — see rule 2 in the file header.
  const newest = rows[rows.length - 1];

  return {
    analyte: newest?.analyte ?? '',
    unit: newest?.unit ?? '',
    referenceLow: newest?.refLow?.toNumber() ?? null,
    referenceHigh: newest?.refHigh?.toNumber() ?? null,
    referenceText: newest?.refText ?? '',
    points,
  };
}
