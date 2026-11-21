import type { ReactNode } from 'react';

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
} from 'lucide-react';

import { ErrorState, Skeleton } from '@/components/feedback';
import { Checkbox, Dropdown, IconButton, type MenuEntry } from '@/components/ui';
import { cn } from '@/utils/cn';
import { formatDate, formatTime, relativeDayLabel } from '@/utils/dates';

import { notificationCapabilities } from '../model/capabilities';
import type { NotificationPatch } from '../model/notification-service';
import type { DoctorNotification } from '../model/types';

import { CategoryIcon, NotificationPriorityBadge } from './NotificationCells';

/**
 * The notification list — semantic <ul> rows with per-row selection,
 * unread emphasis, pinned/favorite markers, an actions menu, and the
 * standard loading/error/empty contract. Rows open the detail drawer.
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
}

function rowMenu(
  notification: DoctorNotification,
  onPatch: NotificationListProps['onPatch'],
  onDelete: NotificationListProps['onDelete'],
): MenuEntry[] {
  const one = [notification.id];
  const { organize, remove } = notificationCapabilities;
  const readEntry: MenuEntry = notification.read
    ? {
        id: 'unread',
        label: 'Mark as unread',
        icon: Mail,
        onSelect: () => onPatch(one, { read: false }),
      }
    : {
        id: 'read',
        label: 'Mark as read',
        icon: MailOpen,
        onSelect: () => onPatch(one, { read: true }),
      };
  // Only what the service can keep is offered (`capabilities`, FE-10.8).
  if (!organize && !remove) return [readEntry];
  return [
    readEntry,
    ...organizeEntries(notification, onPatch, organize),
    ...(remove ? deleteEntries(notification, onDelete) : []),
  ];
}

function organizeEntries(
  notification: DoctorNotification,
  onPatch: NotificationListProps['onPatch'],
  organize: boolean,
): MenuEntry[] {
  if (!organize) return [];
  const one = [notification.id];
  return [
    {
      id: 'favorite',
      label: notification.favorite ? 'Remove favorite' : 'Add to favorites',
      icon: Star,
      onSelect: () => onPatch(one, { favorite: !notification.favorite }),
    },
    notification.pinned
      ? {
          id: 'unpin',
          label: 'Unpin',
          icon: PinOff,
          onSelect: () => onPatch(one, { pinned: false }),
        }
      : {
          id: 'pin',
          label: 'Pin to top',
          icon: Pin,
          onSelect: () => onPatch(one, { pinned: true }),
        },
    notification.archived
      ? {
          id: 'unarchive',
          label: 'Move to inbox',
          icon: ArchiveRestore,
          onSelect: () => onPatch(one, { archived: false }),
        }
      : {
          id: 'archive',
          label: 'Archive',
          icon: Archive,
          onSelect: () => onPatch(one, { archived: true }),
        },
  ];
}

function deleteEntries(
  notification: DoctorNotification,
  onDelete: NotificationListProps['onDelete'],
): MenuEntry[] {
  return [
    { type: 'separator', id: 'sep' },
    {
      id: 'delete',
      label: 'Delete',
      icon: Trash2,
      destructive: true,
      onSelect: () => onDelete(notification),
    },
  ];
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
}: NotificationListProps) {
  if (loading) {
    return (
      <div aria-busy="true" className="flex flex-col gap-2">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-20 w-full rounded-surface" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState title={error.title ?? "Couldn't load notifications"} onRetry={error.onRetry} />
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

  return (
    <ul className="flex flex-col gap-2" aria-label="Notifications">
      {notifications.map((notification) => {
        const selected = selectedIds.includes(notification.id);
        return (
          <li key={notification.id}>
            <div
              className={cn(
                'flex items-start gap-3 rounded-surface border px-3 py-3 transition-colors duration-fast',
                notification.read
                  ? 'border-border bg-surface'
                  : 'border-border-strong bg-primary-subtle',
                selected && 'border-primary',
              )}
            >
              <div className="mt-1" onClick={(event) => event.stopPropagation()}>
                <Checkbox
                  aria-label={`Select "${notification.title}"`}
                  checked={selected}
                  onChange={(event) => toggleSelected(notification.id, event.target.checked)}
                />
              </div>

              <CategoryIcon category={notification.category} />

              <button
                type="button"
                onClick={() => onOpen(notification)}
                className="min-w-0 flex-1 text-start"
              >
                <span className="flex flex-wrap items-center gap-2">
                  {!notification.read ? (
                    <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-pill bg-primary" />
                  ) : null}
                  <span
                    className={cn(
                      'truncate text-body-sm text-text-primary',
                      notification.read ? 'font-medium' : 'font-semibold',
                    )}
                  >
                    {notification.title}
                  </span>
                  {!notification.read ? <span className="sr-only">Unread.</span> : null}
                  {notification.pinned ? (
                    <Pin
                      aria-label="Pinned"
                      role="img"
                      className="h-3.5 w-3.5 shrink-0 text-text-tertiary"
                      strokeWidth={2}
                    />
                  ) : null}
                  {notification.favorite ? (
                    <Star
                      aria-label="Favorite"
                      role="img"
                      className="h-3.5 w-3.5 shrink-0 text-warning"
                      strokeWidth={2}
                    />
                  ) : null}
                  <NotificationPriorityBadge notification={notification} />
                </span>
                <span className="mt-0.5 block truncate text-body-sm text-text-secondary">
                  {notification.body}
                </span>
                <span className="mt-1 block text-caption tabular-nums text-text-tertiary">
                  {notification.sender} · {formatDate(notification.createdAt)} ·{' '}
                  {formatTime(notification.createdAt)} · {relativeDayLabel(notification.createdAt)}
                </span>
              </button>

              <div onClick={(event) => event.stopPropagation()}>
                <Dropdown
                  align="end"
                  menuLabel={`Actions for "${notification.title}"`}
                  entries={rowMenu(notification, onPatch, onDelete)}
                  trigger={
                    <IconButton
                      icon={EllipsisVertical}
                      size="sm"
                      aria-label={`Actions for "${notification.title}"`}
                    />
                  }
                />
              </div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
