import { useCallback, useEffect, useRef, type ReactElement, type ReactNode } from 'react';

import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { announce } from '@/accessibility/a11y';
import type { PagedQuery } from '@/api/paged';
import { useT } from '@/i18n';
import { useTheme } from '@/theme';

import { Button } from '../Button';
import { AsyncBoundary } from '../feedback/AsyncBoundary';
import type { EmptyStateProps } from '../feedback/EmptyState';
import { SkeletonCard } from '../feedback/Skeleton';
import { Text } from '../Text';

import { useScreenContentStyle, type ScreenEdge } from './screen-content';

/**
 * The scroll container for a screen whose body is one list that grows.
 *
 * ── Why this exists: `docs/PERF.md` §3 and §5 ────────────────────────
 *
 * Every list in this app used to be `data.items.map(…)` inside `Screen`,
 * which is a `ScrollView`. A `ScrollView` mounts every child it is given
 * and keeps it mounted, which was the right trade while a list was one
 * server page of twenty rows — `PERF.md` §3 said exactly that, and said
 * what would change it:
 *
 * > "Twenty cards is well within what a `View` can handle, so this is not
 * > a defect today — but it is the first thing that will matter if
 * > G-02's paging control lands and the list grows."
 *
 * G-02 landed, and so did I-01 and O-01. A patient with two years of
 * appointments can now tap "Show more" until every one of them is mounted
 * at once, and the notification feed is the longest list in the app. The
 * condition §5 listed as the trigger has fired, so the windowing it
 * anticipated is here.
 *
 * ── What it does NOT change ──────────────────────────────────────────
 *
 * The three paging decisions `DoctorResults` argued out for G-02 are kept
 * verbatim, because they are about consent and screen readers rather than
 * about rendering:
 *
 * 1. **A button, not scroll-triggered loading.** There is deliberately no
 *    `onEndReached` on this list. Spending a patient's data because their
 *    thumb moved is not something to do without asking, and an infinite
 *    list has no end for a screen-reader user to reach.
 * 2. **The next page's loading state lives BELOW the rows**, so the rows
 *    being read are never replaced by a skeleton.
 * 3. **"That is all of them" is said once, at the end, and only after
 *    paging** — on a single-page list it is noise.
 *
 * The four screen states are still `AsyncBoundary`'s, in its order and
 * with its test IDs: it renders as this list's empty component, which is
 * reached in exactly the states where there are no rows to show.
 *
 * ── The announcement (S-07) ─────────────────────────────────────────
 *
 * `paged.ts` has described `loadedPages` as "the count a live region
 * announces" since it was extracted, and nothing announced it. Pressing
 * "Show more" moves no focus and reads nothing: twenty rows appear
 * *above* the button a screen-reader user is still standing on, and the
 * only feedback is the spinner they cannot see. So a page arriving says
 * so, once, politely — and says which of the two things happened, since
 * the last page arriving also takes the button away.
 */

/**
 * How many rows are mounted before the patient scrolls.
 *
 * One server page. Every paginated route in the contract returns twenty
 * rows, and a patient who asked for a page expects to be able to scroll
 * through it without cells blanking; batching *within* the page buys back
 * nothing worth that, because the memory this component is here to bound
 * is pages two onward. `windowSize` then keeps roughly two screens of
 * rows either side of the viewport mounted and lets the rest go.
 */
const PAGE_ROWS = 20;

export interface PagedListProps<TItem extends { readonly id: string }> {
  readonly query: PagedQuery<TItem>;
  readonly renderItem: (item: TItem) => ReactElement | null;
  /** The scroll container's own test ID. */
  readonly testID: string;
  /**
   * The prefix for the four state test IDs — `<statesTestID>-loading`,
   * `-error`, `-empty`. Separate from `testID` because a screen's
   * container and its list have always been two different handles in the
   * suite: `appointments-screen` is the thing you pull to refresh, and
   * `appointments-list` is the thing that is loading.
   */
  readonly statesTestID: string;
  readonly empty: EmptyStateProps;
  /** Content above the rows. Scrolls with them, so it is not a header bar. */
  readonly header?: ReactNode;
  /** Content below the paging controls. */
  readonly footer?: ReactNode;
  /** Vertical gap between rows. Defaults to `theme.space[3]`. */
  readonly rowGap?: number;
  readonly paging: {
    readonly loadMoreLabel: string;
    readonly loadMoreHint: string;
    readonly endLabel: string;
    /** The "Show more" button's test ID is `<testIDPrefix>-load-more`. */
    readonly testIDPrefix: string;
    /**
     * The prefix for the two status test IDs — `-loading-more` and
     * `-end`. Defaults to `testIDPrefix`; Discover has always named these
     * two after its list (`discover-doctors-end`) and its button after
     * the screen (`discover-load-more`), and a component is the wrong
     * place to tidy a suite's handles.
     */
    readonly statusTestIDPrefix?: string;
  };
  readonly onRefresh?: () => void;
  readonly edges?: readonly ScreenEdge[];
  readonly padded?: boolean;
}

export function PagedList<TItem extends { readonly id: string }>({
  query,
  renderItem,
  testID,
  statesTestID,
  empty,
  header,
  footer,
  rowGap,
  paging,
  onRefresh,
  edges,
  padded,
}: PagedListProps<TItem>) {
  const theme = useTheme();
  const t = useT();
  const contentStyle = useScreenContentStyle({
    ...(padded === undefined ? {} : { padded }),
    ...(edges === undefined ? {} : { edges }),
    rowGap: 0,
  });

  /**
   * Rows are handed to the list only in the one state that has rows.
   *
   * `AsyncBoundary` orders its states deliberately — error before
   * loading, loading before data, empty before children — and rendering
   * rows *and* the boundary would put two of those on screen at once. An
   * error during a background refetch still replaces the list, exactly as
   * it did before this component existed.
   */
  const rows = query.isError || query.isPending || query.data === undefined ? [] : query.data.items;

  const keyExtractor = useCallback((item: TItem) => item.id, []);

  /**
   * Announce a page that has arrived — never the first one, which lands
   * with the screen and is read by the screen reader on its own, and
   * never a pull-to-refresh, which re-reads the pages already held and
   * leaves the count where it was.
   *
   * Switching a segment (Upcoming → Past) starts a new query at one
   * page, which is lower than the count it replaces, so the comparison
   * stays silent without needing to know about scopes.
   */
  const announcedPages = useRef(query.loadedPages);
  const { loadedPages, hasMore } = query;
  const shown = query.data?.items.length ?? 0;
  const total = query.data?.totalItems ?? 0;

  useEffect(() => {
    const previous = announcedPages.current;
    announcedPages.current = loadedPages;
    if (loadedPages <= previous || previous === 0) return;
    announce(hasMore ? t('a11y.pageLoaded', { shown, total }) : paging.endLabel);
  }, [loadedPages, hasMore, shown, total, t, paging.endLabel]);

  const gap = rowGap ?? theme.space[3];
  const statusPrefix = paging.statusTestIDPrefix ?? paging.testIDPrefix;

  return (
    <FlatList
      testID={testID}
      data={rows}
      keyExtractor={keyExtractor}
      renderItem={({ item, index }) => (
        <View style={index === 0 ? undefined : { marginTop: gap }}>{renderItem(item)}</View>
      )}
      style={[styles.fill, { backgroundColor: theme.colors.background }]}
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      // Windowing. See PAGE_ROWS above for why the first batch is a whole
      // page; `windowSize` is in viewports, and 5 keeps two screens
      // either side of the visible one mounted.
      initialNumToRender={PAGE_ROWS}
      maxToRenderPerBatch={10}
      windowSize={5}
      ListHeaderComponent={
        header === undefined ? undefined : (
          <View style={{ rowGap: theme.space[4], paddingBottom: theme.space[4] }}>{header}</View>
        )
      }
      ListEmptyComponent={
        <AsyncBoundary testID={statesTestID} query={query} isEmpty={() => true} empty={empty}>
          {() => null}
        </AsyncBoundary>
      }
      ListFooterComponent={
        <View
          style={{ rowGap: theme.space[3], paddingTop: rows.length === 0 ? 0 : theme.space[3] }}
        >
          {query.isLoadingMore ? <SkeletonCard testID={`${statusPrefix}-loading-more`} /> : null}

          {query.hasMore ? (
            <Button
              label={paging.loadMoreLabel}
              tone="secondary"
              testID={`${paging.testIDPrefix}-load-more`}
              disabled={query.isLoadingMore}
              loading={query.isLoadingMore}
              hint={paging.loadMoreHint}
              onPress={query.loadMore}
            />
          ) : rows.length > 0 && query.loadedPages > 1 ? (
            <Text
              variant="caption"
              color="textTertiary"
              testID={`${statusPrefix}-end`}
              style={styles.end}
            >
              {paging.endLabel}
            </Text>
          ) : null}

          {footer}
        </View>
      }
      {...(onRefresh === undefined
        ? {}
        : {
            refreshControl: (
              <RefreshControl
                refreshing={query.isRefetching}
                onRefresh={onRefresh}
                tintColor={theme.colors.primary}
                colors={[theme.colors.primary]}
              />
            ),
          })}
    />
  );
}

const styles = StyleSheet.create({
  end: { textAlign: 'center' },
  fill: { flex: 1 },
});
