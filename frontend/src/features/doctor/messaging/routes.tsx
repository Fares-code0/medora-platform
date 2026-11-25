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

const lazyNewMessagePage = async () => {
  const { NewMessagePage } = await import('./pages/NewMessagePage');
  return { Component: NewMessagePage };
};

export const messagingRoutes: readonly RouteObject[] = [
  {
    path: routes.doctor.messages,
    handle: { titleKey: 'nav.messages' } satisfies RouteHandle,
    lazy: lazyPage,
  },
  // Static segment, declared before `:conversationId` so "new" is never
  // read as a conversation id (react-router ranks it first regardless).
  {
    path: routes.doctor.newMessage,
    handle: { titleKey: 'route.newMessage' } satisfies RouteHandle,
    lazy: lazyNewMessagePage,
  },
  {
    path: `${routes.doctor.messages}/:conversationId`,
    handle: { titleKey: 'nav.messages' } satisfies RouteHandle,
    lazy: lazyPage,
  },
];
