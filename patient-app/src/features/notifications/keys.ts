import { createKeyFactory } from '@/api/query-keys';

/**
 * The notification query keys, in one place.
 *
 * There are two queries in this feature and they hold different shapes:
 * the feed is an array, the badge is a number. `NotificationsScreen`
 * already said why that matters — its optimistic rewrites are scoped to
 * `lists()` rather than the domain, because a rewrite that assumed an
 * array would corrupt a count sharing the prefix.
 *
 * That was a comment describing a query that did not exist yet. It does
 * now (O-02), so the keys move out of the screen and into a module both
 * consumers import: a second `createKeyFactory('notifications')` call
 * elsewhere would produce keys that *look* identical and invalidate
 * correctly by accident rather than by construction.
 *
 * `unreadCount` sits under `all` so `clearPhiCache`'s sweep of the
 * `notifications` prefix takes it too (T-03) — the count is not PHI, but
 * it is the previous patient's count, and it must not survive a logout
 * into the next session's tab bar.
 */
const base = createKeyFactory('notifications');

export const notificationKeys = {
  ...base,
  /** The badge count. A number, deliberately NOT under `lists()`. */
  unreadCount: () => [...base.all, 'unread-count'] as const,
  /**
   * The preference row (O-06). An object, so it is kept off `lists()`
   * for the same reason the count is — and under `all`, so the logout
   * sweep takes it: which categories the previous patient silenced is
   * not the next patient's business.
   */
  preferences: () => [...base.all, 'preferences'] as const,
};
