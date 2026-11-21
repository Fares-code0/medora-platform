import { useCallback, useMemo } from 'react';

import { useSearchParams } from 'react-router-dom';

import {
  DATE_RANGES,
  REPORT_CATEGORIES,
  isReportCategory,
  type AgeBand,
  type DateRangeKey,
  type Gender,
  type ReportCategory,
  type ReportFilters,
} from '../model/types';
import { reportsService } from '../service';

/**
 * URL-owned filter state for /doctor/reports
 * (?category=&range=&from=&to=&doctor=&department=&patient=&status=
 * &medication=&labTest=&age=&gender=). Every param validates on read
 * (invalid → default), so the dashboard is fully shareable and
 * back/forward restores the exact analytics view.
 */

const RANGE_KEYS = DATE_RANGES.map((range) => range.id);
const AGE_BANDS: readonly AgeBand[] = ['all', '0-17', '18-39', '40-64', '65+'];
const GENDERS: readonly Gender[] = ['all', 'female', 'male'];

/** The string-valued advanced filters (default 'all'). Patient/Doctor are
 * intentionally excluded — a doctor only sees their own analytics. */
export const ADVANCED_KEYS = ['department', 'status', 'medication', 'labTest'] as const;

export type AdvancedKey = (typeof ADVANCED_KEYS)[number];

function readEnum<T extends string>(
  params: URLSearchParams,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const raw = params.get(key);
  return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

export function useReportFilters() {
  const [searchParams, setSearchParams] = useSearchParams();

  const filters = useMemo<ReportFilters>(() => {
    const str = (key: string) => searchParams.get(key) ?? 'all';
    return {
      category: readEnum<ReportCategory>(
        searchParams,
        'category',
        REPORT_CATEGORIES.map((c) => c.id),
        'overview',
      ),
      range: readEnum<DateRangeKey>(searchParams, 'range', RANGE_KEYS, 'month'),
      customFrom: searchParams.get('from'),
      customTo: searchParams.get('to'),
      department: str('department'),
      status: str('status'),
      medication: str('medication'),
      labTest: str('labTest'),
      age: readEnum<AgeBand>(searchParams, 'age', AGE_BANDS, 'all'),
      gender: readEnum<Gender>(searchParams, 'gender', GENDERS, 'all'),
    };
  }, [searchParams]);

  const update = useCallback(
    (mutate: (params: URLSearchParams) => void, replace = true) => {
      setSearchParams(
        (previous) => {
          const next = new URLSearchParams(previous);
          mutate(next);
          return next;
        },
        { replace },
      );
    },
    [setSearchParams],
  );

  const setCategory = useCallback(
    (category: ReportCategory) =>
      update((params) => {
        if (category === 'overview') params.delete('category');
        else params.set('category', category);
      }),
    [update],
  );

  const setRange = useCallback(
    (range: DateRangeKey) =>
      update((params) => {
        if (range === 'month') params.delete('range');
        else params.set('range', range);
        if (range !== 'custom') {
          params.delete('from');
          params.delete('to');
        }
      }),
    [update],
  );

  const setCustomRange = useCallback(
    (from: string | null, to: string | null) =>
      update((params) => {
        params.set('range', 'custom');
        if (from) params.set('from', from);
        else params.delete('from');
        if (to) params.set('to', to);
        else params.delete('to');
      }),
    [update],
  );

  const setFilter = useCallback(
    (key: keyof ReportFilters, value: string) =>
      update((params) => {
        if (value === 'all' || value === '') params.delete(key);
        else params.set(key, value);
      }),
    [update],
  );

  const clearAdvanced = useCallback(
    () =>
      update((params) => {
        [...ADVANCED_KEYS, 'age', 'gender'].forEach((key) => params.delete(key));
      }),
    [update],
  );

  /** Restore a full filter set (e.g. applying a saved report). */
  const applyFilters = useCallback(
    (next: ReportFilters) =>
      update((params) => {
        const setOrDelete = (key: string, value: string, def: string) => {
          if (value === def) params.delete(key);
          else params.set(key, value);
        };
        setOrDelete('category', next.category, 'overview');
        setOrDelete('range', next.range, 'month');
        setOrDelete('department', next.department, 'all');
        setOrDelete('status', next.status, 'all');
        setOrDelete('medication', next.medication, 'all');
        setOrDelete('labTest', next.labTest, 'all');
        setOrDelete('age', next.age, 'all');
        setOrDelete('gender', next.gender, 'all');
        if (next.range === 'custom' && next.customFrom) params.set('from', next.customFrom);
        else params.delete('from');
        if (next.range === 'custom' && next.customTo) params.set('to', next.customTo);
        else params.delete('to');
      }),
    [update],
  );

  // Only the filters the source applies count: a department in the URL that
  // the server ignores is not an active filter (`capabilities.advancedFilters`).
  const activeAdvancedCount = useMemo(() => {
    let count = 0;
    reportsService.capabilities.advancedFilters.forEach((key) => {
      if ((filters[key] ?? 'all') !== 'all') count += 1;
    });
    return count;
  }, [filters]);

  return {
    filters,
    setCategory,
    setRange,
    setCustomRange,
    setFilter,
    clearAdvanced,
    applyFilters,
    activeAdvancedCount,
  } as const;
}

/** Guard reused by the page and saved-report links. */
export { isReportCategory };
