import { useCallback, useMemo } from 'react';

import { useSearchParams } from 'react-router-dom';

import type { SortState } from '@/components/ui';
import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from '@/constants';

import { isValidDateKey, todayKey } from '../model/calendar';
import type { AppointmentListFilters } from '../model/filters';
import { isAppointmentSortColumn } from '../model/selectors';
import {
  APPOINTMENT_PRIORITIES,
  APPOINTMENT_STATUSES,
  DEPARTMENTS,
  VISIT_TYPES,
  type AppointmentPriority,
  type AppointmentStatus,
} from '../model/types';

/**
 * URL-owned list state for /doctor/appointments (UX §1.3:
 * ?view=list|day|week|month&date=&status=…). Every param validates on
 * read (invalid → default); filter changes reset pagination. The
 * calendar anchor date and view live here too, so calendar positions
 * are shareable links.
 */

export type AppointmentsView = 'list' | 'day' | 'week' | 'month';

const VIEWS: readonly AppointmentsView[] = ['list', 'day', 'week', 'month'];

const FILTER_KEYS = [
  'status',
  'doctor',
  'department',
  'from',
  'to',
  'visitType',
  'priority',
  'newPatient',
  'followUp',
] as const satisfies readonly (keyof AppointmentListFilters)[];

export type AppointmentFilterKey = (typeof FILTER_KEYS)[number];

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

function readSort(params: URLSearchParams): SortState | null {
  const raw = params.get('sort');
  if (raw === null) return null;
  const [columnId, direction] = raw.split('.');
  if (!columnId || !isAppointmentSortColumn(columnId)) return null;
  if (direction !== 'asc' && direction !== 'desc') return null;
  return { columnId, direction };
}

export function useAppointmentListState() {
  const [searchParams, setSearchParams] = useSearchParams();

  const state = useMemo(() => {
    const pageRaw = Number(searchParams.get('page'));
    const pageSizeRaw = Number(searchParams.get('pageSize'));
    return {
      view: readEnum(searchParams, 'view', VIEWS) ?? 'list',
      date: readDate(searchParams, 'date') ?? todayKey(),
      q: searchParams.get('q') ?? '',
      filters: {
        status: readEnum<AppointmentStatus>(searchParams, 'status', APPOINTMENT_STATUSES),
        // Any doctor the rows may name; the drawer offers only those it finds.
        doctor: readText(searchParams, 'doctor'),
        department: readEnum(searchParams, 'department', DEPARTMENTS),
        from: readDate(searchParams, 'from'),
        to: readDate(searchParams, 'to'),
        visitType: readEnum(searchParams, 'visitType', VISIT_TYPES),
        priority: readEnum<AppointmentPriority>(searchParams, 'priority', APPOINTMENT_PRIORITIES),
        newPatient: searchParams.get('newPatient') === '1',
        followUp: searchParams.get('followUp') === '1',
      } satisfies AppointmentListFilters,
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

  const setView = useCallback(
    (view: AppointmentsView) =>
      update((params) => {
        if (view === 'list') params.delete('view');
        else params.set('view', view);
      }),
    [update],
  );

  const setDate = useCallback(
    (date: string) =>
      update(
        (params) => {
          if (date === todayKey()) params.delete('date');
          else params.set('date', date);
        },
        { replace: true },
      ),
    [update],
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
    <K extends AppointmentFilterKey>(key: K, value: AppointmentListFilters[K] | null) =>
      update((params) => {
        if (value === null || value === false || value === '') params.delete(key);
        else if (value === true) params.set(key, '1');
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
        setFilter(id as AppointmentFilterKey, null);
      }
    },
    [setFilter],
  );

  return {
    ...state,
    hasActiveFilters: FILTER_KEYS.some((key) => {
      const value = state.filters[key];
      return value !== null && value !== false;
    }),
    setView,
    setDate,
    setQuery,
    setFilter,
    removeFilter,
    clearFilters,
    setSort,
    setPage,
    setPageSize,
  } as const;
}
