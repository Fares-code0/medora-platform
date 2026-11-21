import { useState } from 'react';
import type { ReactNode } from 'react';

import { QueryClientProvider } from '@tanstack/react-query';

import { createQueryClient } from '@/configs/query-client';

/**
 * TanStack Query provider — FRONTEND_ARCHITECTURE.md §10.3.
 * The client instance is exposed so the auth feature can call
 * `queryClient.clear()` on logout/lock (PHI must not survive a session).
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
