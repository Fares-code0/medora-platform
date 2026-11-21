import { selectService } from '@/api/seam';

import { httpNotificationService } from './http-notification-service';
import type {
  NotificationPreferences,
  NotificationService,
  PatientNotification,
} from './model/types';
import { DEFAULT_PREFERENCES } from './preferences';

/**
 * Notifications.
 *
 * ── This was blocked structurally, and ADR-030 unblocked it ──────────
 *
 * The previous revision refused every method for a reason that was not
 * about a milestone: `Notification.recipient_id` points at `User`, so a
 * patient with no user row could not receive one. That was AD-1's
 * consequence.
 *
 * ADR-030 made patients users. A patient is now a recipient like any
 * other, which is why the whole surface arrived at once and through the
 * SAME routes the doctor client uses — `/notifications`, not
 * `/me/notifications`. The feed, the badge counts and the three
 * read-state routes are all live (contract §5).
 *
 * Push registration (P5.8) is still absent and is not part of this port;
 * `push-registration.ts` documents that rather than faking it.
 *
 * Notification preferences (P5.7, M19.4) are part of this port as of
 * O-06. The fixture below holds a row in memory for the demo build; the
 * HTTP adapter reads and writes the server's row.
 */

function minutesAgo(minutes: number): string {
  const date = new Date();
  date.setMinutes(date.getMinutes() - minutes);
  return date.toISOString();
}

/**
 * Two, so a fixture build can reach page two of a feed that holds a
 * handful of rows. The real page size is twenty; what matters here is
 * that both sides of the seam page at all, not that they page alike.
 */
const FIXTURE_PAGE_SIZE = 2;

let store: PatientNotification[] = [
  {
    id: 'NT-1',
    category: 'appointments',
    priority: 'important',
    title: 'Appointment confirmed',
    body: 'The clinic confirmed one of your appointments.',
    createdAt: minutesAgo(45),
    readAt: null,
    deepLink: 'medora://appointments/APT-2001',
  },
  {
    id: 'NT-2',
    category: 'laboratory',
    priority: 'normal',
    title: 'Lab results updated',
    body: 'There is an update on one of your tests.',
    createdAt: minutesAgo(60 * 26),
    readAt: null,
    deepLink: 'medora://records/labs',
  },
  {
    id: 'NT-3',
    category: 'security',
    priority: 'critical',
    title: 'New sign-in',
    body: 'Your account was used to sign in on a new device.',
    createdAt: minutesAgo(60 * 72),
    readAt: minutesAgo(60 * 70),
    deepLink: null,
  },
];

let preferences: NotificationPreferences = DEFAULT_PREFERENCES;

const fixtureNotificationService: NotificationService = {
  async list(page = 1) {
    const sorted = [...store].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const start = (page - 1) * FIXTURE_PAGE_SIZE;
    const items = sorted.slice(start, start + FIXTURE_PAGE_SIZE);
    return {
      items,
      totalItems: sorted.length,
      hasMore: start + items.length < sorted.length,
    };
  },
  async markRead(id) {
    store = store.map((item) =>
      item.id === id && item.readAt === null ? { ...item, readAt: new Date().toISOString() } : item,
    );
  },
  async markUnread(id) {
    store = store.map((item) => (item.id === id ? { ...item, readAt: null } : item));
  },
  async markAllRead() {
    const now = new Date().toISOString();
    store = store.map((item) => (item.readAt === null ? { ...item, readAt: now } : item));
  },
  async unreadCount() {
    return store.filter((item) => item.readAt === null).length;
  },

  async getPreferences() {
    return preferences;
  },

  /**
   * Writes the row whole, the way a `PUT` does, and returns what it
   * stored rather than what it was given. A server is entitled to
   * normalise a write — and the one rule this one has, `security` on, is
   * applied here rather than trusted from the caller, so a screen that
   * ever stopped enforcing it would be corrected instead of obeyed.
   */
  async updatePreferences(next) {
    preferences = {
      ...next,
      categories: { ...next.categories, security: true },
    };
    return preferences;
  },
};

export const notificationService: NotificationService = selectService({
  fixture: fixtureNotificationService,
  http: httpNotificationService,
});
