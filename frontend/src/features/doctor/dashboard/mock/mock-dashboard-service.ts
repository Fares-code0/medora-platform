import { isCriticalFlag, listLabTests } from '@/features/shared-domain/lab-studies';
import { routes } from '@/routes';

import { alertDetail, type CriticalAlert } from '../model/critical-alerts';
import type { DashboardService } from '../model/dashboard-service';
import {
  MOCK_ACTIVITY,
  MOCK_APPOINTMENTS_TREND,
  MOCK_KPIS,
  MOCK_NOTIFICATIONS,
  MOCK_SATISFACTION,
  MOCK_SCHEDULE,
  MOCK_STATISTICS,
} from '../model/mock-data';

/** The Overview over its seeded figures — every section present. */

const MOCK_LATENCY_MS = 300;

/**
 * The demo's Row-0 banner, from the session lab store the Labs screen
 * reviews into — so a result reviewed there leaves the banner, and the
 * banner lists exactly what the Labs page's "Critical unreviewed" chip
 * counts. The predicate is the server's (`hasCriticalResult`, no review),
 * spelled on the released results as the labs feature does.
 *
 * The other two sources have no shared demo store: clinical alerts and
 * appointments live in feature-private mocks this feature may not import
 * (§3.4). They are left empty rather than seeded beside a schedule they
 * would not match.
 */
function demoCriticalAlerts(now = Date.now()): readonly CriticalAlert[] {
  return listLabTests()
    .filter(
      (test) => test.review === null && test.results.some((result) => isCriticalFlag(result.flag)),
    )
    .sort((a, b) => a.requestedDate.localeCompare(b.requestedDate))
    .map((test) => ({
      id: `lab-${test.id}`,
      kind: 'unreviewed-critical-lab' as const,
      patientName: test.patient.name,
      message: `${test.testName} — critical value awaiting review`,
      detail: alertDetail('unreviewed-critical-lab', test.requestedDate, now),
      href: routes.doctor.labReport(test.id),
    }));
}

const pause = () => new Promise((resolve) => setTimeout(resolve, MOCK_LATENCY_MS));

export const mockDashboardService: DashboardService = {
  async getOverview() {
    await pause();
    const pending = MOCK_KPIS.find((kpi) => kpi.id === 'pending-requests')?.value ?? '0';
    return {
      kpis: MOCK_KPIS,
      schedule: MOCK_SCHEDULE,
      pendingRequests: Number(pending),
      alerts: MOCK_NOTIFICATIONS,
      statistics: MOCK_STATISTICS,
      trend: MOCK_APPOINTMENTS_TREND,
      satisfaction: MOCK_SATISFACTION,
      activity: MOCK_ACTIVITY,
      failedSections: [],
    };
  },

  async getCriticalAlerts() {
    await pause();
    return { served: true, alerts: demoCriticalAlerts() };
  },
};
