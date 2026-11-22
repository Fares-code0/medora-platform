import { apiClient } from '@/api/client';
import {
  asRecord,
  fetchAllPages,
  LARGE_LIST_MAX_PAGES,
  malformedResponse,
  notConnected,
  readBoolean,
  readData,
  readEnum,
  readNumber,
  readOptionalString,
  readString,
} from '@/api/http';

import { HTTP_NOTIFICATION_CAPABILITIES } from '../model/capabilities';
import type { NotificationPatch, NotificationService } from '../model/notification-service';
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_KINDS,
  NOTIFICATION_PRIORITIES,
  type DoctorNotification,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationPreferences,
} from '../model/types';

/**
 * Notifications over HTTP (FE-10.8) — API §10, `backend/src/modules/notifications`.
 *
 * | Port method           | Endpoint                                                       |
 * | --------------------- | -------------------------------------------------------------- |
 * | `fetchNotifications`  | `GET /notifications` — the inbox and the archive                |
 * | `updateNotifications` | `POST /notifications/{id}/read` · `…/unread`                   |
 * |                       | `POST /notifications/{id}/archive` · `…/favorite` · `…/pin`     |
 * | `markAllRead`         | `POST /notifications/read-all`                                 |
 * | `archiveAllRead`      | `POST /notifications/clear-read`                               |
 * | `fetchBadgeCounts`    | `GET /notifications/badge-counts`                              |
 * | `fetchPreferences`    | `GET /me/notification-preferences`                             |
 * | `savePreferences`     | `PUT /me/notification-preferences`                             |
 *
 * **Branch availability.** The flags, clear-read and preferences routes are
 * served on `backend` (RM M19.3, M19.4) and not yet on `main`; an API built
 * from `main` answers 404, which reaches the screens as a failed write and
 * changes nothing. `docs/handoff/BACKEND_FRONTEND_CONTRACTS.md` §B.3.
 *
 * **Flags are explicit, never toggles.** Each takes `{ value }`: the list is
 * optimistic with rollback (DP-05), and a toggle could not be rolled back —
 * two racing clicks would settle on whichever state the second computed.
 *
 * What has no route answers as not connected — deleting a notification, and
 * the communication center's conversations (messaging is outside this
 * feature) — never as a silent success a refetch would quietly undo, and
 * `capabilities` tells the screens not to offer it.
 *
 * `related.patientName` is not served (the notification carries ids only),
 * so it is null rather than looked up.
 */

/** How many flag writes are in flight at once for a bulk action. */
const WRITE_CONCURRENCY = 6;

export function toNotification(value: unknown): DoctorNotification {
  const what = 'notification';
  const dto = asRecord(value, what);
  const related = asRecord(dto.related, 'notification.related');
  return {
    id: readString(dto, 'id', what),
    title: readString(dto, 'title', what),
    body: readString(dto, 'body', what),
    category: readEnum(dto, 'category', NOTIFICATION_CATEGORIES, what),
    priority: readEnum(dto, 'priority', NOTIFICATION_PRIORITIES, what),
    kind: readEnum(dto, 'kind', NOTIFICATION_KINDS, what),
    sender: readString(dto, 'sender', what),
    createdAt: readString(dto, 'createdAt', what),
    read: readOptionalString(dto, 'readAt', what) !== null,
    archived: readBoolean(dto, 'archived', what),
    favorite: readBoolean(dto, 'favorite', what),
    pinned: readBoolean(dto, 'pinned', what),
    related: {
      patientId: readOptionalString(related, 'patientId', 'notification.related'),
      patientName: null,
      recordId: readOptionalString(related, 'recordId', 'notification.related'),
      labId: readOptionalString(related, 'labOrderId', 'notification.related'),
      prescriptionId: readOptionalString(related, 'prescriptionId', 'notification.related'),
      appointmentId: readOptionalString(related, 'appointmentId', 'notification.related'),
    },
  };
}

const TIME_OF_DAY = /^([01]\d|2[0-3]):[0-5]\d$/;

function readTimeOfDay(record: Record<string, unknown>, key: string, what: string): string {
  const value = readString(record, key, what);
  if (!TIME_OF_DAY.test(value)) throw malformedResponse(`${what}.${key}`);
  return value;
}

/**
 * The preferences document (API §10.5), read strictly: every channel and
 * every category the client renders must be a boolean, because a switch
 * drawn from a missing field would show a default the server never stored.
 */
export function toNotificationPreferences(value: unknown): NotificationPreferences {
  const what = 'notification preferences';
  const dto = asRecord(value, what);
  const channels = asRecord(dto.channels, `${what}.channels`);
  const quietHours = asRecord(dto.quietHours, `${what}.quietHours`);
  const categories = asRecord(dto.categories, `${what}.categories`);
  return {
    channels: Object.fromEntries(
      NOTIFICATION_CHANNELS.map((channel) => [
        channel,
        readBoolean(channels, channel, `${what}.channels`),
      ]),
    ) as Record<NotificationChannel, boolean>,
    quietHours: {
      enabled: readBoolean(quietHours, 'enabled', `${what}.quietHours`),
      from: readTimeOfDay(quietHours, 'from', `${what}.quietHours`),
      to: readTimeOfDay(quietHours, 'to', `${what}.quietHours`),
    },
    categories: Object.fromEntries(
      NOTIFICATION_CATEGORIES.map((category) => [
        category,
        readBoolean(categories, category, `${what}.categories`),
      ]),
    ) as Record<NotificationCategory, boolean>,
  };
}

function listByStatus(status: 'active' | 'archived') {
  return fetchAllPages(
    (page, pageSize) => apiClient.get('/notifications', { status, page, pageSize }),
    'notifications',
    LARGE_LIST_MAX_PAGES,
  );
}

async function forEachLimited(
  ids: readonly string[],
  fn: (id: string) => Promise<unknown>,
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next] ?? '';
      next += 1;
      await fn(id);
    }
  };
  await Promise.all(Array.from({ length: Math.min(WRITE_CONCURRENCY, ids.length) }, worker));
}

type FlagWrite = (encodedId: string) => Promise<unknown>;

/**
 * One request per flag the patch names, in a fixed order. Each control
 * writes exactly one flag, so this is one request in practice; a patch that
 * named none sends nothing.
 */
function flagWrites(patch: NotificationPatch): readonly FlagWrite[] {
  const writes: FlagWrite[] = [];
  if (patch.read !== undefined) {
    const action = patch.read ? 'read' : 'unread';
    writes.push((id) => apiClient.post(`/notifications/${id}/${action}`));
  }
  const flags = [
    ['archived', 'archive'],
    ['favorite', 'favorite'],
    ['pinned', 'pin'],
  ] as const;
  for (const [key, route] of flags) {
    const value = patch[key];
    if (value !== undefined) {
      writes.push((id) => apiClient.post(`/notifications/${id}/${route}`, { value }));
    }
  }
  return writes;
}

const notConnectedMessaging = () => Promise.reject(notConnected('Messaging'));

export const httpNotificationService: NotificationService = {
  capabilities: HTTP_NOTIFICATION_CAPABILITIES,

  async fetchNotifications() {
    // The inbox view filters on `archived` itself, so both halves are read.
    const [active, archived] = await Promise.all([
      listByStatus('active'),
      listByStatus('archived'),
    ]);
    return [...active, ...archived].map(toNotification);
  },

  async updateNotifications(ids, patch) {
    const writes = flagWrites(patch);
    if (writes.length === 0) return;
    await forEachLimited(ids, async (id) => {
      for (const write of writes) await write(encodeURIComponent(id));
    });
  },

  async markAllRead() {
    const data = asRecord(
      readData(await apiClient.post('/notifications/read-all'), 'mark all read'),
      'mark all read',
    );
    return readNumber(data, 'updated', 'mark all read');
  },

  deleteNotifications() {
    return Promise.reject(notConnected('Deleting notifications'));
  },

  async archiveAllRead() {
    const data = asRecord(
      readData(await apiClient.post('/notifications/clear-read'), 'clear read'),
      'clear read',
    );
    return readNumber(data, 'archived', 'clear read');
  },

  async fetchBadgeCounts() {
    const data = asRecord(
      readData(await apiClient.get('/notifications/badge-counts'), 'badge counts'),
      'badge counts',
    );
    return {
      notifications: readNumber(data, 'notifications', 'badge counts'),
      messages: readNumber(data, 'messages', 'badge counts'),
    };
  },

  async fetchPreferences() {
    return toNotificationPreferences(
      readData(await apiClient.get('/me/notification-preferences'), 'notification preferences'),
    );
  },

  async savePreferences(_userId, preferences) {
    return toNotificationPreferences(
      readData(
        await apiClient.put('/me/notification-preferences', preferences),
        'notification preferences',
      ),
    );
  },

  fetchConversations: notConnectedMessaging,
  markConversationRead: notConnectedMessaging,
  sendMessage: notConnectedMessaging,
};
