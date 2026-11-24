/**
 * The revenue category, with billing off (RM M17.2 — API §12.1).
 *
 * > ✅ Verify: `category=revenue` with flag off → **the alternate
 * > payload, not 404 and not 500**.
 *
 * ## Why the other eight categories answer 501 rather than being built
 *
 * M17's exit gate is "nothing built ahead of product need; contract slot
 * reserved". The eight other categories of §12.1 need the full
 * `AnalyticsSnapshot` — eleven members, ten of which have nothing to do
 * with billing — and **M21** owns it. Building them here would be M21
 * arriving early under M17's name, and M21 would then be replacing code
 * rather than writing it.
 *
 * So they answer **501 `not_implemented`**, which is the honest status:
 * the route exists, the category is a real part of the contract, and the
 * server has not implemented it yet. The three alternatives are all
 * worse — a 404 would say the category is not part of the API, a 422
 * would say the client asked wrongly, and an empty `AnalyticsSnapshot`
 * would have a doctor reading a dashboard of zeros as though it were
 * their practice.
 *
 * ## Revenue, with the flag on
 *
 * Also 501, and deliberately: ADR-010 scoped the billing tables OUT, so
 * a deployment that flipped the flag would have no invoices to report
 * on. The branch exists so the day billing lands there is one place to
 * put the real snapshot, and so the flag's two states are visibly
 * different in the code rather than one being unreachable.
 */

import { HttpStatus, Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { PatientScopeService, principalOf, type ClinicalEmployment } from '../../../shared/authz';
import { AppException } from '../../../common/errors/app.exception';
import type { AnalyticsSnapshotView, InsightView, RevenueAlternateView } from '../dto/analytics.dto';
import type { AnalyticsQuery } from '../dto/analytics.schema';
import type { ExportBody } from '../dto/reports.schema';
import { AnalyticsRepository } from '../repositories/analytics.repository';
import { isBillingEnabled } from './billing-flag';
import { InsightService } from './insight.service';
import { resolveRange } from './report-range';
import { ReportExportService, type CsvExport } from './report-export.service';
import { SnapshotService } from './snapshot.service';

/**
 * The scope a non-clinician gets: a `doctors.id` that matches nothing.
 *
 * Every aggregate is keyed by `doctor_id`, so an id no row carries
 * yields zeroes throughout — which is the correct answer for an
 * administrator asking for *their own* clinical numbers, and is reached
 * without a second code path that could drift from the first.
 */
const NONE = '00000000-0000-0000-0000-000000000000';
const EMPTY_SCOPE: ClinicalEmployment = {
  doctorId: NONE,
  doctorEmploymentId: NONE,
  hospitalId: NONE,
};

/** Enough to fill the slot the revenue card would have occupied. */
const TOP_VISIT_TYPES = 5;

/**
 * The line the card shows. Phrased as a statement about the deployment
 * rather than as an error, because it is not one: billing being off is a
 * configuration, and a card saying "unavailable" would read as a fault.
 */
const NOTICE = 'Billing is not enabled for this clinic, so revenue reporting is unavailable. Showing your most frequent visit types instead.';

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly analytics: AnalyticsRepository,
    private readonly snapshots: SnapshotService,
    private readonly insightService: InsightService,
    private readonly exports: ReportExportService,
    /**
     * S4: "own data" is the doctor's own data **at the active hospital**,
     * from the clinical employment (server-derived). No employment —
     * ended, unverified, suspended, deleted, or no doctor at all — is the
     * empty scope.
     */
    private readonly scope: PatientScopeService,
  ) {}

  /**
   * API §12.1 — the snapshot, or the revenue alternate.
   *
   * **M21.1 filled the eight 501s** M17.2 left, and M17's own exit-gate
   * note said how: "M21 extends rather than replaces — it fills the
   * 501s and keeps this alternate for `revenue` while the flag is off".
   * That is exactly the shape of this method now; the revenue branch
   * below is untouched.
   */
  async snapshot(
    user: AuthenticatedUser,
    query: AnalyticsQuery,
  ): Promise<RevenueAlternateView | AnalyticsSnapshotView> {
    if (query.category !== 'revenue') {
      const doctor = await this.scope.clinicalEmployment(principalOf(user));

      // An account with no `doctors` row has no practice to report on.
      // §12's scope is "own data only", and an administrator's own
      // clinical data is none — an empty snapshot, not a refusal, for
      // the same reason the revenue alternate answers an empty list.
      return this.snapshots.build(user.id, doctor ?? EMPTY_SCOPE, query, new Date());
    }

    if (isBillingEnabled()) {
      // Unreachable while ADR-010 group 6 stands. Present so the flag's
      // two states are both visible, and so the day billing lands the
      // snapshot has an obvious home.
      throw notImplemented('Revenue reporting is not implemented yet.');
    }

    const { from, to } = rangeFor(query.range, new Date());
    const doctor = await this.scope.clinicalEmployment(principalOf(user));

    return {
      category: 'revenue',
      billingEnabled: false,
      alternate: 'top-visit-types',
      notice: NOTICE,
      // An account with no `doctors` row has no practice mix, and says
      // so with an empty list rather than a refusal: §12's doctor scope
      // is "own data only", and an administrator's own data is none.
      topVisitTypes:
        doctor === null
          ? []
          : await this.analytics.topVisitTypes(doctor, from, to, TOP_VISIT_TYPES),
      range: { from: from.toISOString(), to: to.toISOString() },
    };
  }

  /** API §12.2 — the seven insight kinds, over the caller's own data. */
  async insights(
    user: AuthenticatedUser,
    query: Partial<AnalyticsQuery>,
  ): Promise<readonly InsightView[]> {
    const now = new Date();
    const custom =
      query.from === undefined || query.to === undefined
        ? undefined
        : { from: new Date(`${query.from}T00:00:00Z`), to: new Date(`${query.to}T00:00:00Z`) };
    const { current, previous } = resolveRange(query.range ?? 'month', now, custom);
    const doctor = await this.scope.clinicalEmployment(principalOf(user));

    return this.insightService.build(user.id, doctor ?? EMPTY_SCOPE, current, previous, now);
  }

  /**
   * API §12.5 — the synchronous CSV.
   *
   * It serialises the same snapshot the JSON endpoint returns rather
   * than querying again: a second path would be a second place for the
   * doctor scope to be got right, and the first to drift.
   */
  async exportCsv(user: AuthenticatedUser, body: ExportBody): Promise<CsvExport> {
    const doctor = await this.scope.clinicalEmployment(principalOf(user));
    const snapshot = await this.snapshots.build(
      user.id,
      doctor ?? EMPTY_SCOPE,
      {
        category: body.category,
        range: body.range,
        compare: false,
        gender: 'all',
        ageBand: 'all',
        ...(body.from === undefined ? {} : { from: body.from }),
        ...(body.to === undefined ? {} : { to: body.to }),
      },
      new Date(),
    );

    return this.exports.toCsv(snapshot);
  }
}

/**
 * 501, with a module-owned code.
 *
 * Built directly rather than through a static on `AppException`: there
 * is no `notImplemented` helper, and adding one to `common/` for a
 * single caller would put a transport-level affordance in the lowest
 * layer for one milestone's benefit. `error-codes.ts` explicitly leaves
 * room for this — "domain modules add their own as they land".
 */
function notImplemented(message: string): AppException {
  return new AppException(HttpStatus.NOT_IMPLEMENTED, {
    message,
    code: 'not_implemented',
    detail: 'Analytics arrive at M21',
  });
}

/**
 * §12.1's ranges as a window, ending now.
 *
 * Calendar-naive on purpose: "month" here is the last thirty days rather
 * than the current calendar month, because a card read on the 1st would
 * otherwise show one day's practice and look like a dead clinic.
 * `AnalyticsSnapshot`'s own ranges are M21's to define precisely; this
 * one is documented so the alternate's numbers are readable rather than
 * mysterious.
 */
export function rangeFor(range: string, now: Date): { from: Date; to: Date } {
  const days: Readonly<Record<string, number>> = {
    today: 1,
    week: 7,
    month: 30,
    quarter: 91,
    year: 365,
  };

  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - (days[range] ?? 30));

  return { from, to: now };
}
