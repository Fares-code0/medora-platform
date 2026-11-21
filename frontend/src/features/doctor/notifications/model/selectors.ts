import { dayDiffFromToday } from '@/utils/dates';

import type { NotificationListFilters } from './filters';
import { NOTIFICATION_PRIORITIES, type DoctorNotification } from './types';

/**
 * Pure list derivations over the notification dataset: search, facet
 * filtering, sorting, and the summary-card figures. These become
 * server-side query params when the API lands; components are unaffected
 * either way.
 */

export const NOTIFICATION_SORTS = ['newest', 'oldest', 'priority'] as const;

export type NotificationSort = (typeof NOTIFICATION_SORTS)[number];

export const NOTIFICATION_SORT_LABELS: Record<NotificationSort, string> = {
  newest: 'Newest first',
  oldest: 'Oldest first',
  priority: 'Priority',
};

export function isNotificationSort(value: string): value is NotificationSort {
  return (NOTIFICATION_SORTS as readonly string[]).includes(value);
}

/** Search across title, body, sender, and related patient name. */
function matchesQuery(notification: DoctorNotification, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (q === '') return true;
  return (
    notification.title.toLowerCase().includes(q) ||
    notification.body.toLowerCase().includes(q) ||
    notification.sender.toLowerCase().includes(q) ||
    (notification.related.patientName?.toLowerCase().includes(q) ?? false)
  );
}

const dateKey = (iso: string) => iso.slice(0, 10);

export function filterNotifications(
  notifications: readonly DoctorNotification[],
  query: string,
  filters: NotificationListFilters,
): readonly DoctorNotification[] {
  return notifications.filter((notification) => {
    if (!matchesQuery(notification, query)) return false;

    switch (filters.status) {
      case 'active':
        if (notification.archived) return false;
        break;
      case 'unread':
        if (notification.read || notification.archived) return false;
        break;
      case 'read':
        if (!notification.read || notification.archived) return false;
        break;
      case 'archived':
        if (!notification.archived) return false;
        break;
    }

    if (filters.category && notification.category !== filters.category) return false;
    if (filters.priority && notification.priority !== filters.priority) return false;
    if (filters.kind && notification.kind !== filters.kind) return false;
    const created = dateKey(notification.createdAt);
    if (filters.from && created < filters.from) return false;
    if (filters.to && created > filters.to) return false;
    return true;
  });
}

/** Pinned always first; then the selected order. */
export function sortNotifications(
  notifications: readonly DoctorNotification[],
  sort: NotificationSort,
): readonly DoctorNotification[] {
  const byDateDesc = (a: DoctorNotification, b: DoctorNotification) =>
    b.createdAt.localeCompare(a.createdAt);
  const comparator =
    sort === 'oldest'
      ? (a: DoctorNotification, b: DoctorNotification) => a.createdAt.localeCompare(b.createdAt)
      : sort === 'priority'
        ? (a: DoctorNotification, b: DoctorNotification) =>
            NOTIFICATION_PRIORITIES.indexOf(b.priority) -
              NOTIFICATION_PRIORITIES.indexOf(a.priority) || byDateDesc(a, b)
        : byDateDesc;

  return [...notifications].sort((a, b) => Number(b.pinned) - Number(a.pinned) || comparator(a, b));
}

export interface NotificationsSummary {
  readonly total: number;
  readonly unread: number;
  readonly critical: number;
  readonly today: number;
  readonly thisWeek: number;
}

/** Summary cards over the whole (unarchived) dataset, not the filtered view. */
export function summarizeNotifications(
  notifications: readonly DoctorNotification[],
): NotificationsSummary {
  let unread = 0;
  let critical = 0;
  let today = 0;
  let thisWeek = 0;
  let total = 0;

  for (const notification of notifications) {
    if (notification.archived) continue;
    total += 1;
    if (!notification.read) unread += 1;
    if (notification.priority === 'critical') critical += 1;
    const diff = dayDiffFromToday(notification.createdAt);
    if (diff === 0) today += 1;
    if (diff > -7) thisWeek += 1;
  }

  return { total, unread, critical, today, thisWeek };
}
