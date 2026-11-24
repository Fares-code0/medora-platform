import type { RouteObject } from 'react-router-dom';

import type { RouteHandle } from '@/layouts';
import { routes } from '@/routes';

/**
 * Notifications feature routes — FRONTEND_ARCHITECTURE.md §3.4 / §5.3.
 * One lazy boundary at /doctor/notifications; the inbox/messages tab,
 * filters, and the open conversation live in query params.
 */
export const notificationsRoutes: readonly RouteObject[] = [
  {
    path: routes.doctor.notifications,
    handle: { titleKey: 'nav.notifications' } satisfies RouteHandle,
    lazy: async () => {
      const { NotificationsPage } = await import('./pages/NotificationsPage');
      return { Component: NotificationsPage };
    },
  },
];
