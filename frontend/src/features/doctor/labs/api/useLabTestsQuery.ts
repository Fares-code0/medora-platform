import { useQuery } from '@tanstack/react-query';

import { createKeyFactory } from '@/api/query-keys';

import { LAB_NOT_FOUND } from '../model/lab-service';
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
 */
export function useLabTestsQuery(options?: { readonly enabled?: boolean }) {
  const query = useQuery({
    queryKey: labKeys.lists(),
    queryFn: () => labService.listLabTests(),
    staleTime: 30_000,
    enabled: options?.enabled ?? true,
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

export function useLabTestQuery(labId: string) {
  return useQuery({
    queryKey: labKeys.detail(labId),
    queryFn: () => labService.getLabTest(labId),
    staleTime: 30_000,
    retry: (failureCount, error) =>
      error instanceof Error && error.message === LAB_NOT_FOUND ? false : failureCount < 2,
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
