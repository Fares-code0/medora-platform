import type { ReactNode } from 'react';

import { useT } from '@/i18n';

import { EmptyState, type EmptyStateProps } from './EmptyState';
import { ErrorState } from './ErrorState';
import { SkeletonList } from './Skeleton';

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
}

export function AsyncBoundary<TData>({
  query,
  children,
  isEmpty,
  empty,
  loading,
  testID,
}: AsyncBoundaryProps<TData>) {
  // Called before the early returns: the four states below are branches
  // of one render, and a hook behind a branch is a hook that runs a
  // different number of times per render.
  const t = useT();

  if (query.isError) {
    return (
      <ErrorState
        error={query.error}
        {...(query.refetch === undefined ? {} : { onRetry: query.refetch })}
        testID={testID === undefined ? undefined : `${testID}-error`}
      />
    );
  }

  if (query.isPending || query.data === undefined) {
    return (
      <>
        {loading ?? (
          <SkeletonList testID={testID === undefined ? undefined : `${testID}-loading`} />
        )}
      </>
    );
  }

  if (isEmpty?.(query.data) === true) {
    return (
      <EmptyState
        title={t('state.empty.title')}
        {...empty}
        testID={testID === undefined ? undefined : `${testID}-empty`}
      />
    );
  }

  return <>{children(query.data)}</>;
}
