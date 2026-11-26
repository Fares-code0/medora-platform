import { useQuery } from '@tanstack/react-query';

import { usePagedQuery, type PagedQuery } from '@/api/paged';
import { createKeyFactory } from '@/api/query-keys';

import type { HospitalSummary } from './model/types';
import { hospitalService } from './service';

/** Reference data — hospital names and addresses are not PHI. */
export const hospitalKeys = createKeyFactory('hospitals');

export function useHospitals(q?: string): PagedQuery<HospitalSummary> {
  const trimmed = q?.trim();
  const search = trimmed === undefined || trimmed === '' ? undefined : trimmed;
  return usePagedQuery({
    queryKey: hospitalKeys.list({ q: search }),
    queryFn: (page) =>
      hospitalService.list({ ...(search === undefined ? {} : { q: search }), page }),
  });
}

export function useHospital(id: string) {
  return useQuery({
    queryKey: hospitalKeys.detail(id),
    queryFn: () => hospitalService.getById(id),
    staleTime: 10 * 60_000,
  });
}
