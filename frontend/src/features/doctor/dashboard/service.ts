import { selectService } from '@/api/seam';

import { httpDashboardService } from './http/http-dashboard-service';
import { mockDashboardService } from './mock/mock-dashboard-service';
import type { DashboardService } from './model/dashboard-service';

/**
 * The Overview's selection point (FE-10.4) — the only module the dashboard
 * imports for its data, and the only one that reads the mock flag, through
 * `selectService`.
 */
export const dashboardService: DashboardService = selectService({
  mock: mockDashboardService,
  http: httpDashboardService,
});
