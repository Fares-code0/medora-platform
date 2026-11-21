import type { RouteObject } from 'react-router-dom';

import type { RouteHandle } from '@/layouts';
import { routes } from '@/routes';

/**
 * Reports feature routes — FRONTEND_ARCHITECTURE.md §5.3.
 * One lazy boundary at /doctor/reports; category, date range, and advanced
 * filters live in query params (URL-owned), so the dashboard is shareable.
 */
const lazyPage = async () => {
  const { ReportsPage } = await import('./pages/ReportsPage');
  return { Component: ReportsPage };
};

export const reportsRoutes: readonly RouteObject[] = [
  {
    path: routes.doctor.reports,
    handle: { crumb: 'Reports' } satisfies RouteHandle,
    lazy: lazyPage,
  },
];
