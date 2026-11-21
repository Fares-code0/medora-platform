import { useCallback, useMemo } from 'react';

import { useSearchParams } from 'react-router-dom';

import type { SortState } from '@/components/ui';
import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from '@/constants';

import { isValidDateKey, type MedicalRecordListFilters } from '../model/filters';
import { isRecordSortColumn } from '../model/selectors';
import {
  DIAGNOSES,
  RECORD_DEPARTMENTS,
  RECORD_PRIORITIES,
  RECORD_STATUSES,
  RECORD_VISIT_TYPES,
  type MedicalRecordPriority,
  type MedicalRecordStatus,
} from '../model/types';

/**
 * URL-owned list state for /doctor/medical-records
 * (?q=&status=&diagnosis=&department=&doctor=&from=&to=&visitType=
 * &priority=&patient=&sort=&page=&pageSize=). Every param validates on
 * read (invalid → default); filter changes reset pagination. `patient`
 * is the Patient Profile deep-link filter.
 */

const FILTER_KEYS = [
  'status',
  'diagnosis',
  'department',
  'doctor',
  'from',
  'to',
  'visitType',
  'priority',
  'patient',
] as const satisfies readonly (keyof MedicalRecordListFilters)[];

export type MedicalRecordFilterKey = (typeof FILTER_KEYS)[number];

const DIAGNOSIS_LABELS: readonly string[] = DIAGNOSES.map((diagnosis) => diagnosis.label);

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
  if (!columnId || !isRecordSortColumn(columnId)) return null;
  if (direction !== 'asc' && direction !== 'desc') return null;
  return { columnId, direction };
}

export function useMedicalRecordListState() {
  const [searchParams, setSearchParams] = useSearchParams();

  const state = useMemo(() => {
    const pageRaw = Number(searchParams.get('page'));
    const pageSizeRaw = Number(searchParams.get('pageSize'));
    return {
      q: searchParams.get('q') ?? '',
      filters: {
        status: readEnum<MedicalRecordStatus>(searchParams, 'status', RECORD_STATUSES),
        diagnosis: readEnum(searchParams, 'diagnosis', DIAGNOSIS_LABELS),
        department: readEnum(searchParams, 'department', RECORD_DEPARTMENTS),
        // Any doctor the rows may name; the drawer offers only those it finds.
        doctor: readText(searchParams, 'doctor'),
        from: readDate(searchParams, 'from'),
        to: readDate(searchParams, 'to'),
        visitType: readEnum(searchParams, 'visitType', RECORD_VISIT_TYPES),
        priority: readEnum<MedicalRecordPriority>(searchParams, 'priority', RECORD_PRIORITIES),
        patient: readPatient(searchParams),
      } satisfies MedicalRecordListFilters,
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
    <K extends MedicalRecordFilterKey>(key: K, value: MedicalRecordListFilters[K] | null) =>
      update((params) => {
        if (value === null || value === '') params.delete(key);
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
        setFilter(id as MedicalRecordFilterKey, null);
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
