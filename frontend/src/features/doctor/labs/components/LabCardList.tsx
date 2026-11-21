import type { ReactNode } from 'react';

import { ErrorState, Skeleton } from '@/components/feedback';
import { Fact, FactGrid } from '@/components/patterns';
import { Card } from '@/components/ui';
import { cn } from '@/utils/cn';
import { formatDate, relativeDayLabel } from '@/utils/dates';

import { type LabTest } from '../model/types';

import { labRowClassName } from './lab-row-tint';
import {
  LabFlagCell,
  LabPatientCell,
  LabPriorityBadge,
  LabReviewCell,
  LabStatusBadge,
} from './LabCells';
import { LabRowActions, type LabRowActionsProps } from './LabRowActions';

/**
 * <md rendering of the labs list — UX §5.2 stacked key-value cards
 * mirroring the DataTable contract (loading / error / empty / actions)
 * so no functionality is lost on mobile.
 *
 * That parity is the reason the flag, the review state and the review
 * actions are all here too: D-11's "mark reviewed" is mandatory for critical
 * results, and a mandatory action that exists only above 768px is a rule with
 * a hole in it.
 */

export interface LabCardListProps {
  tests: readonly LabTest[];
  onOpenTest: (test: LabTest) => void;
  /** Per-card review affordances; same factory the table column uses. */
  rowReview?: ((test: LabTest) => LabRowActionsProps['review']) | undefined;
  loading: boolean;
  error?: { readonly title?: string; readonly onRetry?: () => void } | undefined;
  emptyState: ReactNode;
}

export function LabCardList({
  tests,
  onOpenTest,
  rowReview,
  loading,
  error,
  emptyState,
}: LabCardListProps) {
  if (loading) {
    return (
      <div aria-busy="true" className="flex flex-col gap-3">
        {Array.from({ length: 4 }, (_, index) => (
          <Card key={index} padding="compact">
            <div className="flex flex-col gap-3">
              <Skeleton className="h-5 w-1/2" />
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-16 w-full rounded-surface" />
            </div>
          </Card>
        ))}
      </div>
    );
  }

  if (error) {
    return <ErrorState title={error.title ?? "Couldn't load laboratory tests"} onRetry={error.onRetry} />;
  }

  if (tests.length === 0) {
    return <>{emptyState}</>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {tests.map((test) => (
        <li key={test.id}>
          {/* UX §2.6's critical row tint, in its <md form. */}
          <Card padding="compact" className={cn(labRowClassName(test))}>
            <div className="flex items-start justify-between gap-3">
              <LabPatientCell test={test} />
              <LabRowActions
                test={test}
                onOpenTest={onOpenTest}
                review={rowReview?.(test)}
              />
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <LabStatusBadge test={test} />
              <LabPriorityBadge test={test} />
            </div>
            <div className="mt-3 flex flex-wrap items-start gap-x-6 gap-y-2">
              <LabFlagCell test={test} />
              <LabReviewCell test={test} />
            </div>
            <FactGrid className="mt-3">
              <Fact label="Lab ID">
                <span className="font-mono">{test.id}</span>
              </Fact>
              <Fact label="MRN">
                <span className="font-mono">{test.patient.mrn}</span>
              </Fact>
              <Fact label="Test">{test.testName}</Fact>
              <Fact label="Category">{test.category}</Fact>
              <Fact label="Requested">
                {formatDate(test.requestedDate)} · {relativeDayLabel(test.requestedDate)}
              </Fact>
              <Fact label="Ordered by">{test.orderedBy}</Fact>
            </FactGrid>
          </Card>
        </li>
      ))}
    </ul>
  );
}
