import { CalendarPlus } from 'lucide-react';

import { EmptyState } from '@/components/feedback';
import { DashboardWidget, StatusBadge } from '@/components/patterns';
import { Avatar, LinkButton, type MenuEntry } from '@/components/ui';
import { routes } from '@/routes';
import { cn } from '@/utils/cn';

import type { ScheduleEntry } from '../model/mock-data';

/**
 * Today's schedule — the "upcoming appointments" widget (UX 2.1 Row 2).
 * Placeholder rendering of the timeline: time · patient · visit type ·
 * status; the next upcoming appointment is highlighted primary-subtle.
 * The full interactive timeline (current-time line, start consultation)
 * lands with the appointments feature in Phase 7.
 */

function ScheduleRow({ entry }: { entry: ScheduleEntry }) {
  return (
    <li
      className={cn(
        'flex items-center gap-3 rounded-surface px-3 py-2.5',
        entry.isNext && 'bg-primary-subtle',
      )}
    >
      <span className="w-12 shrink-0 font-mono text-body-sm text-text-secondary tabular-nums">
        {entry.time}
      </span>
      <Avatar name={entry.patientName} size="sm" decorative />
      <div className="min-w-0 flex-1">
        <p className="truncate text-body-sm font-medium text-text-primary">
          {entry.patientName}
          <span className="font-normal text-text-tertiary"> · {String(entry.patientAge)}</span>
        </p>
        {entry.isNext ? <p className="text-caption text-primary">Up next</p> : null}
      </div>
      {/* The visit type is plain metadata, not a status: no pill. */}
      <span className="hidden whitespace-nowrap text-caption text-text-tertiary sm:inline">
        {entry.visitType}
      </span>
      <StatusBadge status={entry.status} label={entry.statusLabel} />
    </li>
  );
}

export function ScheduleWidget({
  entries,
  loading = false,
  error,
  menu,
  className,
}: {
  entries: readonly ScheduleEntry[];
  loading?: boolean;
  error?: { readonly onRetry?: () => void } | undefined;
  /** The widget's ⋯ menu, from the Overview's widget grid. */
  menu?: readonly MenuEntry[] | undefined;
  className?: string | undefined;
}) {
  return (
    <DashboardWidget
      title="Today's schedule"
      // No count until there is a list to count: a failed load is not "0".
      subtitle={
        loading || error !== undefined
          ? undefined
          : `${String(entries.length)} ${entries.length === 1 ? 'appointment' : 'appointments'}`
      }
      menu={menu}
      className={className}
      loading={loading}
      error={error}
      actions={
        <LinkButton href={routes.doctor.appointments} variant="ghost" size="sm">
          View all
        </LinkButton>
      }
      empty={
        entries.length === 0 ? (
          <EmptyState
            icon={CalendarPlus}
            title="No appointments today"
            description="Your schedule will appear here."
            action={
              <LinkButton href={routes.doctor.settings('preferences')} variant="secondary">
                Set availability
              </LinkButton>
            }
          />
        ) : undefined
      }
    >
      <ul className="-mx-3 flex flex-col">
        {entries.map((entry) => (
          <ScheduleRow key={entry.id} entry={entry} />
        ))}
      </ul>
    </DashboardWidget>
  );
}
