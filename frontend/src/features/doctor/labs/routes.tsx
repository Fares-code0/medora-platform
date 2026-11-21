import type { RouteObject } from 'react-router-dom';

import type { RouteHandle } from '@/layouts';
import { routes } from '@/routes';

/**
 * Laboratory feature routes — FRONTEND_ARCHITECTURE.md §3.4 / §5.3.
 * The list and the result detail are lazy boundaries; the shell
 * breadcrumb reads `handle.crumb`.
 */
export const labsRoutes: readonly RouteObject[] = [
  {
    path: routes.doctor.labs,
    handle: { crumb: 'Labs' } satisfies RouteHandle,
    lazy: async () => {
      const { LabsPage } = await import('./pages/LabsPage');
      return { Component: LabsPage };
    },
  },
  {
    // Declared before `:labId` so the static segment wins the match.
    path: routes.doctor.newLabOrder(),
    handle: { crumb: 'New order' } satisfies RouteHandle,
    lazy: async () => {
      const { NewLabOrderPage } = await import('./pages/NewLabOrderPage');
      return { Component: NewLabOrderPage };
    },
  },
  {
    path: `${routes.doctor.labs}/:labId`,
    handle: { crumb: 'Result' } satisfies RouteHandle,
    lazy: async () => {
      const { LabDetailPage } = await import('./pages/LabDetailPage');
      return { Component: LabDetailPage };
    },
  },
];
