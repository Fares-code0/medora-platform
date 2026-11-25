import { describe, expect, it } from 'vitest';

import type { NotificationListFilters } from './filters';
import {
  countNotificationViews,
  dateGroupOf,
  filterNotifications,
  groupNotifications,
  sortNotifications,
} from './selectors';
import type { DoctorNotification } from './types';

/**
 * The inbox's views (the `?status=` param) and the day grouping of a page.
 * Grouping is presentation only: it must keep the sorted order exactly and
 * hold every row it was given, or the pagination beneath it would lie.
 */

/** Local noon `days` ago — clear of midnight, whatever the time zone. */
function daysAgo(days: number): string {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function notification(id: string, overrides: Partial<DoctorNotification> = {}): DoctorNotification {
  return {
    id,
    title: id,
    body: '',
    category: 'system',
    priority: 'normal',
    kind: 'update',
    sender: 'System',
    createdAt: daysAgo(0),
    read: false,
    archived: false,
    favorite: false,
    pinned: false,
    related: {
      patientId: null,
      patientName: null,
      recordId: null,
      labId: null,
      prescriptionId: null,
      appointmentId: null,
    },
    ...overrides,
  };
}

const filters = (status: NotificationListFilters['status']): NotificationListFilters => ({
  status,
  category: null,
  priority: null,
  kind: null,
  from: null,
  to: null,
});

const DATA: readonly DoctorNotification[] = [
  notification('unread'),
  notification('read', { read: true }),
  notification('starred', { read: true, favorite: true }),
  notification('archived', { read: true, archived: true }),
  notification('archived-starred', { archived: true, favorite: true }),
];

const ids = (rows: readonly DoctorNotification[]) => rows.map((row) => row.id);

describe('the views', () => {
  it('filters each view to what it names', () => {
    expect(ids(filterNotifications(DATA, '', filters('active')))).toEqual([
      'unread',
      'read',
      'starred',
    ]);
    expect(ids(filterNotifications(DATA, '', filters('unread')))).toEqual(['unread']);
    expect(ids(filterNotifications(DATA, '', filters('read')))).toEqual(['read', 'starred']);
    // Starred keeps a starred row after it is archived.
    expect(ids(filterNotifications(DATA, '', filters('starred')))).toEqual([
      'starred',
      'archived-starred',
    ]);
    expect(ids(filterNotifications(DATA, '', filters('archived')))).toEqual([
      'archived',
      'archived-starred',
    ]);
  });

  it('counts every view over the whole dataset', () => {
    expect(countNotificationViews(DATA)).toEqual({
      active: 3,
      unread: 1,
      read: 2,
      starred: 2,
      archived: 2,
    });
  });
});

describe('day grouping', () => {
  it('buckets by calendar day: today, yesterday, earlier this week, older', () => {
    expect(dateGroupOf(daysAgo(0))).toBe('today');
    expect(dateGroupOf(daysAgo(1))).toBe('yesterday');
    expect(dateGroupOf(daysAgo(2))).toBe('thisWeek');
    expect(dateGroupOf(daysAgo(6))).toBe('thisWeek');
    expect(dateGroupOf(daysAgo(7))).toBe('older');
    expect(dateGroupOf(daysAgo(400))).toBe('older');
  });

  const rows = [
    notification('t1', { createdAt: daysAgo(0) }),
    notification('t2', { createdAt: daysAgo(0) }),
    notification('y1', { createdAt: daysAgo(1) }),
    notification('w1', { createdAt: daysAgo(3) }),
    notification('o1', { createdAt: daysAgo(30) }),
    notification('p1', { createdAt: daysAgo(30), pinned: true }),
  ];

  it('groups newest-first into consecutive runs, pinned first, keeping every row', () => {
    const sorted = sortNotifications(rows, 'newest');
    const groups = groupNotifications(sorted, 'newest');

    expect(groups?.map((group) => group.label)).toEqual([
      'Pinned',
      'Today',
      'Yesterday',
      'Earlier this week',
      'Older',
    ]);
    expect(groups?.flatMap((group) => ids(group.notifications))).toEqual(ids(sorted));
  });

  it('reads oldest-first in the opposite order, still without dropping a row', () => {
    const sorted = sortNotifications(rows, 'oldest');
    const groups = groupNotifications(sorted, 'oldest');

    expect(groups?.map((group) => group.key)).toEqual([
      'pinned',
      'older',
      'thisWeek',
      'yesterday',
      'today',
    ]);
    expect(groups?.flatMap((group) => ids(group.notifications))).toEqual(ids(sorted));
  });

  it('does not group a priority sort, which is not by date', () => {
    expect(groupNotifications(sortNotifications(rows, 'priority'), 'priority')).toBeNull();
  });
});
