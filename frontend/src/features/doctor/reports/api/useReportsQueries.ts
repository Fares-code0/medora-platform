import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createKeyFactory } from '@/api/query-keys';
import { useAuth } from '@/app/providers';

import type {
  CreateSavedReportInput,
  RenameSavedReportInput,
  ScheduleInput,
} from '../model/reports-service';
import type { ExportFormat, ReportFilters, ReportsDocument } from '../model/types';
import { reportsService } from '../service';

/**
 * Reports data layer — TanStack Query over the reports seam. Analytics are
 * keyed by the full filter set (so switching category/range/filters refetches
 * a fresh snapshot and caches it); the saved/scheduled document is keyed per
 * user and every mutation writes the returned document straight into the
 * cache (no refetch, StrictMode-safe).
 */

export const reportsKeys = createKeyFactory('doctor-reports');

const ANALYTICS_KEY = (filters: ReportFilters) =>
  [...reportsKeys.all, 'analytics', filters] as const;
const DOCUMENT_KEY = (userId: string) => [...reportsKeys.all, 'document', userId] as const;

function useUserId(): string {
  const { user } = useAuth();
  return user?.id ?? 'anonymous';
}

export function useAnalyticsQuery(filters: ReportFilters) {
  return useQuery({
    queryKey: ANALYTICS_KEY(filters),
    queryFn: () => reportsService.fetchAnalytics(filters),
    staleTime: 60_000,
  });
}

export function useReportsDocumentQuery() {
  const userId = useUserId();
  return useQuery({
    queryKey: DOCUMENT_KEY(userId),
    queryFn: () => reportsService.fetchReportsDocument(userId),
    staleTime: 30_000,
  });
}

function useDocumentMutation<TInput>(
  mutationFn: (userId: string, input: TInput) => Promise<ReportsDocument>,
) {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TInput) => mutationFn(userId, input),
    onSuccess: (document) => {
      queryClient.setQueryData(DOCUMENT_KEY(userId), document);
    },
  });
}

export function useCreateSavedReportMutation() {
  return useDocumentMutation((userId, input: CreateSavedReportInput) =>
    reportsService.createSavedReport(userId, input),
  );
}

export function useRenameSavedReportMutation() {
  return useDocumentMutation((userId, input: RenameSavedReportInput) =>
    reportsService.renameSavedReport(userId, input),
  );
}

export function useDuplicateSavedReportMutation() {
  return useDocumentMutation((userId, id: string) =>
    reportsService.duplicateSavedReport(userId, id),
  );
}

export function useDeleteSavedReportMutation() {
  return useDocumentMutation((userId, id: string) => reportsService.deleteSavedReport(userId, id));
}

export function useToggleFavoriteMutation() {
  return useDocumentMutation((userId, id: string) => reportsService.toggleFavorite(userId, id));
}

export function useTouchSavedReportMutation() {
  return useDocumentMutation((userId, id: string) => reportsService.touchSavedReport(userId, id));
}

export function useCreateScheduleMutation() {
  return useDocumentMutation((userId, input: ScheduleInput) =>
    reportsService.createSchedule(userId, input),
  );
}

export function useToggleScheduleStatusMutation() {
  return useDocumentMutation((userId, id: string) =>
    reportsService.toggleScheduleStatus(userId, id),
  );
}

export function useDeleteScheduleMutation() {
  return useDocumentMutation((userId, id: string) => reportsService.deleteSchedule(userId, id));
}

export function useExportMutation() {
  return useMutation({
    mutationFn: (format: ExportFormat) => reportsService.runExport(format),
  });
}
