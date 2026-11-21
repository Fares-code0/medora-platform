import { useQuery } from '@tanstack/react-query';

import { createKeyFactory } from '@/api/query-keys';

import { dashboardService } from '../service';

export const dashboardKeys = createKeyFactory('doctor-dashboard');

/** The whole Overview document (FE-10.4) — see `DashboardOverview`. */
export function useDashboardOverviewQuery() {
  return useQuery({
    queryKey: dashboardKeys.all,
    queryFn: () => dashboardService.getOverview(),
    staleTime: 30_000,
  });
}
