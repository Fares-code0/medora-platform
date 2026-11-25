import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { dashboardService } from '../service';

import {
  dashboardKeys,
  OVERVIEW_STALE_TIME_MS,
  useDashboardOverviewQuery,
} from './useDashboardOverviewQuery';

/**
 * The Overview is assembled from two full-list drains (today's appointments
 * and the patient directory). It must not be re-assembled on every tab focus.
 */
describe('useDashboardOverviewQuery options', () => {
  it('does not refetch on window focus, and keeps a short freshness window', () => {
    vi.spyOn(dashboardService, 'getOverview').mockReturnValue(new Promise(() => undefined));
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );

    renderHook(() => useDashboardOverviewQuery(), { wrapper });

    const query = client.getQueryCache().find({ queryKey: dashboardKeys.all, exact: true });
    const options = query?.observers[0]?.options;
    expect(options?.refetchOnWindowFocus).toBe(false);
    expect(options?.staleTime).toBe(OVERVIEW_STALE_TIME_MS);
    // Patient risk writes do not invalidate the Overview, so it must not
    // stay fresh for long (review finding: no multi-minute staleness).
    expect(OVERVIEW_STALE_TIME_MS).toBeLessThanOrEqual(30_000);
  });
});
