import { useQuery } from '@tanstack/react-query';

import { usePagedQuery, type PagedQuery } from '@/api/paged';
import { createKeyFactory } from '@/api/query-keys';

import type { DoctorSearchParams, PatientSafeDoctor } from './model/types';
import { doctorService } from './service';

/**
 * The doctors feature's query surface.
 *
 * Screens call these; they never call `doctorService` and never call
 * `apiClient` (docs/ARCHITECTURE.md §3). That is what makes the
 * fixture -> HTTP swap a one-line change in `service.ts`.
 */
export const doctorKeys = createKeyFactory('doctors');
export const specialtyKeys = createKeyFactory('specialties');
export const departmentKeys = createKeyFactory('departments');

/**
 * What a doctor search returns to a screen.
 *
 * The mechanism moved to `api/paged.ts` when appointments needed the
 * same one; this alias is what keeps the name the screens already use.
 * `pagination.test.tsx` was not edited in that move and is the proof
 * that nothing about the behaviour changed.
 */
export type DoctorSearchQuery = PagedQuery<PatientSafeDoctor>;

/**
 * Doctor search, one page at a time — checklist G-02.
 *
 * `page` is not accepted from the caller. The query owns it — passing
 * one in would put two authorities on the same value and make the cache
 * key disagree with what was actually fetched.
 */
export function useDoctorSearch(params: Omit<DoctorSearchParams, 'page'>): DoctorSearchQuery {
  return usePagedQuery({
    queryKey: doctorKeys.list(params as Record<string, unknown>),
    queryFn: (page) => doctorService.search({ ...params, page }),
  });
}

export function useDoctor(id: string) {
  return useQuery({
    queryKey: doctorKeys.detail(id),
    queryFn: () => doctorService.getById(id),
  });
}

export function useSpecialties() {
  return useQuery({
    queryKey: specialtyKeys.lists(),
    queryFn: () => doctorService.listSpecialties(),
    // Non-PHI reference data that changes on the order of months.
    staleTime: 60 * 60_000,
  });
}

export function useDepartments() {
  return useQuery({
    queryKey: departmentKeys.lists(),
    queryFn: () => doctorService.listDepartments(),
    staleTime: 60 * 60_000,
  });
}
