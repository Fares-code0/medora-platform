import type { RouteObject } from 'react-router-dom';

import type { RouteHandle } from '@/layouts';
import { routes } from '@/routes';

/**
 * AI assistant feature routes — FRONTEND_ARCHITECTURE.md §3.4 / §5.3.
 * One lazy boundary at /doctor/ai; conversation and context state live in
 * query params (?c=…, ?context=…), so no child routes are needed.
 */
export const aiRoutes: readonly RouteObject[] = [
  {
    path: routes.doctor.assistant,
    handle: { crumb: 'Medora AI' } satisfies RouteHandle,
    lazy: async () => {
      const { AiAssistantPage } = await import('./pages/AiAssistantPage');
      return { Component: AiAssistantPage };
    },
  },
];
