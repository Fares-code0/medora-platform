import { Controller, Get, Query } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { zodQuery } from '../../../common/validation/zod-validation.pipe';
import { Can, NotPhi } from '../../../shared/authz';
import type { AnalyticsSnapshotView, RevenueAlternateView } from '../dto/analytics.dto';
import { analyticsQuerySchema, type AnalyticsQuery } from '../dto/analytics.schema';
import { AnalyticsService } from '../services/analytics.service';

/**
 * Reports & Analytics — API §12.1 (RM M17.2).
 *
 * One category answerable so far. **M21** owns the rest of §12 —
 * `AnalyticsSnapshot`, insights, saved and scheduled reports, exports —
 * and this route is the slot M17 reserves for the revenue card, not an
 * early draft of that milestone.
 *
 * ## `appointments.manageOwn`, and why not `records.view`
 *
 * The alternate is a count of the caller's own appointments by visit
 * type. It carries no patient, no identifier and no clinical value —
 * just labels from the visit-type catalogue and integers — so guarding
 * it with a PHI capability would be claiming a sensitivity it does not
 * have, and would refuse `reception`, who holds exactly the capability
 * over exactly this data.
 *
 * `appointments.manageOwn` is the narrowest existing capability over
 * *the book this aggregates*. There is no `reports.*` capability in the
 * catalogue, and inventing one here would put a permission on the wire
 * that no seeded role holds and no matrix row grants — a guard that
 * refuses everyone. M21 may well add one; that is a decision with the
 * rest of §12 in view, not a side effect of this endpoint.
 *
 * Scope is enforced in the service regardless: the count is keyed on the
 * caller's own `doctors` row, and an account without one gets an empty
 * list rather than the clinic's.
 */
@Can('appointments.manageOwn')
@Controller('reports')
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  /**
   * API §12.1 — `GET /reports/analytics?category=&range=`.
   *
   * With billing off, `category=revenue` answers **200 with the
   * alternate payload** — not 404 and not 500 (M17.2's verify step,
   * ADR-018 §2).
   */
  @NotPhi('aggregate reporting; no patient-level data')
  @Get('analytics')
  snapshot(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(analyticsQuerySchema)) query: AnalyticsQuery,
  ): Promise<RevenueAlternateView | AnalyticsSnapshotView> {
    return this.analytics.snapshot(user, query);
  }
}
