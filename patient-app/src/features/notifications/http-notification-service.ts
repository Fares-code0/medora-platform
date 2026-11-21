import {
  notificationEndpoints,
  type WireNotification,
  type WireNotificationPreferences,
} from '@/api/endpoints/notifications';

import type {
  NotificationPage,
  NotificationPreferences,
  NotificationService,
  PatientNotification,
} from './model/types';

/**
 * The HTTP adapter for notifications — checklist O-01, O-02.
 *
 * ── Every method here is live ────────────────────────────────────────
 *
 * Unlike doctors and appointments, this port maps onto routes that all
 * exist: the feed, the badge counts and the three read-state routes are
 * ✅ LIVE (contract §5). ADR-030 is why — it made patients users, so a
 * patient is a `notifications.recipient_id` like any other recipient and
 * one code path serves both audiences.
 *
 * What is still absent is push (P5.8, no provider). Push is not part of
 * this port at all, and `push-registration.ts` continues to document that
 * rather than fake it.
 *
 * The preferences (O-06) are live too: `GET`/`PUT
 * /me/notification-preferences` is M19.4, `@Authenticated()` so a patient
 * reaches it. They used to be the two methods here that refused by name,
 * because a preference stored only on this phone is not a preference —
 * the email it governs is sent by a server that cannot see it. Now the
 * server holds the row, and the screen reads and writes it there.
 *
 * ── The deep link is derived, and deliberately narrow ────────────────
 *
 * The wire carries `related` — a set of entity ids — and no link. This
 * client builds a `medora://` path from ONE of them: `appointmentId`.
 *
 * That is not squeamishness about the others; it is the contract's own
 * rule. `related` carries ids and never linked content, and following an
 * id has to go through a route that enforces its own authorization.
 * **"The patient was notified" must never be read as "the patient may
 * see it".** The record, lab-order and prescription routes do not exist
 * (contract §6, blocked by ADR-031), so a link to them would take a
 * patient to a screen that can only refuse — and would imply a
 * disclosure decision nobody has made. `appointmentId` is the one entity
 * this client can open today, on a route that answers 404 for anything
 * that is not the caller's.
 *
 * An id in a link is not PHI, which is why this is safe at all: the link
 * ends up in the OS notification history and a lock-screen preview, and
 * it carries `APT-3007` rather than a doctor's name or a reason.
 */

function deepLinkFor(related: WireNotification['related']): string | null {
  if (related.appointmentId !== null) {
    return `medora://appointments/${related.appointmentId}`;
  }
  return null;
}

function toNotification(wire: WireNotification): PatientNotification {
  return {
    id: wire.id,
    category: wire.category,
    priority: wire.priority,
    title: wire.title,
    body: wire.body,
    createdAt: wire.createdAt,
    readAt: wire.readAt,
    deepLink: deepLinkFor(wire.related),
  };
}

export const httpNotificationService: NotificationService = {
  /**
   * The server orders pinned first, then newest, and this adapter
   * preserves that order rather than re-sorting: "critical alerts stay
   * pinned until acted on" (UX 2.9) is a server decision, and a client
   * that sorted by `createdAt` would quietly undo it.
   */
  async list(page = 1): Promise<NotificationPage> {
    const response = await notificationEndpoints.feed({ page });
    const { items, totalItems, totalPages } = response.data;
    return {
      items: items.map(toNotification),
      totalItems,
      // The server's own arithmetic. `items.length === pageSize` would
      // claim a page after a full last one, which answers empty.
      hasMore: response.data.page < totalPages,
    };
  },

  async markRead(id): Promise<void> {
    await notificationEndpoints.markRead(id);
  },

  async markUnread(id): Promise<void> {
    await notificationEndpoints.markUnread(id);
  },

  async markAllRead(): Promise<void> {
    await notificationEndpoints.markAllRead();
  },

  /**
   * Reads the badge endpoint rather than counting the feed. The count is
   * over every unread, unarchived row the caller has; the feed is one
   * page of twenty, so counting it would under-report the badge as soon
   * as a patient had more than a page of notifications.
   */
  async unreadCount(): Promise<number> {
    const response = await notificationEndpoints.badgeCounts();
    return response.data.notifications;
  },

  async getPreferences(): Promise<NotificationPreferences> {
    return (await notificationEndpoints.preferences()).data;
  },

  /**
   * Sends every field, including the three the screen does not render
   * (`desktop`, `patients`, `ai`): a `PUT` replaces the row, and dropping a
   * field is how another client's setting silently flips. Answers the row
   * as the server stored it, which is what the cache then holds.
   */
  async updatePreferences(next): Promise<NotificationPreferences> {
    const body: WireNotificationPreferences = {
      channels: { ...next.channels },
      quietHours: { ...next.quietHours },
      categories: { ...next.categories },
    };
    return (await notificationEndpoints.putPreferences(body)).data;
  },
};
