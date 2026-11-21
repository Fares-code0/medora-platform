import { useCallback } from 'react';

import { useQuery, useQueryClient } from '@tanstack/react-query';

import { createKeyFactory } from '@/api/query-keys';

import { RECORD_NOT_FOUND } from '../model/record-service';
import { recordService } from '../service';

import { medicalRecordKeys } from './keys';

/**
 * Medical-records data layer — TanStack Query over the feature's seam
 * (`service.ts`). Nothing here imports an adapter directly.
 *
 * The reads live here; the authoring writes live in `useRecordMutations.ts`.
 */

export { medicalRecordKeys };

export { RECORD_NOT_FOUND };

/**
 * `enabled` exists for the global search index (D-26), which spans five
 * feature datasets and must not fetch any of them until someone actually
 * uses the field. Defaults to true, so every existing caller is unchanged.
 */
export function useMedicalRecordsQuery(options?: { readonly enabled?: boolean }) {
  return useQuery({
    queryKey: medicalRecordKeys.lists(),
    queryFn: () => recordService.listRecords(),
    staleTime: 30_000,
    enabled: options?.enabled ?? true,
  });
}

/**
 * The full document on demand, through the detail cache — for an action
 * taken from a list row (print, export), where the row holds only the
 * summary the list endpoint serves (API §6.1).
 */
export function useRecordLoader() {
  const queryClient = useQueryClient();
  return useCallback(
    (recordId: string) =>
      queryClient.fetchQuery({
        queryKey: medicalRecordKeys.detail(recordId),
        queryFn: () => recordService.getRecord(recordId),
        staleTime: 30_000,
      }),
    [queryClient],
  );
}

/** The record's version history (API §6.8); refetched after every edit. */
export function useRecordVersionsQuery(recordId: string) {
  return useQuery({
    queryKey: [...medicalRecordKeys.detail(recordId), 'versions'] as const,
    queryFn: () => recordService.listVersions(recordId),
    staleTime: 30_000,
  });
}

export function useMedicalRecordQuery(recordId: string) {
  return useQuery({
    queryKey: medicalRecordKeys.detail(recordId),
    queryFn: () => recordService.getRecord(recordId),
    staleTime: 30_000,
    retry: (failureCount, error) =>
      error instanceof Error && error.message === RECORD_NOT_FOUND ? false : failureCount < 2,
  });
}

/** Drafts in progress, so the list can offer to resume one (D-21). */
export const recordDraftKeys = createKeyFactory('doctor-medical-record-drafts');

export function useRecordDraftsQuery() {
  return useQuery({
    queryKey: recordDraftKeys.lists(),
    queryFn: () => recordService.listDrafts(),
    staleTime: 5_000,
  });
}
