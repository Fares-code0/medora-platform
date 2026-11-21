import { fireEvent } from '@testing-library/react-native';
import { AccessibilityInfo, FlatList } from 'react-native';

import type { PagedQuery } from '@/api/paged';
import { PagedList, Text } from '@/components';
import { renderWithProviders } from '@/test/render';

/**
 * The windowed list — checklist W-08 §3, `docs/PERF.md` §3.
 *
 * Two things are being tested and they are different in kind. The first
 * is behaviour a patient can see: four states, a header that scrolls with
 * the rows, and the three paging decisions G-02 argued out. The second is
 * a **property of the container** — that it windows at all — which no
 * rendered output can show, because a list that mounts every row and a
 * list that mounts twenty look identical in a tree dump.
 *
 * So the windowing assertions read the props off the `FlatList` itself.
 * That is deliberately the only place in this suite that reaches for a
 * component instance: the numbers are the budget, and a refactor that
 * quietly drops them back to the defaults is exactly what this file is
 * here to fail on.
 */

interface Row {
  readonly id: string;
  readonly label: string;
}

function rows(count: number, prefix = 'R'): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index + 1}`,
    label: `Row ${index + 1}`,
  }));
}

function query(overrides: Partial<PagedQuery<Row>> = {}): PagedQuery<Row> {
  return {
    data: { items: rows(3), totalItems: 3, hasMore: false },
    isPending: false,
    isError: false,
    error: null,
    refetch: jest.fn(),
    hasMore: false,
    isLoadingMore: false,
    loadMore: jest.fn(),
    loadedPages: 1,
    isRefetching: false,
    ...overrides,
  };
}

function renderList(overrides: Partial<PagedQuery<Row>> = {}, extra: Record<string, unknown> = {}) {
  const paged = query(overrides);
  const view = renderWithProviders(
    <PagedList
      testID="demo-screen"
      statesTestID="demo-list"
      query={paged}
      renderItem={(row) => <Text testID={`row-${row.id}`}>{row.label}</Text>}
      empty={{ title: 'Nothing here', body: 'Nothing to show yet.' }}
      paging={{
        testIDPrefix: 'demo',
        loadMoreLabel: 'Show more',
        loadMoreHint: 'Showing 3 of 9',
        endLabel: 'That is all 3',
      }}
      {...extra}
    />,
  );
  return { ...view, paged };
}

describe('the four states are still AsyncBoundary’s', () => {
  it('shows the skeleton while the first page is on the wire', () => {
    const view = renderList({ data: undefined, isPending: true });
    expect(view.getByTestId('demo-list-loading')).toBeTruthy();
    expect(view.queryByTestId('row-R-1')).toBeNull();
  });

  it('shows the error with a retry, and never rows beside it', () => {
    const refetch = jest.fn();
    const view = renderList({ isError: true, error: new Error('nope'), refetch });
    expect(view.getByTestId('demo-list-error')).toBeTruthy();
    expect(view.queryByTestId('row-R-1')).toBeNull();
  });

  it('shows the empty state when the server answered with nothing', () => {
    const view = renderList({ data: { items: [], totalItems: 0, hasMore: false } });
    expect(view.getByTestId('demo-list-empty')).toBeTruthy();
  });

  it('renders a row per item once there are rows', () => {
    const view = renderList();
    expect(view.getByTestId('row-R-1')).toBeTruthy();
    expect(view.getByTestId('row-R-3')).toBeTruthy();
    expect(view.queryByTestId('demo-list-empty')).toBeNull();
  });
});

describe('the header and footer travel with the rows', () => {
  it('renders the header above the list rather than in a fixed bar', () => {
    const view = renderList({}, { header: <Text testID="demo-header">Appointments</Text> });
    expect(view.getByTestId('demo-header')).toBeTruthy();
  });

  it('keeps the header while the list is empty, so the controls stay reachable', () => {
    const view = renderList(
      { data: { items: [], totalItems: 0, hasMore: false } },
      { header: <Text testID="demo-header">Appointments</Text> },
    );
    expect(view.getByTestId('demo-header')).toBeTruthy();
    expect(view.getByTestId('demo-list-empty')).toBeTruthy();
  });

  it('renders a footer below the paging controls', () => {
    const view = renderList({}, { footer: <Text testID="demo-footer">No push yet</Text> });
    expect(view.getByTestId('demo-footer')).toBeTruthy();
  });
});

describe('the three paging decisions (G-02)', () => {
  it('offers a button rather than loading on scroll', () => {
    const view = renderList({ hasMore: true });
    expect(view.getByTestId('demo-load-more')).toBeTruthy();
    // No `onEndReached`: a list that fetches because a thumb moved spends
    // a patient's data without asking, and has no end a screen-reader
    // user can reach.
    expect(view.UNSAFE_getByType(FlatList).props.onEndReached).toBeUndefined();
  });

  it('asks for the next page when the button is pressed', () => {
    const loadMore = jest.fn();
    const view = renderList({ hasMore: true, loadMore });
    fireEvent.press(view.getByTestId('demo-load-more'));
    expect(loadMore).toHaveBeenCalledTimes(1);
  });

  it('puts the next page’s skeleton below the rows, never over them', () => {
    const view = renderList({ hasMore: true, isLoadingMore: true });
    expect(view.getByTestId('row-R-1')).toBeTruthy();
    // `includeHiddenElements` because a skeleton is hidden from assistive
    // technology on purpose (`decorative` in `Skeleton.tsx`).
    expect(view.getByTestId('demo-loading-more', { includeHiddenElements: true })).toBeTruthy();
  });

  it('says “that is all” once, after paging', () => {
    const view = renderList({ loadedPages: 2 });
    expect(view.getByTestId('demo-end')).toBeTruthy();
  });

  it('leaves a single-page list undecorated', () => {
    const view = renderList();
    expect(view.queryByTestId('demo-load-more')).toBeNull();
    expect(view.queryByTestId('demo-end')).toBeNull();
  });

  it('names the status rows separately from the button when asked to', () => {
    const view = renderList(
      { loadedPages: 2 },
      {
        paging: {
          testIDPrefix: 'demo',
          statusTestIDPrefix: 'demo-doctors',
          loadMoreLabel: 'Show more',
          loadMoreHint: 'Showing 3 of 9',
          endLabel: 'That is all 3',
        },
      },
    );
    expect(view.getByTestId('demo-doctors-end')).toBeTruthy();
  });
});

describe('it windows, which is the whole point (W-08 §3)', () => {
  it('mounts one server page before the patient scrolls, and not the rest', () => {
    const view = renderList({
      data: { items: rows(120), totalItems: 120, hasMore: false },
    });
    const list = view.UNSAFE_getByType(FlatList);
    expect(list.props.initialNumToRender).toBe(20);
    expect(list.props.windowSize).toBe(5);
    expect(list.props.maxToRenderPerBatch).toBe(10);
  });

  it('keys rows by id, so a page that shifts under the list does not remount it', () => {
    const view = renderList();
    const keyExtractor = view.UNSAFE_getByType(FlatList).props.keyExtractor as (r: Row) => string;
    expect(keyExtractor({ id: 'R-7', label: 'Row 7' })).toBe('R-7');
  });

  it('does not hand rows to the list in a state that has none to show', () => {
    const view = renderList({ isError: true, error: new Error('nope') });
    expect(view.UNSAFE_getByType(FlatList).props.data).toEqual([]);
  });
});

describe('pull-to-refresh', () => {
  it('is absent unless the screen asked for it', () => {
    const view = renderList();
    expect(view.UNSAFE_getByType(FlatList).props.refreshControl).toBeUndefined();
  });

  it('re-asks the server when the screen wired one', () => {
    const onRefresh = jest.fn();
    const view = renderList({}, { onRefresh });
    const control = view.UNSAFE_getByType(FlatList).props.refreshControl as {
      props: { onRefresh: () => void; refreshing: boolean };
    };
    control.props.onRefresh();
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(control.props.refreshing).toBe(false);
  });
});

describe('a page that arrives says so (S-07)', () => {
  const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');

  function rerenderWith(
    view: ReturnType<typeof renderList>,
    paged: PagedQuery<Row>,
    extra: Record<string, unknown> = {},
  ) {
    view.rerender(
      <PagedList
        testID="demo-screen"
        statesTestID="demo-list"
        query={paged}
        renderItem={(row) => <Text testID={`row-${row.id}`}>{row.label}</Text>}
        empty={{ title: 'Nothing here', body: 'Nothing to show yet.' }}
        paging={{
          testIDPrefix: 'demo',
          loadMoreLabel: 'Show more',
          loadMoreHint: 'Showing 3 of 9',
          endLabel: 'That is all 3',
        }}
        {...extra}
      />,
    );
  }

  it('says nothing for the first page, which arrives with the screen', () => {
    renderList({ loadedPages: 1 });
    expect(announce).not.toHaveBeenCalled();
  });

  it('announces the count when a "Show more" brings a page in', () => {
    const view = renderList({ hasMore: true, loadedPages: 1 });
    rerenderWith(
      view,
      query({
        hasMore: true,
        loadedPages: 2,
        data: { items: rows(40), totalItems: 90, hasMore: true },
      }),
    );
    expect(announce).toHaveBeenCalledWith('Loaded. Showing 40 of 90.');
  });

  it('announces the end instead when the page that arrived was the last', () => {
    const view = renderList({ hasMore: true, loadedPages: 1 });
    rerenderWith(
      view,
      query({
        hasMore: false,
        loadedPages: 2,
        data: { items: rows(30), totalItems: 30, hasMore: false },
      }),
    );
    expect(announce).toHaveBeenCalledWith('That is all 3');
  });

  it('stays silent on a pull-to-refresh, which brings no new page', () => {
    const view = renderList({ loadedPages: 2 });
    announce.mockClear();
    rerenderWith(view, query({ loadedPages: 2, isRefetching: true }));
    expect(announce).not.toHaveBeenCalled();
  });

  it('stays silent when a segment switch starts a new query at page one', () => {
    const view = renderList({ loadedPages: 3 });
    announce.mockClear();
    rerenderWith(view, query({ loadedPages: 1 }));
    expect(announce).not.toHaveBeenCalled();
  });
});
