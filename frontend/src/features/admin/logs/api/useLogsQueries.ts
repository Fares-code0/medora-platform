/**
 * System Logs — TanStack Query hooks (ADM-07).
 *
 * The page query is keyed on the filters, the sort and the page, because the
 * service pages server-side: a new page is a new request, not a slice of
 * something already in the cache. `placeholderData: keepPreviousData` keeps
 * the previous page on screen while the next loads, so paging through an
 * investigation does not blank the table on every click.
 */

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { LogFilters, SortOrder } from '../logs.types';

import { logsApi } from './logs.api';

const STALE_MS = 30_000;

export const logsKeys = {
  all: ['admin', 'logs'] as const,
  page: (filters: LogFilters, sort: SortOrder, offset: number, limit: number) =>
    [...logsKeys.all, 'page', filters, sort, offset, limit] as const,
  actors: () => [...logsKeys.all, 'actors'] as const,
  views: () => [...logsKeys.all, 'views'] as const,
} as const;

/**
 * The actor filter's options. Kept off the page query deliberately: the names
 * do not change when the filters do, so a filter change must not send the
 * picker back to a loading state while the reader is using it.
 */
export function useLogActors() {
  return useQuery({ queryKey: logsKeys.actors(), queryFn: logsApi.actors, staleTime: STALE_MS });
}

export function useLogPage(filters: LogFilters, sort: SortOrder, offset: number, limit: number) {
  return useQuery({
    queryKey: logsKeys.page(filters, sort, offset, limit),
    queryFn: () => logsApi.list({ filters, sort, offset, limit }),
    staleTime: STALE_MS,
    placeholderData: keepPreviousData,
  });
}

export function useSavedViews() {
  return useQuery({ queryKey: logsKeys.views(), queryFn: logsApi.savedViews, staleTime: STALE_MS });
}

export function useLogMutations() {
  const queryClient = useQueryClient();
  const invalidateViews = () => {
    void queryClient.invalidateQueries({ queryKey: logsKeys.views() });
  };

  const createView = useMutation({
    mutationFn: (input: { name: string; filters: LogFilters }) =>
      logsApi.createView(input.name, input.filters),
    onSuccess: invalidateViews,
  });

  const deleteView = useMutation({
    mutationFn: (id: string) => logsApi.deleteView(id),
    onSuccess: invalidateViews,
  });

  const exportEvents = useMutation({
    mutationFn: (input: { format: 'csv' | 'json'; filters: LogFilters; actor: string }) =>
      logsApi.exportEvents(input.format, input.filters, input.actor),
    // The export writes an event, so the page it came from is now stale.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: logsKeys.all });
    },
  });

  return { createView, deleteView, exportEvents };
}
