import { useCallback, useMemo } from 'react';

import { useSearchParams } from 'react-router-dom';

import type { SortState } from '@/components/ui';
import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from '@/constants';

import { isValidDateKey, type PharmacyListFilters } from '../model/filters';
import { isPrescriptionSortColumn } from '../model/selectors';
import {
  MEDICATION_CATEGORIES,
  PRESCRIPTION_STATUSES,
  REFILL_STATUSES,
  type MedicationCategory,
  type PrescriptionStatus,
  type RefillStatus,
} from '../model/types';

/**
 * URL-owned list state for /doctor/pharmacy
 * (?q=&status=&category=&doctor=&refill=&from=&to=&highRisk=&controlled=
 * &patient=&sort=&page=&pageSize=). Every param validates on read
 * (invalid → default); filter changes reset pagination. `patient` is the
 * cross-feature deep-link filter.
 */

/** String/enum-valued filter keys (everything except the two booleans). */
const STRING_FILTER_KEYS = [
  'status',
  'category',
  'doctor',
  'refillStatus',
  'from',
  'to',
  'patient',
] as const satisfies readonly (keyof PharmacyListFilters)[];

const ALL_FILTER_KEYS = [
  ...STRING_FILTER_KEYS,
  'highRisk',
  'controlled',
] as const satisfies readonly (keyof PharmacyListFilters)[];

export type PharmacyStringFilterKey = (typeof STRING_FILTER_KEYS)[number];

function readText(params: URLSearchParams, key: string): string | null {
  const raw = params.get(key)?.trim() ?? '';
  return raw === '' || raw.length > 120 ? null : raw;
}

function readEnum<T extends string>(
  params: URLSearchParams,
  key: string,
  allowed: readonly T[],
): T | null {
  const raw = params.get(key);
  return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : null;
}

function readDate(params: URLSearchParams, key: string): string | null {
  const raw = params.get(key);
  return raw !== null && isValidDateKey(raw) ? raw : null;
}

function readPatient(params: URLSearchParams): string | null {
  const raw = params.get('patient');
  return raw !== null && raw.trim() !== '' ? raw : null;
}

function readSort(params: URLSearchParams): SortState | null {
  const raw = params.get('sort');
  if (raw === null) return null;
  const [columnId, direction] = raw.split('.');
  if (!columnId || !isPrescriptionSortColumn(columnId)) return null;
  if (direction !== 'asc' && direction !== 'desc') return null;
  return { columnId, direction };
}

export function usePharmacyListState() {
  const [searchParams, setSearchParams] = useSearchParams();

  const state = useMemo(() => {
    const pageRaw = Number(searchParams.get('page'));
    const pageSizeRaw = Number(searchParams.get('pageSize'));
    return {
      q: searchParams.get('q') ?? '',
      filters: {
        status: readEnum<PrescriptionStatus>(searchParams, 'status', PRESCRIPTION_STATUSES),
        category: readEnum<MedicationCategory>(searchParams, 'category', MEDICATION_CATEGORIES),
        // Any doctor the rows may name; the drawer offers only those it finds.
        doctor: readText(searchParams, 'doctor'),
        refillStatus: readEnum<RefillStatus>(searchParams, 'refill', REFILL_STATUSES),
        from: readDate(searchParams, 'from'),
        to: readDate(searchParams, 'to'),
        highRisk: searchParams.get('highRisk') === '1',
        controlled: searchParams.get('controlled') === '1',
        patient: readPatient(searchParams),
      } satisfies PharmacyListFilters,
      sort: readSort(searchParams),
      page: Number.isInteger(pageRaw) && pageRaw >= 1 ? pageRaw : 1,
      pageSize: (PAGE_SIZES as readonly number[]).includes(pageSizeRaw)
        ? pageSizeRaw
        : DEFAULT_PAGE_SIZE,
    };
  }, [searchParams]);

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
        { replace: true },
      ),
    [update],
  );

  const setFilter = useCallback(
    <K extends PharmacyStringFilterKey>(key: K, value: PharmacyListFilters[K] | null) =>
      update((params) => {
        const name = key === 'refillStatus' ? 'refill' : key;
        if (value === null || value === '') params.delete(name);
        else params.set(name, value);
        params.delete('page');
      }),
    [update],
  );

  const setBoolean = useCallback(
    (key: 'highRisk' | 'controlled', value: boolean) =>
      update((params) => {
        if (value) params.set(key, '1');
        else params.delete(key);
        params.delete('page');
      }),
    [update],
  );

  const clearFilters = useCallback(
    () =>
      update((params) => {
        ALL_FILTER_KEYS.forEach((key) => params.delete(key === 'refillStatus' ? 'refill' : key));
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
      if (id === 'highRisk' || id === 'controlled') {
        setBoolean(id, false);
        return;
      }
      if ((STRING_FILTER_KEYS as readonly string[]).includes(id)) {
        setFilter(id as PharmacyStringFilterKey, null);
      }
    },
    [setBoolean, setFilter],
  );

  const hasActiveFilters =
    STRING_FILTER_KEYS.some((key) => state.filters[key] !== null) ||
    state.filters.highRisk ||
    state.filters.controlled;

  return {
    ...state,
    hasActiveFilters,
    setQuery,
    setFilter,
    setBoolean,
    removeFilter,
    clearFilters,
    setSort,
    setPage,
    setPageSize,
  } as const;
}
