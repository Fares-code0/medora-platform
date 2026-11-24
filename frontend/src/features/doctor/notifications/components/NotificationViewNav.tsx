import { Archive, Inbox, Mail, MailOpen, Star, type LucideIcon } from 'lucide-react';

import { cn } from '@/utils/cn';

import type { NotificationViewCounts } from '../model/selectors';
import {
  NOTIFICATION_STATUS_FILTERS,
  NOTIFICATION_STATUS_LABELS,
  type NotificationStatusFilter,
} from '../model/types';

/**
 * The inbox's views — Inbox, Unread, Read, Starred, Archived — each a value
 * of the existing `?status=` param. A vertical list beside the inbox on
 * large screens; a horizontally scrolling row of chips above it on small
 * ones (the row scrolls inside itself, so the page never does). Links in
 * spirit, buttons in markup: they change the list in place, and the current
 * one carries `aria-current`.
 */

const VIEW_ICONS: Record<NotificationStatusFilter, LucideIcon> = {
  active: Inbox,
  unread: Mail,
  read: MailOpen,
  starred: Star,
  archived: Archive,
};

export interface NotificationViewNavProps {
  value: NotificationStatusFilter;
  counts: NotificationViewCounts | null;
  onChange: (view: NotificationStatusFilter) => void;
  /** Hide views the service cannot keep (Starred / Archived need `organize`). */
  views?: readonly NotificationStatusFilter[];
}

export function NotificationViewNav({
  value,
  counts,
  onChange,
  views = NOTIFICATION_STATUS_FILTERS,
}: NotificationViewNavProps) {
  return (
    <nav aria-label="Notification views" className="min-w-0">
      {/* `relative` makes this scroller the containing block of the count
          pills' sr-only spans (position: absolute). Without it they resolved
          against <main> at their scrolled-off static position and widened
          the whole page by ~180px at phone widths (found in a real browser
          at 375px; NotificationViewNav.test.tsx pins the class). */}
      <ul className="relative -mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
        {views.map((view) => {
          const Icon = VIEW_ICONS[view];
          const current = view === value;
          const count = counts?.[view];
          return (
            <li key={view} className="shrink-0">
              <button
                type="button"
                aria-current={current ? 'page' : undefined}
                onClick={() => onChange(view)}
                className={cn(
                  'flex min-h-9 w-full items-center gap-2 whitespace-nowrap rounded-control px-3 py-1.5 text-body-sm transition-colors duration-fast',
                  'border lg:border-transparent',
                  current
                    ? 'border-primary bg-primary-subtle font-semibold text-primary'
                    : 'border-border text-text-secondary hover:bg-surface-sunken hover:text-text-primary',
                )}
              >
                <Icon aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={1.75} />
                <span className="lg:flex-1 lg:text-start">{NOTIFICATION_STATUS_LABELS[view]}</span>
                {count !== undefined && count > 0 ? (
                  <span
                    className={cn(
                      'rounded-pill px-1.5 text-caption tabular-nums',
                      current ? 'bg-surface text-primary' : 'bg-surface-sunken text-text-secondary',
                    )}
                  >
                    <span className="sr-only">, </span>
                    {count}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
