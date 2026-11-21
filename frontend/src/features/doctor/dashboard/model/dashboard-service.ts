import type { NamedSeries, Slice } from '@/components/charts';

import type { CriticalAlertsAnswer } from './critical-alerts';
import type {
  ActivityEntry,
  OverviewKpi,
  OverviewNotification,
  OverviewStatistic,
  ScheduleEntry,
} from './mock-data';

/**
 * The doctor-overview port (FE-10.4) — everything the Overview renders, as
 * one document.
 *
 * Each section the server has no source for is `null`, and the widget says
 * so. That is the property this port exists to carry: the mock fills every
 * section with plausible figures, and a live overview that kept showing
 * "Avg. consultation duration 24 min" beside a real schedule would present
 * an invented number as a measured one. Over HTTP the KPIs, today's
 * schedule and the decision list are real (`http/http-dashboard-service.ts`);
 * the trend, satisfaction and recent activity come from the M27 widget
 * routes, which only an API built from `backend` serves — against one that
 * does not, they are null. Practice pulse carries the one metric the API's
 * counts can source, the no-show rate; nothing serves a consultation length
 * or a request response time, so those two are never shown.
 *
 * Those four are **independent** of the rest, as the server designed them
 * to be (`doctor-dashboard.controller.ts`: "one slow or failing widget
 * cannot blank the first screen a doctor sees"). A section whose route
 * answered with a failure is named in `failedSections` and left null; the
 * KPIs, schedule and decision list still render, and only that widget
 * offers Retry.
 */

/** The sections the Overview loads independently of its core. */
export type DashboardSection = 'trend' | 'satisfaction' | 'activity' | 'pulse';

export interface DashboardOverview {
  readonly kpis: readonly OverviewKpi[];
  readonly schedule: readonly ScheduleEntry[];
  /** Requests awaiting the doctor's decision — the greeting's count. */
  readonly pendingRequests: number;
  /** The "needs your attention" list, most urgent first. */
  readonly alerts: readonly OverviewNotification[];
  readonly statistics: readonly OverviewStatistic[] | null;
  readonly trend: readonly NamedSeries[] | null;
  readonly satisfaction: readonly Slice[] | null;
  readonly activity: readonly ActivityEntry[] | null;
  /**
   * Sections whose source exists but failed to answer — each is null above,
   * and its widget shows a failure rather than "Not available yet".
   */
  readonly failedSections: readonly DashboardSection[];
}

export interface DashboardService {
  getOverview(): Promise<DashboardOverview>;
  /**
   * The Row-0 banner (API §16.3), read apart from the overview: it is a
   * safety surface, so it must not wait on the core or vanish with it, and
   * it must fail loudly. It rejects on any failure — never an empty list,
   * which would read as "nothing critical".
   */
  getCriticalAlerts(): Promise<CriticalAlertsAnswer>;
}
