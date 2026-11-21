import { useInfiniteQuery, type QueryKey } from '@tanstack/react-query';

/**
 * Page-number pagination, once, for every list that has more than one
 * page of it.
 *
 * ── Why this module exists ───────────────────────────────────────────
 *
 * `useDoctorSearch` worked this out first, for checklist G-02, and the
 * reasoning it wrote down is not specific to doctors: every paginated
 * list this client reads is a page-number window onto a server-side
 * collection that can move under it, and every one of them accumulates
 * pages rather than replacing them. Copying that hook per feature would
 * copy its de-duplication rule, its double-tap guard and its
 * "`hasMore` is the server's answer" rule three times, and the third
 * copy is where one of them quietly goes missing.
 *
 * So the mechanism lives here and the features declare only what they
 * fetch. `useDoctorSearch` now delegates to it and behaves exactly as
 * before — `features/doctors/pagination.test.tsx` is the proof, and it
 * was not edited when this module was extracted.
 *
 * ── What it deliberately does NOT do ─────────────────────────────────
 *
 * It does not own the page *number*. `queryFn` receives one and the
 * query decides when to ask for the next; a caller that could pass a
 * page in would put two authorities on the same value and let the cache
 * key disagree with what was actually fetched.
 */

/**
 * One page of a list, as a feature's port returns it.
 *
 * `hasMore` rather than `page`/`totalPages`: whether another page exists
 * is the server's arithmetic, and a screen should not be re-deriving it.
 * `totalItems` is what "showing 20 of 47" is built from.
 */
export interface PagedResult<TItem> {
  readonly items: readonly TItem[];
  readonly totalItems: number;
  readonly hasMore: boolean;
}

/**
 * What a paged list needs beyond the four `AsyncBoundary` states.
 *
 * `data` keeps the single-page `PagedResult` shape on purpose: a caller
 * that only ever wants the first page reads `data.items` exactly as it
 * would from an ordinary query and never touches `loadMore`.
 */
export interface PagedQuery<TItem> {
  readonly data: PagedResult<TItem> | undefined;
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly error: unknown;
  readonly refetch: () => void;
  /** True when the server says there is another page. */
  readonly hasMore: boolean;
  /** True while that page is on the wire. */
  readonly isLoadingMore: boolean;
  readonly loadMore: () => void;
  /**
   * How many pages are on screen.
   *
   * `PagedList` announces the count when this goes up, which is what
   * this line claimed before anything did it (`A11Y_AUDIT.md` F-6).
   */
  readonly loadedPages: number;
  /** True while a pull-to-refresh is in flight. */
  readonly isRefetching: boolean;
}

/**
 * Merges the pages the patient has asked for into one list.
 *
 * ── Why this de-duplicates ───────────────────────────────────────────
 * Page-number pagination is a window onto a list that can move under it.
 * A row added to the collection between page 1 and page 2 shifts every
 * row down one, so the last row of page 1 arrives again as the first row
 * of page 2 — and two React children with the same `key` is a warning in
 * development and a rendering bug in production.
 *
 * First occurrence wins, so the row keeps the position the patient
 * already saw it in rather than jumping down the list.
 *
 * `totalItems` comes from the LAST page rather than the first: it is the
 * server's own count and the freshest one this client holds.
 */
export function mergePages<TItem extends { readonly id: string }>(
  pages: readonly PagedResult<TItem>[],
  hasMore: boolean,
): PagedResult<TItem> {
  const seen = new Set<string>();
  const items: TItem[] = [];
  for (const page of pages) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      items.push(item);
    }
  }
  const last = pages[pages.length - 1];
  return { items, totalItems: last?.totalItems ?? items.length, hasMore };
}

export interface UsePagedQueryOptions<TItem> {
  readonly queryKey: QueryKey;
  /** Pages are 1-based, matching every `page` parameter in the contract. */
  readonly queryFn: (page: number) => Promise<PagedResult<TItem>>;
  readonly enabled?: boolean;
  readonly staleTime?: number;
}

/**
 * An accumulating, page-numbered query.
 *
 * An infinite query rather than a page cursor in screen state because
 * the pages have to *accumulate*: a patient who read to the bottom of a
 * page and tapped for more expects the next row, not a fresh screen.
 */
export function usePagedQuery<TItem extends { readonly id: string }>({
  queryKey,
  queryFn,
  enabled,
  staleTime,
}: UsePagedQueryOptions<TItem>): PagedQuery<TItem> {
  const query = useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }) => queryFn(pageParam),
    initialPageParam: 1,
    // `hasMore` is the server's answer (`page < totalPages`), never a
    // guess from the length of the page — a full last page is not
    // "has more", and asking for the page after it returns an empty one.
    getNextPageParam: (lastPage: PagedResult<TItem>, allPages: PagedResult<TItem>[]) =>
      lastPage.hasMore ? allPages.length + 1 : undefined,
    ...(enabled === undefined ? {} : { enabled }),
    ...(staleTime === undefined ? {} : { staleTime }),
  });

  const pages = query.data?.pages;

  return {
    data: pages === undefined ? undefined : mergePages(pages, query.hasNextPage),
    isPending: query.isPending,
    isError: query.isError,
    error: query.error,
    refetch: () => void query.refetch(),
    hasMore: query.hasNextPage,
    isLoadingMore: query.isFetchingNextPage,
    loadMore: () => {
      // Guarded here rather than at the call site: a double tap on the
      // button would otherwise queue a second request for the same page.
      if (query.hasNextPage && !query.isFetchingNextPage) void query.fetchNextPage();
    },
    loadedPages: pages?.length ?? 0,
    // `isRefetching` on an infinite query is true while a pull-to-refresh
    // re-reads the pages already loaded, and false while page N+1 is
    // being appended — which is what a pull-to-refresh spinner should
    // follow, and why `isLoadingMore` is reported separately.
    isRefetching: query.isRefetching,
  };
}
