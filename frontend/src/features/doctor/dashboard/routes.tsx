import type { RouteObject } from 'react-router-dom';

import type { RouteHandle } from '@/layouts';
import { routes } from '@/routes';

/**
 * Dashboard feature routes — FRONTEND_ARCHITECTURE.md §3.4 / §5.3.
 * The page is a dynamic-import boundary so the feature ships as its own
 * chunk; the shell's breadcrumb reads `handle.crumb`.
 */
export const dashboardRoutes: RouteObject = {
  path: routes.doctor.overview,
  handle: { titleKey: 'nav.overview' } satisfies RouteHandle,
  lazy: async () => {
    const { OverviewPage } = await import('./pages/OverviewPage');
    return { Component: OverviewPage };
  },
};
