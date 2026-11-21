import { useCallback, useMemo } from 'react';

import { useSearchParams } from 'react-router-dom';

import type { SortState } from '@/components/ui';
import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from '@/constants';

import {
  LAB_FLAG_FILTERS,
  LAB_REVIEW_FILTERS,
  isValidDateKey,
  type LabFlagFilter,
  type LabListFilters,
  type LabReviewFilter,
} from '../model/filters';
import { isLabSortColumn } from '../model/selectors';
import {
  LAB_CATEGORIES,
  LAB_DEPARTMENTS,
  LAB_PRIORITIES,
  LAB_STATUSES,
  type LabPriority,
  type LabTestCategory,
  type LabTestStatus,
} from '../model/types';

/**
 * URL-owned list state for /doctor/labs
 * (?tab=&q=&status=&category=&priority=&department=&doctor=&from=&to=
 * &flag=&review=&patient=&sort=&page=&pageSize=). Every param validates on
 * read (invalid → default); filter and tab changes reset pagination.
 * `patient` is the Patient Profile / Medical Records deep-link filter.
 *
 * **The tab's default is conditional, and deliberately so** (D-10). The
 * Inbox is the doctor's own queue, so it is what `/doctor/labs` opens on.
 * But four other screens link here with `?patient=<id>` meaning "show me
 * this patient's results", and landing them on an Inbox that hides
 * everything already reviewed would answer a different question — and look
 * like a bug, since a patient with nothing outstanding would come up empty.
 * A deep link carrying a patient therefore defaults to All results. An
 * explicit `?tab=` always wins over both.
 */

/** Every filter key, all of them string-valued. */
const STRING_FILTER_KEYS = [
  'status',
  'category',
  'priority',
  'department',
  'doctor',
  'from',
  'to',
  'flag',
  'review',
  'patient',
] as const satisfies readonly (keyof LabListFilters)[];

/**
 * All keys the FilterBar chips can remove. Every filter is a string param
 * now that `critical` has become one of `flag`'s three values, so this is
 * the same list — kept as its own name because "what clears" and "what is
 * a string" are two ideas that have already drifted apart once.
 */
const ALL_FILTER_KEYS = STRING_FILTER_KEYS;

export type LabStringFilterKey = (typeof STRING_FILTER_KEYS)[number];

/** D-10's two tabs. */
export type LabTab = 'inbox' | 'all';

const LAB_TABS: readonly LabTab[] = ['inbox', 'all'];

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

/**
 * `?critical=1` predates the three-valued `flag` filter and is still in
 * browser histories. Reading it as `flag=critical` keeps those links working
 * without keeping a second control on screen for the same idea.
 */
function readFlag(params: URLSearchParams): LabFlagFilter | null {
  const explicit = readEnum<LabFlagFilter>(params, 'flag', LAB_FLAG_FILTERS);
  if (explicit !== null) return explicit;
  return params.get('critical') === '1' ? 'critical' : null;
}

function readSort(params: URLSearchParams): SortState | null {
  const raw = params.get('sort');
  if (raw === null) return null;
  const [columnId, direction] = raw.split('.');
  if (!columnId || !isLabSortColumn(columnId)) return null;
  if (direction !== 'asc' && direction !== 'desc') return null;
  return { columnId, direction };
}

export function useLabListState() {
  const [searchParams, setSearchParams] = useSearchParams();

  const state = useMemo(() => {
    const pageRaw = Number(searchParams.get('page'));
    const pageSizeRaw = Number(searchParams.get('pageSize'));
    const patient = readPatient(searchParams);
    return {
      tab: readEnum<LabTab>(searchParams, 'tab', LAB_TABS) ?? (patient === null ? 'inbox' : 'all'),
      q: searchParams.get('q') ?? '',
      filters: {
        status: readEnum<LabTestStatus>(searchParams, 'status', LAB_STATUSES),
        category: readEnum<LabTestCategory>(searchParams, 'category', LAB_CATEGORIES),
        priority: readEnum<LabPriority>(searchParams, 'priority', LAB_PRIORITIES),
        department: readEnum(searchParams, 'department', LAB_DEPARTMENTS),
        // Any doctor the rows may name; the drawer offers only those it finds.
        doctor: readText(searchParams, 'doctor'),
        from: readDate(searchParams, 'from'),
        to: readDate(searchParams, 'to'),
        flag: readFlag(searchParams),
        review: readEnum<LabReviewFilter>(searchParams, 'review', LAB_REVIEW_FILTERS),
        patient,
      } satisfies LabListFilters,
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
    <K extends LabStringFilterKey>(key: K, value: LabListFilters[K] | null) =>
      update((params) => {
        if (value === null || value === '') params.delete(key);
        else params.set(key, value);
        params.delete('page');
      }),
    [update],
  );

  /*
   * The tab is always written explicitly, Inbox included, so a doctor who
   * chose Inbox on a patient deep link keeps it on reload rather than being
   * bounced back to All results by the conditional default. `critical` is
   * dropped at the same time: it is the legacy alias for `flag`, and leaving
   * it in the URL beside a tab change would resurrect a filter the reader
   * cleared.
   */
  const setTab = useCallback(
    (tab: LabTab) =>
      update((params) => {
        params.set('tab', tab);
        params.delete('critical');
        params.delete('page');
      }),
    [update],
  );

  /**
   * D-12's chip action, as ONE url update rather than three setter calls.
   *
   * It has to be atomic: `setSearchParams`'s functional form reads the
   * router's current params, not a queued value, so three calls inside one
   * handler all start from the same state and the last one wins — which is
   * how "Show them" originally set `review=unreviewed` and silently dropped
   * the tab and the flag it was supposed to set with it.
   */
  const showCriticalUnreviewed = useCallback(
    () =>
      update((params) => {
        params.set('tab', 'all');
        params.set('flag', 'critical');
        params.set('review', 'unreviewed');
        params.delete('critical');
        params.delete('page');
      }),
    [update],
  );

  const clearFilters = useCallback(
    () =>
      update((params) => {
        ALL_FILTER_KEYS.forEach((key) => params.delete(key));
        params.delete('critical');
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
      if ((STRING_FILTER_KEYS as readonly string[]).includes(id)) {
        setFilter(id as LabStringFilterKey, null);
        // The legacy alias has to go with it, or removing the Flag chip
        // would leave `?critical=1` behind and the filter would reappear.
        if (id === 'flag') update((params) => params.delete('critical'));
      }
    },
    [setFilter, update],
  );

  const hasActiveFilters = STRING_FILTER_KEYS.some((key) => state.filters[key] !== null);

  return {
    ...state,
    hasActiveFilters,
    setTab,
    showCriticalUnreviewed,
    setQuery,
    setFilter,
    removeFilter,
    clearFilters,
    setSort,
    setPage,
    setPageSize,
  } as const;
}
