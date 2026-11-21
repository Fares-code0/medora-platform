import type { RouteObject } from 'react-router-dom';

import type { RouteHandle } from '@/layouts';
import { routes } from '@/routes';

/**
 * Messaging feature routes — FRONTEND_ARCHITECTURE.md §3.4 / §5.3.
 * One lazy boundary at /doctor/messages; the open thread is the
 * :conversationId param, folder/search live in query params.
 */
const lazyPage = async () => {
  const { MessagesPage } = await import('./pages/MessagesPage');
  return { Component: MessagesPage };
};

export const messagingRoutes: readonly RouteObject[] = [
  {
    path: routes.doctor.messages,
    handle: { crumb: 'Messages' } satisfies RouteHandle,
    lazy: lazyPage,
  },
  {
    path: `${routes.doctor.messages}/:conversationId`,
    handle: { crumb: 'Messages' } satisfies RouteHandle,
    lazy: lazyPage,
  },
];
