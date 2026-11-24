import { type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';

import { createKeyFactory } from '@/api/query-keys';
import { isApiError } from '@/types/api';

import { LAB_NOT_FOUND } from '../model/lab-service';
import type { LabTest } from '../model/types';
import { labService } from '../service';

/**
 * Laboratory data layer — TanStack Query over the feature's seam
 * (`service.ts`). Nothing here imports an adapter directly.
 *
 * The reads live here; the review writes live in `useLabReviewMutations.ts`.
 */

export const labKeys = createKeyFactory('doctor-labs');

export { LAB_NOT_FOUND };

/**
 * `enabled` exists for the global search index (D-26), which spans five
 * feature datasets and must not fetch any of them until someone actually
 * uses the field. Defaults to true, so every existing caller is unchanged.
 *
 * `refetchOnWindowFocus` lets that same index opt its observer out of the
 * focus refetch: over HTTP this read is one GET per order, and the shell
 * mounts the index on every doctor page. Observers that leave it unset keep
 * the global default.
 */
export function useLabTestsQuery(options?: {
  readonly enabled?: boolean;
  readonly refetchOnWindowFocus?: boolean;
}) {
  const query = useQuery({
    queryKey: labKeys.lists(),
    queryFn: ({ signal }) => labService.listLabTests({ signal }),
    staleTime: 30_000,
    enabled: options?.enabled ?? true,
    ...(options?.refetchOnWindowFocus === undefined
      ? {}
      : { refetchOnWindowFocus: options.refetchOnWindowFocus }),
  });
  /*
   * MED-SEC-014 review — fail closed. TanStack keeps the last good `data`
   * when a refetch fails, so a worklist the server has just refused (403,
   * say, after access was withdrawn) would go on feeding its patients to the
   * counts, the filter chips and the global search. A list whose latest read
   * failed exposes nothing: its readers see the error and no rows.
   */
  return query.isError ? { ...query, data: undefined } : query;
}

/**
 * The worklist read already holds one full order per row (the adapter
 * fetches each detail), so opening an order from the list starts from that
 * row instead of repeating the same GET.
 *
 * Pulled from the list's committed cache entry, never pushed from its
 * queryFn: a push would still run for a read that resolved after
 * `queryClient.clear()` (sign-out, lock) and recreate the previous
 * session's orders, or land after a review mutation and overwrite the
 * reviewed order with an older snapshot. A detail entry that already
 * exists (a mutation's `setQueryData`) always wins over `initialData`.
 *
 * Only a list whose latest read succeeded and has not been invalidated is
 * used — a refused or stale worklist must not feed the detail page (the
 * MED-SEC-014 fail-closed rule above), and its age carries over through
 * `initialDataUpdatedAt`, so `staleTime` still triggers a refetch.
 */
function worklistRow(queryClient: QueryClient, labId: string) {
  const state = queryClient.getQueryState<readonly LabTest[]>(labKeys.lists());
  if (state?.status !== 'success' || state.isInvalidated) return undefined;
  const row = state.data?.find((test) => test.id === labId);
  return row ? { row, updatedAt: state.dataUpdatedAt } : undefined;
}

export function useLabTestQuery(labId: string) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: labKeys.detail(labId),
    queryFn: () => labService.getLabTest(labId),
    initialData: () => worklistRow(queryClient, labId)?.row,
    initialDataUpdatedAt: () => worklistRow(queryClient, labId)?.updatedAt,
    staleTime: 30_000,
    // The global rule first (configs/query-client.ts): only a network failure
    // is retried, so a 403 or 500 is not re-sent twice behind a spinner.
    retry: (failureCount, error) => {
      if (isApiError(error) && error.kind !== 'network') return false;
      return error.message === LAB_NOT_FOUND ? false : failureCount < 2;
    },
  });
}

/**
 * One patient's trends for the selected analytes (API §8.8). Keyed on the
 * selection in its order, because series colours are assigned by index.
 */
export function useLabTrendsQuery(
  patientId: string,
  analytes: readonly string[],
  options?: { readonly enabled?: boolean },
) {
  return useQuery({
    queryKey: [...labKeys.all, 'trends', patientId, ...analytes] as const,
    queryFn: () => labService.getTrends(patientId, analytes),
    staleTime: 30_000,
    enabled: (options?.enabled ?? true) && analytes.length > 0,
  });
}

/** The orderable tests (API §8.1). */
export function useLabCatalogueQuery() {
  return useQuery({
    queryKey: [...labKeys.all, 'catalogue'] as const,
    queryFn: () => labService.listCatalogue(),
    staleTime: 5 * 60_000,
  });
}
