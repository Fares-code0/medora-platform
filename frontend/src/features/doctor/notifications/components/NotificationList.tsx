import { useId, type ReactNode } from 'react';

import {
  Archive,
  ArchiveRestore,
  EllipsisVertical,
  Mail,
  MailOpen,
  Pin,
  PinOff,
  Star,
  Trash2,
  UserRound,
} from 'lucide-react';

import { ErrorState, Skeleton } from '@/components/feedback';
import { Checkbox, Dropdown, IconButton, type MenuEntry } from '@/components/ui';
import { useT, type TranslateFn } from '@/i18n';
import { cn } from '@/utils/cn';
import { dayDiffFromToday, formatDate, formatTime } from '@/utils/dates';

import { notificationCapabilities } from '../model/capabilities';
import type { NotificationPatch } from '../model/notification-service';
import type { NotificationGroup } from '../model/selectors';
import type { DoctorNotification } from '../model/types';

import { CategoryIcon, NotificationPriorityBadge } from './NotificationCells';

/**
 * The notification list — compact, inbox-style rows: selection, category
 * icon, title with the body on one line beneath, sender · related patient ·
 * time, a quiet unread dot, pinned/starred markers, a priority badge only
 * when the priority is not normal, and an actions menu. Rows open the detail
 * drawer.
 *
 * The whole row is the open target (the title button's hit area is
 * stretched over it), while the checkbox and the ⋯ menu sit above that
 * layer and stop their clicks — selecting or opening the menu never also
 * opens the notification.
 *
 * Grouped by day when `groups` is given (the page passes it for the date
 * sorts): each group is its own labelled list, so a screen reader hears
 * "Today, list, 4 items".
 */

export interface NotificationListProps {
  notifications: readonly DoctorNotification[];
  selectedIds: readonly string[];
  onSelectionChange: (ids: readonly string[]) => void;
  onOpen: (notification: DoctorNotification) => void;
  onPatch: (ids: readonly string[], patch: NotificationPatch) => void;
  onDelete: (notification: DoctorNotification) => void;
  loading: boolean;
  error?: { readonly title?: string; readonly onRetry?: () => void } | undefined;
  emptyState: ReactNode;
  /** Consecutive day groups of `notifications`; null/absent = one list. */
  groups?: readonly NotificationGroup[] | null | undefined;
}

function rowMenu(
  t: TranslateFn,
  notification: DoctorNotification,
  onPatch: NotificationListProps['onPatch'],
  onDelete: NotificationListProps['onDelete'],
): MenuEntry[] {
  const one = [notification.id];
  const { organize, remove } = notificationCapabilities;
  const readEntry: MenuEntry = notification.read
    ? {
        id: 'unread',
        label: t('notifications.row.markUnread'),
        icon: Mail,
        onSelect: () => onPatch(one, { read: false }),
      }
    : {
        id: 'read',
        label: t('notifications.row.markRead'),
        icon: MailOpen,
        onSelect: () => onPatch(one, { read: true }),
      };
  // Only what the service can keep is offered (`capabilities`, FE-10.8).
  if (!organize && !remove) return [readEntry];
  return [
    readEntry,
    ...organizeEntries(t, notification, onPatch, organize),
    ...(remove ? deleteEntries(t, notification, onDelete) : []),
  ];
}

function organizeEntries(
  t: TranslateFn,
  notification: DoctorNotification,
  onPatch: NotificationListProps['onPatch'],
  organize: boolean,
): MenuEntry[] {
  if (!organize) return [];
  const one = [notification.id];
  return [
    {
      id: 'favorite',
      label: notification.favorite
        ? t('notifications.row.removeFavorite')
        : t('notifications.row.addFavorite'),
      icon: Star,
      onSelect: () => onPatch(one, { favorite: !notification.favorite }),
    },
    notification.pinned
      ? {
          id: 'unpin',
          label: t('notifications.row.unpin'),
          icon: PinOff,
          onSelect: () => onPatch(one, { pinned: false }),
        }
      : {
          id: 'pin',
          label: t('notifications.row.pin'),
          icon: Pin,
          onSelect: () => onPatch(one, { pinned: true }),
        },
    notification.archived
      ? {
          id: 'unarchive',
          label: t('notifications.row.moveToInbox'),
          icon: ArchiveRestore,
          onSelect: () => onPatch(one, { archived: false }),
        }
      : {
          id: 'archive',
          label: t('notifications.row.archive'),
          icon: Archive,
          onSelect: () => onPatch(one, { archived: true }),
        },
  ];
}

function deleteEntries(
  t: TranslateFn,
  notification: DoctorNotification,
  onDelete: NotificationListProps['onDelete'],
): MenuEntry[] {
  return [
    { type: 'separator', id: 'sep' },
    {
      id: 'delete',
      label: t('notifications.row.delete'),
      icon: Trash2,
      destructive: true,
      onSelect: () => onDelete(notification),
    },
  ];
}

/** "14:30" today, else "Mar 12" — the full date and time are in the title. */
function shortTime(iso: string): string {
  return dayDiffFromToday(iso) === 0 ? formatTime(iso) : formatDate(iso);
}

function stop(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

function NotificationRow({
  notification,
  selected,
  onToggle,
  onOpen,
  onPatch,
  onDelete,
}: {
  notification: DoctorNotification;
  selected: boolean;
  onToggle: (id: string, checked: boolean) => void;
  onOpen: NotificationListProps['onOpen'];
  onPatch: NotificationListProps['onPatch'];
  onDelete: NotificationListProps['onDelete'];
}) {
  const t = useT();
  const unread = !notification.read;
  const patient = notification.related.patientName ?? notification.related.patientId;
  return (
    <li
      className={cn(
        'group relative flex items-start gap-2.5 px-3 py-2.5 transition-colors duration-fast hover:bg-surface-sunken sm:gap-3',
        selected && 'bg-primary-subtle hover:bg-primary-subtle',
      )}
      data-unread={unread ? 'true' : undefined}
    >
      <div className="relative z-10 flex h-6 items-center" onClick={stop} onKeyDown={stop}>
        <Checkbox
          aria-label={t('notifications.row.select', { title: notification.title })}
          checked={selected}
          onChange={(event) => onToggle(notification.id, event.target.checked)}
        />
      </div>

      <span aria-hidden="true" className="flex h-6 w-2 shrink-0 items-center justify-center">
        {unread ? <span className="h-2 w-2 rounded-pill bg-primary" /> : null}
      </span>

      <CategoryIcon category={notification.category} size="sm" />

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => onOpen(notification)}
            className={cn(
              'min-w-0 truncate text-start text-body-sm text-text-primary',
              // Stretch the hit area over the row; checkbox and menu sit above it.
              'before:absolute before:inset-0 before:content-[""]',
              unread ? 'font-semibold' : 'font-medium',
            )}
          >
            {notification.title}
            {unread ? <span className="sr-only"> {t('notifications.row.unread')}</span> : null}
          </button>
          {notification.pinned ? (
            <Pin
              aria-label={t('notifications.row.pinned')}
              role="img"
              className="h-3.5 w-3.5 shrink-0 text-text-secondary"
              strokeWidth={2}
            />
          ) : null}
          {notification.favorite ? (
            <Star
              aria-label={t('notifications.row.starred')}
              role="img"
              className="h-3.5 w-3.5 shrink-0 fill-current text-warning"
              strokeWidth={2}
            />
          ) : null}
          <span className="shrink-0">
            <NotificationPriorityBadge notification={notification} />
          </span>
          <time
            dateTime={notification.createdAt}
            title={`${formatDate(notification.createdAt)} ${formatTime(notification.createdAt)}`}
            className="ms-auto shrink-0 ps-2 text-caption tabular-nums text-text-tertiary"
          >
            {shortTime(notification.createdAt)}
          </time>
        </div>
        {/* Read and unread bodies share secondary: the message is content,
            not metadata, and read state is already carried by the dot and
            the title weight (text-roles.test.ts keeps tertiary for metadata). */}
        <p className="truncate text-body-sm text-text-secondary">{notification.body}</p>
        <p className="flex min-w-0 items-center gap-1.5 text-caption text-text-tertiary">
          <span className="truncate">{notification.sender}</span>
          {patient !== null ? (
            <>
              <span aria-hidden="true">·</span>
              <span className="inline-flex min-w-0 items-center gap-1 text-text-secondary">
                <UserRound aria-hidden="true" className="h-3 w-3 shrink-0" strokeWidth={2} />
                <span className="truncate">
                  <span className="sr-only">{t('notifications.row.patient')} </span>
                  {patient}
                </span>
              </span>
            </>
          ) : null}
        </p>
      </div>

      <div className="relative z-10 -my-1 shrink-0" onClick={stop} onKeyDown={stop}>
        <Dropdown
          align="end"
          menuLabel={`Actions for "${notification.title}"`}
          entries={rowMenu(t, notification, onPatch, onDelete)}
          trigger={
            <IconButton
              icon={EllipsisVertical}
              size="sm"
              aria-label={t('notifications.row.actions', { title: notification.title })}
            />
          }
        />
      </div>
    </li>
  );
}

/** Skeleton rows shaped like the compact rows they stand in for. */
function NotificationListSkeleton() {
  const t = useT();
  return (
    <div
      aria-busy="true"
      aria-label={t('notifications.loading')}
      className="divide-y divide-border overflow-hidden rounded-surface border border-border bg-surface"
    >
      {Array.from({ length: 8 }, (_, index) => (
        <div key={index} className="flex items-start gap-3 px-3 py-2.5">
          <Skeleton className="h-4 w-4 rounded-control" />
          <Skeleton className="h-6 w-6 rounded-pill" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex items-center gap-3">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="ms-auto h-3 w-10" />
            </div>
            <Skeleton className="h-3 w-4/5" />
            <Skeleton className="h-2.5 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

function GroupedList({
  group,
  renderRow,
}: {
  group: NotificationGroup;
  renderRow: (notification: DoctorNotification) => ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <h3
        id={headingId}
        className="border-b border-border bg-surface-sunken px-3 py-1.5 text-caption font-semibold uppercase tracking-wide text-text-secondary"
      >
        {group.label}
      </h3>
      <ul aria-labelledby={headingId} className="divide-y divide-border">
        {group.notifications.map(renderRow)}
      </ul>
    </section>
  );
}

export function NotificationList({
  notifications,
  selectedIds,
  onSelectionChange,
  onOpen,
  onPatch,
  onDelete,
  loading,
  error,
  emptyState,
  groups,
}: NotificationListProps) {
  const t = useT();
  if (loading) return <NotificationListSkeleton />;

  if (error) {
    return (
      <ErrorState title={error.title ?? t('notifications.error.load')} onRetry={error.onRetry} />
    );
  }

  if (notifications.length === 0) {
    return <>{emptyState}</>;
  }

  const toggleSelected = (id: string, checked: boolean) => {
    onSelectionChange(
      checked ? [...selectedIds, id] : selectedIds.filter((selected) => selected !== id),
    );
  };

  const renderRow = (notification: DoctorNotification) => (
    <NotificationRow
      key={notification.id}
      notification={notification}
      selected={selectedIds.includes(notification.id)}
      onToggle={toggleSelected}
      onOpen={onOpen}
      onPatch={onPatch}
      onDelete={onDelete}
    />
  );

  return (
    <div className="overflow-hidden rounded-surface border border-border bg-surface">
      {groups ? (
        groups.map((group) => (
          <GroupedList
            key={`${group.key}-${group.notifications[0]?.id ?? ''}`}
            group={group}
            renderRow={renderRow}
          />
        ))
      ) : (
        <ul aria-label={t('nav.notifications')} className="divide-y divide-border">
          {notifications.map(renderRow)}
        </ul>
      )}
    </div>
  );
}
