import { useCallback, useMemo } from 'react';

import { useSearchParams } from 'react-router-dom';

import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from '@/constants';

import { DEFAULT_STATUS, isValidDateKey, type NotificationListFilters } from '../model/filters';
import { isNotificationSort, type NotificationSort } from '../model/selectors';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_KINDS,
  NOTIFICATION_PRIORITIES,
  NOTIFICATION_STATUS_FILTERS,
  type NotificationCategory,
  type NotificationKind,
  type NotificationPriority,
  type NotificationStatusFilter,
} from '../model/types';

/**
 * URL-owned list state for /doctor/notifications
 * (?tab=&q=&status=&category=&priority=&kind=&from=&to=&sort=&page=
 * &pageSize=&conv=). Every param validates on read (invalid → default);
 * filter changes reset pagination. `tab` switches to the communication
 * center; `conv` deep-links a conversation there.
 */

const FILTER_KEYS = ['status', 'category', 'priority', 'kind', 'from', 'to'] as const;

export type NotificationFilterKey = (typeof FILTER_KEYS)[number];

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

export function useNotificationListState() {
  const [searchParams, setSearchParams] = useSearchParams();

  const state = useMemo(() => {
    const pageRaw = Number(searchParams.get('page'));
    const pageSizeRaw = Number(searchParams.get('pageSize'));
    const sortRaw = searchParams.get('sort');
    return {
      tab: searchParams.get('tab') === 'messages' ? ('messages' as const) : ('inbox' as const),
      conversationId: searchParams.get('conv'),
      q: searchParams.get('q') ?? '',
      filters: {
        status:
          readEnum<NotificationStatusFilter>(searchParams, 'status', NOTIFICATION_STATUS_FILTERS) ??
          DEFAULT_STATUS,
        category: readEnum<NotificationCategory>(searchParams, 'category', NOTIFICATION_CATEGORIES),
        priority: readEnum<NotificationPriority>(searchParams, 'priority', NOTIFICATION_PRIORITIES),
        kind: readEnum<NotificationKind>(searchParams, 'kind', NOTIFICATION_KINDS),
        from: readDate(searchParams, 'from'),
        to: readDate(searchParams, 'to'),
      } satisfies NotificationListFilters,
      sort: (sortRaw !== null && isNotificationSort(sortRaw)
        ? sortRaw
        : 'newest') satisfies NotificationSort,
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

  const setTab = useCallback(
    (tab: string) =>
      update(
        (params) => {
          if (tab === 'messages') params.set('tab', 'messages');
          else params.delete('tab');
          params.delete('conv');
        },
        { replace: true },
      ),
    [update],
  );

  const setConversation = useCallback(
    (conversationId: string | null) =>
      update(
        (params) => {
          if (conversationId === null) params.delete('conv');
          else params.set('conv', conversationId);
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
    <K extends NotificationFilterKey>(key: K, value: NotificationListFilters[K] | null) =>
      update((params) => {
        if (value === null || value === '' || (key === 'status' && value === DEFAULT_STATUS)) {
          params.delete(key);
        } else {
          params.set(key, value);
        }
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
    (sort: NotificationSort) =>
      update(
        (params) => {
          if (sort === 'newest') params.delete('sort');
          else params.set('sort', sort);
        },
        { replace: true },
      ),
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
        setFilter(id as NotificationFilterKey, null);
      }
    },
    [setFilter],
  );

  const hasActiveFilters =
    state.filters.status !== DEFAULT_STATUS ||
    state.filters.category !== null ||
    state.filters.priority !== null ||
    state.filters.kind !== null ||
    state.filters.from !== null ||
    state.filters.to !== null;

  return {
    ...state,
    hasActiveFilters,
    setTab,
    setConversation,
    setQuery,
    setFilter,
    removeFilter,
    clearFilters,
    setSort,
    setPage,
    setPageSize,
  } as const;
}
