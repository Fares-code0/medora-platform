import { useQuery } from '@tanstack/react-query';

import { createKeyFactory } from '@/api/query-keys';

import { dashboardService } from '../service';

export const dashboardKeys = createKeyFactory('doctor-dashboard');

/**
 * How long an Overview stays fresh. The HTTP adapter assembles it from
 * today's whole appointment list and the doctor's whole patient directory
 * (to count critical and high-risk patients), so every refetch is a full
 * drain of both. Until the API serves those counts itself, the document is
 * not re-assembled on tab focus. The freshness window stays at 30 s because
 * only appointment writes invalidate `dashboardKeys.all`: a patient's risk
 * change is picked up on the next visit after 30 s, not minutes later.
 */
export const OVERVIEW_STALE_TIME_MS = 30_000;

/** The whole Overview document (FE-10.4) — see `DashboardOverview`. */
export function useDashboardOverviewQuery() {
  return useQuery({
    queryKey: dashboardKeys.all,
    queryFn: () => dashboardService.getOverview(),
    staleTime: OVERVIEW_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  });
}
