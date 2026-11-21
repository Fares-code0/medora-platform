import { History } from 'lucide-react';

import { EmptyState } from '@/components/feedback';
import { DashboardWidget } from '@/components/patterns';
import type { MenuEntry } from '@/components/ui';

import type { ActivityEntry } from '../model/mock-data';

import { NoSourceYet } from './NoSourceYet';

/**
 * Recent activity feed (UX 2.1 Row 4) — reverse-chronological record of
 * the doctor's own recent clinical work (signed notes, issued
 * prescriptions, released lab results); every row opens the module that
 * owns its kind.
 */
export function RecentActivityWidget({
  entries,
  loading = false,
  error,
  menu,
  className,
}: {
  /** Null when the source has no clinical activity feed to give; empty when there is none yet. */
  entries: readonly ActivityEntry[] | null;
  loading?: boolean;
  error?: { readonly onRetry?: () => void } | undefined;
  /** The widget's ⋯ menu, from the Overview's widget grid. */
  menu?: readonly MenuEntry[] | undefined;
  className?: string | undefined;
}) {
  return (
    <DashboardWidget
      title="Recent activity"
      menu={menu}
      className={className}
      loading={loading}
      error={error}
      empty={
        entries === null ? (
          <NoSourceYet what="a recent-activity feed" />
        ) : entries.length === 0 ? (
          <EmptyState
            icon={History}
            title="No recent activity"
            description="Notes you sign, prescriptions you issue and lab results released to you appear here."
          />
        ) : undefined
      }
    >
      <ul className="flex flex-col divide-y divide-border">
        {(entries ?? []).map((entry) => {
          const Icon = entry.icon;
          return (
            /*
              Row padding on the <li>, where `first:`/`last:` can see its
              siblings. On the <a> — the only child of its own <li>, so both
              first and last — they stripped every row to zero and the
              dividers ran straight into the text.
            */
            <li key={entry.id} className="py-3 first:pt-0 last:pb-0">
              <a href={entry.href} className="group flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-pill bg-surface-sunken text-text-secondary"
                >
                  <Icon className="h-4 w-4" strokeWidth={1.75} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-body-sm text-text-primary group-hover:underline">
                    {entry.text}
                  </p>
                  <p className="mt-0.5 text-caption text-text-tertiary">{entry.time}</p>
                </div>
              </a>
            </li>
          );
        })}
      </ul>
    </DashboardWidget>
  );
}
