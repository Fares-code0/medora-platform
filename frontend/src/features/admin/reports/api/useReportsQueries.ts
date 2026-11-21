/**
 * Admin Reports — TanStack Query hooks (ADM-08).
 *
 * The document query is keyed on the report, the range **and** the compare
 * switch, because all three change the numbers the service returns. Keying on
 * the report alone would serve a 7-day Growth tab from a 12-month cache entry
 * the first time somebody moved the range picker.
 *
 * `keepPreviousData` throughout: switching tab or widening the range should
 * dim the charts, not blank them. A dashboard that empties on every control
 * change reads as broken even when it is only loading.
 */

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { logsKeys } from '../../logs/api/useLogsQueries';
import type {
  RangeKey,
  ReportId,
  ScheduleDraft,
  ScheduledReport,
  WidgetDataset,
} from '../reports.types';

import { reportsApi } from './reports.api';

const STALE_MS = 30_000;

export const reportsKeys = {
  all: ['admin', 'reports'] as const,
  document: (reportId: ReportId, range: RangeKey, compare: boolean) =>
    [...reportsKeys.all, 'document', reportId, range, compare] as const,
  schedules: () => [...reportsKeys.all, 'schedules'] as const,
} as const;

export function useReportDocument(reportId: ReportId, range: RangeKey, compare: boolean) {
  return useQuery({
    queryKey: reportsKeys.document(reportId, range, compare),
    queryFn: () => reportsApi.document({ reportId, range, compare }),
    staleTime: STALE_MS,
    placeholderData: keepPreviousData,
  });
}

export function useScheduledReports() {
  return useQuery({
    queryKey: reportsKeys.schedules(),
    queryFn: reportsApi.schedules,
    staleTime: STALE_MS,
  });
}

export function useReportMutations() {
  const queryClient = useQueryClient();

  /**
   * Seeds the cache with the list the service returned rather than
   * invalidating it. Every schedule mutation returns the whole collection —
   * the house pattern since Phase B — so a refetch would ask for something
   * already in hand.
   */
  const settle = (schedules: readonly ScheduledReport[]) => {
    queryClient.setQueryData(reportsKeys.schedules(), schedules);
  };

  /**
   * Both exports append a `data-export` row to the system log before writing
   * their file, so ADM-07's table is stale the moment either lands. Dropping
   * its cache here is what makes the export show up in the log without the
   * reader having to reload — the same wiring `useLogMutations` does for the
   * log's own export.
   */
  const invalidateLogs = () => {
    void queryClient.invalidateQueries({ queryKey: logsKeys.all });
  };

  const createSchedule = useMutation({
    mutationFn: (input: { draft: ScheduleDraft; actor: string }) =>
      reportsApi.createSchedule(input.draft, input.actor),
    onSuccess: settle,
  });

  const setPaused = useMutation({
    mutationFn: (input: { id: string; paused: boolean }) =>
      reportsApi.setSchedulePaused(input.id, input.paused),
    onSuccess: settle,
  });

  const deleteSchedule = useMutation({
    mutationFn: (id: string) => reportsApi.deleteSchedule(id),
    onSuccess: settle,
  });

  const exportWidget = useMutation({
    mutationFn: (input: {
      reportId: ReportId;
      range: RangeKey;
      title: string;
      dataset: WidgetDataset;
      actor: string;
    }) => reportsApi.exportWidget(input),
    onSuccess: invalidateLogs,
  });

  const exportDeck = useMutation({
    mutationFn: (input: { reportId: ReportId; range: RangeKey; compare: boolean; actor: string }) =>
      reportsApi.exportDeck(input),
    onSuccess: invalidateLogs,
  });

  return { createSchedule, setPaused, deleteSchedule, exportWidget, exportDeck };
}
