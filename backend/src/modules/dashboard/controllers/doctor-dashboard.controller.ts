import { Controller, Get } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { Can } from '../../../shared/authz';
import type { ActionQueueView } from '../dto/action-queue.dto';
import { ActionQueueService } from '../services/action-queue.service';
import { CriticalAlertsService } from '../services/critical-alerts.service';
import { DashboardService } from '../services/dashboard.service';

/**
 * The doctor Overview's widget endpoints (RM M15.4 — API §16.2).
 *
 * The composite and its widgets landed at **M27**, and the composite
 * composes the action queue rather than replacing it: the contract
 * allows both shapes, because UX §2.1 loads widgets independently so
 * that one slow or failing widget cannot blank the first screen a doctor
 * sees. That independence is what the per-widget routes provide; the
 * composite itself is all-or-nothing, because a caller that asked for
 * one document and got eight fields of nine cannot tell which is missing.
 *
 * ## The guard is `records.view`, and that is the narrowest honest one
 *
 * There is no `dashboard.*` capability in the catalogue, and inventing
 * one here would put a permission on the wire that no seeded role holds
 * and no matrix row grants — a guard that refuses everyone is not a
 * guard. Of the capabilities that exist, `records.view` is the one every
 * source of this queue already sits behind: a caller who may not read a
 * chart has no business being told a critical result on one is
 * unreviewed, and the four roles holding it are exactly the clinical
 * ones.
 *
 * The rows themselves are scoped per source in the repository — own
 * book, own care assignments, own authorship, own threads — so holding
 * the capability gets a caller their *own* queue and never anyone
 * else's. Reconciliation §5 rule 5 applies as it does everywhere:
 * nothing here asks "is this the admin", and an account with no
 * `doctors` row simply has an empty queue.
 */
@Can('records.view')
@Controller('dashboard/doctor')
export class DoctorDashboardController {
  constructor(
    private readonly actionQueue: ActionQueueService,
    private readonly dashboard: DashboardService,
    private readonly criticalAlerts: CriticalAlertsService,
  ) {}

  /**
   * API §16.2 — the composite (M27.1).
   *
   * Declared first, and the route is the bare controller path, so no
   * parameterised sibling can shadow it.
   */
  @Get()
  composite(@CurrentUser() user: AuthenticatedUser) {
    return this.dashboard.overview(user);
  }

  /**
   * API §16.3 — the Row-0 banner (M27.3).
   *
   * **Fails loud.** Nothing between the query and the exception filter
   * catches anything; see `CriticalAlertsService`.
   */
  @Get('critical-alerts')
  alerts(@CurrentUser() user: AuthenticatedUser) {
    return this.criticalAlerts.forDoctor(user);
  }

  /** API §16.2 — the Row 2 widget, sorted urgency then age (M15.4). */
  @Get('action-queue')
  queue(@CurrentUser() user: AuthenticatedUser): Promise<ActionQueueView> {
    return this.actionQueue.forDoctor(user);
  }

  /* ── The other widgets (M27.2) ─────────────────────────────── */

  @Get('kpis')
  kpis(@CurrentUser() user: AuthenticatedUser) {
    return this.dashboard.kpisFor(user);
  }

  @Get('schedule')
  schedule(@CurrentUser() user: AuthenticatedUser) {
    return this.dashboard.scheduleFor(user);
  }

  @Get('trends')
  trends(@CurrentUser() user: AuthenticatedUser) {
    return this.dashboard.trendsFor(user);
  }

  @Get('satisfaction')
  satisfaction(@CurrentUser() user: AuthenticatedUser) {
    return this.dashboard.satisfactionFor(user);
  }

  @Get('recent-activity')
  recentActivity(@CurrentUser() user: AuthenticatedUser) {
    return this.dashboard.recentActivityFor(user);
  }
}
