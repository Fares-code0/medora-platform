import { ArrowRight, ClipboardList } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Skeleton } from '@/components/feedback';
import { Badge } from '@/components/ui';

import { AsyncSection, Panel } from '../components/primitives';

import type { ActionQueueRow, OverviewWidgetSurface } from './overview.types';

/**
 * Row 2 right (§3.1) — what is waiting on an administrator, each row a count
 * that opens the queue it came from with its filter already applied.
 *
 * Every row is a link and none is an action. §3.1 permits approving a
 * verification straight from here, but ADM-03 refuses one until all three
 * per-document checks are ticked; a one-click approve on the home page would
 * either bypass that rule or fail for reasons this card cannot explain.
 *
 * The card owns its own loading and error branches *inside* its Panel, exactly
 * as PlatformActivityChart does. Outside the Panel they would strip the widget
 * of its frame and heading mid-load, and turn a document failure into a naked
 * error block floating beside a fully framed chart — an orphan rather than
 * "this widget failed". Keeping the notice attributed to its own widget is
 * also what §3.1's per-widget Retry asks for.
 *
 * It stays presentational: the combined query state arrives as a prop, because
 * the documents behind the five rows — ADM-02/04/05 plus, for the fifth,
 * ADM-06B's communications document — belong to those pages and are read once
 * by this one.
 */
export interface ActionQueueCardProps extends OverviewWidgetSurface {
  rows: readonly ActionQueueRow[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

export function ActionQueueCard({
  rows,
  isLoading,
  isError,
  onRetry,
  menu,
  className,
}: ActionQueueCardProps) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);

  return (
    <Panel
      title="Admin action queue"
      menu={menu}
      className={className}
      description={describe(total, isLoading, isError)}
      icon={ClipboardList}
      tone="warning"
      /* The rows are full-bleed hit targets carrying their own padding, so the
         body has none; the error notice is ordinary block content and needs
         the panel's normal inset back. */
      bodyClassName={isError ? undefined : 'p-0'}
    >
      <AsyncSection
        isLoading={isLoading}
        isError={isError}
        onRetry={onRetry}
        skeleton={<QueueRowsSkeleton />}
      >
        <ul className="flex flex-col divide-y divide-border">
          {rows.map((row) => (
            <li key={row.kind}>
              <Link
                to={row.to}
                className="flex items-center gap-3 px-5 py-3 transition-colors duration-fast hover:bg-surface-sunken focus-visible:bg-surface-sunken"
              >
                <Badge variant={row.count === 0 ? 'neutral' : 'warning'}>
                  <span className="tabular-nums">{row.count}</span>
                </Badge>
                <span className="min-w-0 flex-1 truncate text-body-sm text-text-primary">
                  {row.label}
                </span>
                <ArrowRight
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 text-text-tertiary"
                  strokeWidth={1.75}
                />
              </Link>
            </li>
          ))}
        </ul>
      </AsyncSection>
    </Panel>
  );
}

/**
 * The heading caption must never speak for a queue that has not arrived. Until
 * the documents land every derived count is 0, and "Nothing is waiting on you."
 * would tell an administrator the platform is idle when it has merely not been
 * looked at yet — the same lie a row of zeros tells in the KPI row.
 */
function describe(total: number, isLoading: boolean, isError: boolean): string | undefined {
  if (isLoading) return 'Checking what needs your attention.';
  // The body's own notice already says this widget failed; a caption repeating
  // it would say the same thing twice inside one card.
  if (isError) return undefined;
  if (total === 0) return 'Nothing is waiting on you.';
  return 'Each count opens its queue, already filtered.';
}

/** Five rows of placeholder in the rhythm the real rows use, so nothing shifts. */
function QueueRowsSkeleton() {
  return (
    <div className="flex flex-col divide-y divide-border">
      {['verifications', 'licences', 'issues', 'appointments', 'communications'].map((row) => (
        <div key={row} className="px-5 py-3">
          <Skeleton className="h-6 w-full rounded-surface" />
        </div>
      ))}
    </div>
  );
}
