import { useEffect, useRef, type ReactNode } from 'react';

import { isStaleDataSafeError } from '@/api/errors';
import { useT } from '@/i18n';

import { EmptyState, type EmptyStateProps } from './EmptyState';
import { ErrorState, summarizeError } from './ErrorState';
import { SkeletonList } from './Skeleton';
import { useToast } from './Toast';

/**
 * Loading / error / empty / success, in one place.
 *
 * §10 of the brief asks for reusable state patterns rather than an ad-hoc
 * version per screen, and this is the component that makes that
 * enforceable: a screen that renders a list writes
 *
 * ```tsx
 * <AsyncBoundary
 *   query={appointments}
 *   isEmpty={(data) => data.length === 0}
 *   empty={{ title: 'No appointments', action: … }}
 * >
 *   {(data) => …}
 * </AsyncBoundary>
 * ```
 *
 * and gets all four states, correctly ordered, with no way to forget one.
 * The ordering matters and is not arbitrary:
 *
 * 1. **Error before loading** — a background refetch after a failure is
 *    still `isFetching`, and showing a skeleton over a failed screen
 *    makes an error look like a hang.
 * 2. **Loading before data** — `data` is `undefined` on first load.
 * 3. **Empty before children** — so `children` never receives an empty
 *    collection it has to special-case again.
 *
 * It takes a *shape*, not a `UseQueryResult`, so it can also wrap a
 * loading state driven by something other than TanStack Query, and so the
 * tests do not need a QueryClient to exercise it.
 */
export interface AsyncState<TData> {
  readonly data: TData | undefined;
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly error: unknown;
  readonly refetch?: () => void;
}

export interface AsyncBoundaryProps<TData> {
  readonly query: AsyncState<TData>;
  readonly children: (data: TData) => ReactNode;
  readonly isEmpty?: (data: TData) => boolean;
  readonly empty?: EmptyStateProps;
  /** Override the default skeleton when a screen's shape is not a list. */
  readonly loading?: ReactNode;
  readonly testID?: string;
  /**
   * Keep showing records already on screen when a REFRESH fails.
   *
   * TanStack keeps `data` after a failed refetch but reports `isError`,
   * and rule 1 above then swaps the patient's records for a full-screen
   * error — on a pull-to-refresh or a background refetch, with nothing
   * wrong with what they were reading. With this set, a failure that says
   * only "the server could not be asked" — network, timeout, rate limited
   * (429), or a real 5xx — leaves the content in place and says so in a
   * toast instead. `isStaleDataSafeError` is the rule; it is NOT the
   * Retry-button rule (a 429 has no Retry button but keeps the records).
   *
   * Everything else replaces the content: forbidden, not found, signed
   * out, an unavailable endpoint (a record the server now refuses is not
   * one to keep displaying), and — failing closed — a response that broke
   * its contract, a status the client has no mapping for, or a value that
   * is not a normalized API error at all. With no cached data, every
   * failure is the full-screen error exactly as before.
   *
   * The content keeps its position in the tree across the switch, so a
   * failing or recovering refresh never remounts it: scroll position, an
   * expanded card and any other local state in `children` survive.
   *
   * Opt-in, so screens that have not chosen it are unchanged.
   */
  readonly keepDataOnRefreshError?: boolean;
}

export function AsyncBoundary<TData>({
  query,
  children,
  isEmpty,
  empty,
  loading,
  testID,
  keepDataOnRefreshError = false,
}: AsyncBoundaryProps<TData>) {
  // Called before the early returns: the four states below are branches
  // of one render, and a hook behind a branch is a hook that runs a
  // different number of times per render.
  const t = useT();

  const { data } = query;
  const keepStale =
    keepDataOnRefreshError &&
    query.isError &&
    data !== undefined &&
    isStaleDataSafeError(query.error);

  if (keepStale) {
    // `keepStale` includes `data !== undefined`, and TypeScript narrows
    // `data` through the aliased condition.
    return renderContent(data, <RefreshFailureNotice error={query.error} />);
  }

  if (query.isError) {
    return (
      <ErrorState
        error={query.error}
        {...(query.refetch === undefined ? {} : { onRetry: query.refetch })}
        testID={testID === undefined ? undefined : `${testID}-error`}
      />
    );
  }

  if (query.isPending || data === undefined) {
    return (
      <>
        {loading ?? (
          <SkeletonList testID={testID === undefined ? undefined : `${testID}-loading`} />
        )}
      </>
    );
  }

  return renderContent(data, null);

  /**
   * The content, in ONE tree shape for every path that shows it: the
   * content (empty state or `children`) first, the notice slot second.
   * React reconciles by position, so a notice placed ahead of the content
   * — or a content element that is sometimes the root and sometimes a
   * fragment's child — would unmount and remount the whole subtree the
   * moment a refresh fails or recovers. `null` holds the notice's slot
   * when there is nothing to report.
   */
  function renderContent(value: TData, notice: ReactNode) {
    return (
      <>
        {isEmpty?.(value) === true ? (
          <EmptyState
            title={t('state.empty.title')}
            {...empty}
            testID={testID === undefined ? undefined : `${testID}-empty`}
          />
        ) : (
          children(value)
        )}
        {notice}
      </>
    );
  }
}

/**
 * Says once, in a toast, that a refresh failed while the content stays.
 *
 * A component rather than a hook in `AsyncBoundary`, so the toast context
 * is only required by a boundary that is actually keeping stale content.
 * Each failed attempt is a new error object, so each one is reported once;
 * the ref stops a re-render (or a development double-effect) from
 * reporting the same failure twice. Renders nothing: the toast is the
 * notice, and an empty view here would add a gap inside a parent that
 * spaces its children with `rowGap`.
 */
function RefreshFailureNotice({ error }: { readonly error: unknown }) {
  const toast = useToast();
  const t = useT();
  const reported = useRef<unknown>(null);

  useEffect(() => {
    if (reported.current === error) return;
    reported.current = error;
    toast.show(t(summarizeError(error).titleKey), 'error');
  }, [error, toast, t]);

  return null;
}
