import { useCallback, useMemo } from 'react';

import { useSearchParams } from 'react-router-dom';

import type { SortState } from '@/components/ui';
import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from '@/constants';
import {
  BLOOD_TYPES,
  CHRONIC_CONDITIONS,
  PATIENT_STATUSES,
} from '@/features/shared-domain/patient-identity';

import { type PatientListFilters } from '../model/filters';
import { isPatientSortColumn } from '../model/selectors';

/**
 * URL is the source of truth for list state (FRONTEND_ARCHITECTURE §1.3 /
 * UX 1.3: /doctor/patients?q=&status=&sort=&page=…). This hook owns the
 * param schema: every value is validated on read (invalid → default, never
 * a crash) and written back through one setter API. Changing any filter
 * resets the page to 1.
 */

const FILTER_KEYS = [
  'gender',
  'ageRange',
  'bloodType',
  'status',
  'lastVisit',
  'upcoming',
  'condition',
  'allergy',
] as const satisfies readonly (keyof PatientListFilters)[];

type FilterKey = (typeof FILTER_KEYS)[number];

/** Allowed values per param; anything else falls back to null. */
const ALLOWED: Record<FilterKey, readonly string[]> = {
  gender: ['female', 'male'],
  ageRange: ['0-17', '18-39', '40-64', '65+'],
  bloodType: BLOOD_TYPES,
  status: PATIENT_STATUSES,
  lastVisit: ['7d', '30d', '90d', 'over-1y', 'never'],
  upcoming: ['any', 'none', '7d'],
  condition: CHRONIC_CONDITIONS,
  allergy: ['any', 'none', 'severe'],
};

function readEnum<K extends FilterKey>(
  params: URLSearchParams,
  key: K,
): PatientListFilters[K] | null {
  const raw = params.get(key);
  if (raw === null || !ALLOWED[key].includes(raw)) return null;
  return raw as PatientListFilters[K];
}

function readSort(params: URLSearchParams): SortState | null {
  const raw = params.get('sort');
  if (raw === null) return null;
  const [columnId, direction] = raw.split('.');
  if (!columnId || !isPatientSortColumn(columnId)) return null;
  if (direction !== 'asc' && direction !== 'desc') return null;
  return { columnId, direction };
}

function readPage(params: URLSearchParams): number {
  const parsed = Number(params.get('page'));
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
}

function readPageSize(params: URLSearchParams): number {
  const parsed = Number(params.get('pageSize'));
  return (PAGE_SIZES as readonly number[]).includes(parsed) ? parsed : DEFAULT_PAGE_SIZE;
}

export function usePatientListState() {
  const [searchParams, setSearchParams] = useSearchParams();

  const state = useMemo(
    () => ({
      q: searchParams.get('q') ?? '',
      filters: {
        gender: readEnum(searchParams, 'gender'),
        ageRange: readEnum(searchParams, 'ageRange'),
        bloodType: readEnum(searchParams, 'bloodType'),
        status: readEnum(searchParams, 'status'),
        lastVisit: readEnum(searchParams, 'lastVisit'),
        upcoming: readEnum(searchParams, 'upcoming'),
        condition: readEnum(searchParams, 'condition'),
        allergy: readEnum(searchParams, 'allergy'),
      } satisfies PatientListFilters,
      sort: readSort(searchParams),
      page: readPage(searchParams),
      pageSize: readPageSize(searchParams),
    }),
    [searchParams],
  );

  const update = useCallback(
    (mutate: (params: URLSearchParams) => void, options?: { replace?: boolean }) => {
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          mutate(next);
          return next;
        },
        { replace: options?.replace ?? false },
      );
    },
    [setSearchParams],
  );

  const setQuery = useCallback(
    (q: string) =>
      update(
        (params) => {
          if (q === '') params.delete('q');
          else params.set('q', q);
          params.delete('page');
        },
        // Typing is continuous — don't flood the history stack.
        { replace: true },
      ),
    [update],
  );

  const setFilter = useCallback(
    <K extends FilterKey>(key: K, value: PatientListFilters[K] | null) =>
      update((params) => {
        if (value === null) params.delete(key);
        else params.set(key, value);
        params.delete('page');
      }),
    [update],
  );

  const clearFilters = useCallback(
    () =>
      update((params) => {
        FILTER_KEYS.forEach((key) => params.delete(key));
        params.delete('page');
      }),
    [update],
  );

  const setSort = useCallback(
    (sort: SortState) =>
      update((params) => params.set('sort', `${sort.columnId}.${sort.direction}`), {
        replace: true,
      }),
    [update],
  );

  const setPage = useCallback(
    (page: number) =>
      update((params) => {
        if (page <= 1) params.delete('page');
        else params.set('page', String(page));
      }),
    [update],
  );

  const setPageSize = useCallback(
    (pageSize: number) =>
      update((params) => {
        if (pageSize === DEFAULT_PAGE_SIZE) params.delete('pageSize');
        else params.set('pageSize', String(pageSize));
        params.delete('page');
      }),
    [update],
  );

  const removeFilter = useCallback(
    (id: string) => {
      if ((FILTER_KEYS as readonly string[]).includes(id)) {
        setFilter(id as FilterKey, null);
      }
    },
    [setFilter],
  );

  return {
    ...state,
    hasActiveFilters: FILTER_KEYS.some((key) => state.filters[key] !== null),
    setQuery,
    setFilter,
    removeFilter,
    clearFilters,
    setSort,
    setPage,
    setPageSize,
  } as const;
}
