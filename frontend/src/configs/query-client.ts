import { QueryClient } from '@tanstack/react-query';

import { isApiError } from '@/types/api';

/**
 * TanStack Query defaults — FRONTEND_ARCHITECTURE.md §10.3.
 * Per-domain tuning (polling intervals, staleTime overrides) happens in
 * feature query hooks, never here.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: true, // multi-tab clinical reality
        retry: (failureCount, error) => {
          // Retry transient network failures only; 4xx are never retried.
          if (isApiError(error) && error.kind !== 'network') return false;
          return failureCount < 2;
        },
      },
      mutations: {
        retry: 0,
      },
    },
  });
}
