import type { ReactNode } from 'react';

import type { UseQueryResult } from '@tanstack/react-query';

import { ErrorState, Skeleton } from '@/components/feedback';
import { Stack } from '@/components/layout';

/**
 * One lazily loaded profile tab (FE-10.2): a skeleton while its record is
 * fetched, an error with Retry if it cannot be, and the tab itself once it
 * arrives. A failed tab never takes down the chart around it.
 */
export function ProfileTabPanel<T>({
  query,
  label,
  children,
}: {
  query: UseQueryResult<T>;
  /** What the tab holds, for the error message: "medical history". */
  label: string;
  children: (data: T) => ReactNode;
}) {
  if (query.isPending) {
    return (
      <Stack gap={3} aria-busy="true" aria-label={`Loading ${label}`}>
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-2/3" />
      </Stack>
    );
  }
  if (query.isError) {
    return (
      <ErrorState
        title={`Couldn't load ${label}`}
        error={query.error}
        onRetry={() => void query.refetch()}
      />
    );
  }
  return <>{children(query.data)}</>;
}
