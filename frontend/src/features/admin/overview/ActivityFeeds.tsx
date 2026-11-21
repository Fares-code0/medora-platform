import { ArrowRight, FileClock, UserRoundPlus } from 'lucide-react';
import { Link } from 'react-router-dom';

import { Skeleton } from '@/components/feedback';
import { StatusBadge } from '@/components/patterns';
import {} from '@/components/ui';
import { routes } from '@/routes';
import { cn } from '@/utils/cn';

import { formatDate } from '../administration.meta';
import type { AuditEvent } from '../administration.types';
import { AsyncSection, Panel } from '../components/primitives';
import { MaskedIdentifier } from '../phi';

import type { OverviewWidgetSurface, SignupEntry } from './overview.types';

/**
 * Row 4 (§3.1) — who did what, and who just arrived.
 *
 * The signups feed is the reason this file is careful: it is the one place on
 * the overview where a patient's name would otherwise be printed. It goes
 * through `MaskedIdentifier`, the only sanctioned way to render a patient
 * identifier in the admin area (ADM-10) — a reveal there needs the capability,
 * a categorised reason and a successful audit write. Doctor names are not PHI
 * and render plainly, which is also what makes the masked rows legible as a
 * choice rather than an accident.
 *
 * Both feeds keep their loading and error branches *inside* their Panel, as
 * every other widget on this page does: outside it a failure would arrive as a
 * naked error block beside a fully framed neighbour, attributed to the row
 * rather than to the widget that actually failed.
 */

export interface AdminActivityFeedProps extends OverviewWidgetSurface {
  events: readonly AuditEvent[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

/** How many lines each feed shows before deferring to its "view all" page. */
const ACTIVITY_FEED_LIMIT = 6;

export function AdminActivityFeed({
  events,
  isLoading,
  isError,
  onRetry,
  menu,
  className,
}: AdminActivityFeedProps) {
  const lines = events.slice(0, ACTIVITY_FEED_LIMIT);

  return (
    <Panel
      title="Recent admin activity"
      menu={menu}
      className={className}
      description="From the audit log."
      icon={FileClock}
      tone="warning"
      action={
        <Link
          to={routes.admin.settings('audit')}
          className="inline-flex items-center gap-1 rounded text-caption text-text-secondary transition-colors duration-fast hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          View all
          <ArrowRight aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={1.75} />
        </Link>
      }
      /* The rows are full-bleed and carry their own padding; the skeleton
         matches them, but the error notice is ordinary block content and needs
         the panel's normal inset back. */
      bodyClassName={isError ? undefined : 'p-0'}
    >
      <AsyncSection
        isLoading={isLoading}
        isError={isError}
        onRetry={onRetry}
        skeleton={<FeedSkeleton />}
      >
        {lines.length === 0 ? (
          <EmptyLine>No admin activity has been logged yet.</EmptyLine>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {lines.map((event) => (
              <li key={event.id} className="flex items-center gap-3 px-5 py-3">
                {/* The dot restates the severity the action text already
                    carries, so it is decorative; the line is readable without
                    colour. */}
                <span
                  aria-hidden="true"
                  className={cn(
                    'h-2 w-2 shrink-0 rounded-pill',
                    event.severity === 'critical'
                      ? 'bg-error'
                      : event.severity === 'warning'
                        ? 'bg-warning'
                        : 'bg-info',
                  )}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-sm font-medium text-text-primary">
                    {event.action}
                  </span>
                  <span className="block truncate text-caption text-text-secondary">
                    {event.actor} · {event.target}
                  </span>
                </span>
                <time
                  dateTime={event.at}
                  className="shrink-0 text-caption text-text-tertiary tabular-nums"
                >
                  {formatDate(event.at)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </AsyncSection>
    </Panel>
  );
}

export interface SignupsFeedProps extends OverviewWidgetSurface {
  entries: readonly SignupEntry[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

export function SignupsFeed({
  entries,
  isLoading,
  isError,
  onRetry,
  menu,
  className,
}: SignupsFeedProps) {
  return (
    <Panel
      title="Recent signups"
      menu={menu}
      className={className}
      description="Newest doctor and patient accounts."
      icon={UserRoundPlus}
      tone="accent"
      bodyClassName={isError ? undefined : 'p-0'}
    >
      <AsyncSection
        isLoading={isLoading}
        isError={isError}
        onRetry={onRetry}
        skeleton={<FeedSkeleton />}
      >
        {entries.length === 0 ? (
          <EmptyLine>No signups yet.</EmptyLine>
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {entries.map((entry) => (
              <li key={`${entry.role}:${entry.id}`} className="flex items-center gap-3 px-5 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body-sm font-medium text-text-primary">
                    {entry.role === 'patient' ? (
                      <MaskedIdentifier
                        subjectId={entry.id}
                        /* Non-identifying: the prompt and the audit line name
                           the account, never the person behind it. */
                        subjectLabel={`New registration ${entry.id}`}
                        kind="name"
                        value={entry.name}
                      />
                    ) : (
                      entry.name
                    )}
                  </span>
                  <span className="block text-caption capitalize text-text-tertiary">
                    {entry.role}
                  </span>
                </span>
                <StatusBadge status={entry.stateKind} label={entry.stateLabel} />
                <time
                  dateTime={entry.at}
                  className="shrink-0 text-caption text-text-tertiary tabular-nums"
                >
                  {formatDate(entry.at)}
                </time>
              </li>
            ))}
          </ul>
        )}
      </AsyncSection>
    </Panel>
  );
}

function EmptyLine({ children }: { children: string }) {
  return <p className="px-5 py-6 text-center text-body-sm text-text-tertiary">{children}</p>;
}

/** Placeholder rows in the rhythm the real ones use, so nothing shifts. */
function FeedSkeleton() {
  return (
    <div className="flex flex-col divide-y divide-border">
      {Array.from({ length: ACTIVITY_FEED_LIMIT }, (_, index) => (
        <div key={index} className="px-5 py-3">
          <Skeleton className="h-8 w-full rounded-surface" />
        </div>
      ))}
    </div>
  );
}
