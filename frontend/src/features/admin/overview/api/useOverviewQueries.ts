/**
 * Admin Overview — TanStack Query hooks (ADM-01).
 *
 * Two queries, and only two: the page's actionable numbers come from the
 * ADM-02/04/05 documents already in the cache, not from here. The active-user
 * count is the single polled value on the page — it is the only figure §3.1
 * calls live.
 */

import { keepPreviousData, useQuery } from '@tanstack/react-query';

import type { ActivityRange } from '../overview.types';

import { overviewApi } from './overview.api';

const STALE_MS = 30_000;
export const ACTIVE_USERS_POLL_MS = 15_000;

export const overviewKeys = {
  all: ['admin', 'overview'] as const,
  signals: (range: ActivityRange) => [...overviewKeys.all, 'signals', range] as const,
  activeUsers: () => [...overviewKeys.all, 'active-users'] as const,
} as const;

export function useOverviewSignals(range: ActivityRange) {
  return useQuery({
    queryKey: overviewKeys.signals(range),
    queryFn: () => overviewApi.signals(range),
    staleTime: STALE_MS,
    /*
     * The range is part of the key, so without this every switch is a cache
     * miss and the chart blanks to a skeleton for the length of the fetch.
     * §3.1 lists the range switch as an ordinary chart interaction, not a
     * reload: keeping the previous series on screen re-plots the chart in
     * place instead of tearing the widget down and rebuilding it.
     */
    placeholderData: keepPreviousData,
  });
}

export function useActiveUsers() {
  return useQuery({
    queryKey: overviewKeys.activeUsers(),
    queryFn: overviewApi.activeUsers,
    refetchInterval: ACTIVE_USERS_POLL_MS,
    staleTime: 0,
  });
}
