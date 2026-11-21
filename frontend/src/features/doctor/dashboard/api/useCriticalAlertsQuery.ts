import { useQuery } from '@tanstack/react-query';

import { dashboardService } from '../service';

import { dashboardKeys } from './useDashboardOverviewQuery';

/** How often an open Overview re-checks the banner's sources. */
const CRITICAL_ALERTS_REFRESH_MS = 60_000;

/**
 * The Row-0 banner (API §16.3) — its own query, so it neither waits on the
 * overview nor shares its failure. Never served from a stale cache on
 * arrival: a result reviewed on another screen a moment ago must not still
 * be shouting here, and one released meanwhile must appear.
 */
export function useCriticalAlertsQuery() {
  return useQuery({
    queryKey: dashboardKeys.detail('critical-alerts'),
    queryFn: () => dashboardService.getCriticalAlerts(),
    staleTime: 0,
    refetchInterval: CRITICAL_ALERTS_REFRESH_MS,
  });
}
