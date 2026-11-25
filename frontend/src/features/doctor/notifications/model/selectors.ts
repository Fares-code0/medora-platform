import { dayDiffFromToday } from '@/utils/dates';

import type { NotificationListFilters } from './filters';
import {
  NOTIFICATION_PRIORITIES,
  type DoctorNotification,
  type NotificationStatusFilter,
} from './types';

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
      case 'starred':
        if (!notification.favorite) return false;
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

/* ── Views ──────────────────────────────────────────────────────── */

export type NotificationViewCounts = Record<NotificationStatusFilter, number>;

/**
 * How many notifications each view holds, over the whole dataset (the
 * search and facets narrow the list, not the navigation's counts).
 */
export function countNotificationViews(
  notifications: readonly DoctorNotification[],
): NotificationViewCounts {
  const counts: NotificationViewCounts = { active: 0, unread: 0, read: 0, starred: 0, archived: 0 };
  for (const notification of notifications) {
    if (notification.favorite) counts.starred += 1;
    if (notification.archived) {
      counts.archived += 1;
      continue;
    }
    counts.active += 1;
    if (notification.read) counts.read += 1;
    else counts.unread += 1;
  }
  return counts;
}

/* ── Date grouping ──────────────────────────────────────────────── */

export type NotificationGroupKey = 'pinned' | 'today' | 'yesterday' | 'thisWeek' | 'older';

export const NOTIFICATION_GROUP_LABELS: Record<NotificationGroupKey, string> = {
  pinned: 'Pinned',
  today: 'Today',
  yesterday: 'Yesterday',
  thisWeek: 'Earlier this week',
  older: 'Older',
};

export interface NotificationGroup {
  readonly key: NotificationGroupKey;
  readonly label: string;
  readonly notifications: readonly DoctorNotification[];
}

/** The calendar bucket a notification's day falls in, relative to today. */
export function dateGroupOf(iso: string): Exclude<NotificationGroupKey, 'pinned'> {
  const diff = dayDiffFromToday(iso);
  if (diff >= 0) return 'today';
  if (diff === -1) return 'yesterday';
  if (diff > -7) return 'thisWeek';
  return 'older';
}

/**
 * Groups an already-sorted page of rows into consecutive runs: pinned rows
 * (which every sort puts first) under "Pinned", the rest by day bucket.
 * Consecutive, so the sort's order is kept exactly — "oldest first" reads
 * Older → Today — and nothing is added or dropped, which keeps the
 * pagination's counts true. A priority sort is not by date, so it is not
 * grouped: one unlabelled run.
 */
export function groupNotifications(
  rows: readonly DoctorNotification[],
  sort: NotificationSort,
): readonly NotificationGroup[] | null {
  if (sort === 'priority') return null;
  const groups: {
    key: NotificationGroupKey;
    label: string;
    notifications: DoctorNotification[];
  }[] = [];
  for (const notification of rows) {
    const key: NotificationGroupKey = notification.pinned
      ? 'pinned'
      : dateGroupOf(notification.createdAt);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.notifications.push(notification);
    else groups.push({ key, label: NOTIFICATION_GROUP_LABELS[key], notifications: [notification] });
  }
  return groups;
}
