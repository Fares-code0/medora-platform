import { hashString } from '@/features/shared-domain/patient-identity';

import { MOCK_NOTIFICATION_CAPABILITIES } from '../model/capabilities';
import { buildAutoReply, buildIncomingNotification } from '../model/mock-data';
import {
  MESSAGE_SEND_FAILED,
  type NotificationPatch,
  type NotificationService,
  type SendMessageInput,
} from '../model/notification-service';
import {
  localId,
  markLiveDelivered,
  readConversations,
  readNotifications,
  wasLiveDelivered,
  writeConversations,
  writeNotifications,
} from '../model/store';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type Conversation,
  type DoctorNotification,
  type NotificationBadgeCounts,
  type NotificationPreferences,
} from '../model/types';

/**
 * Mock notification service — the swappable "backend" for the
 * notification center and the shell badges. Async with realistic
 * latency over the localStorage store; every function maps 1:1 onto a
 * future endpoint (or WebSocket topic). "Realtime" is simulated by the
 * badge query's polling interval plus a one-shot deterministic delivery
 * ~45 s after first load, so unread counts visibly update everywhere.
 * Failure simulation is deterministic: chat messages containing
 * "[fail]" throw on the FIRST attempt only, so retry demonstrably
 * succeeds.
 */

const LATENCY_MS = 300;
const LIVE_DELIVERY_AFTER_MS = 45_000;

const delay = (ms: number = LATENCY_MS) => new Promise((resolve) => setTimeout(resolve, ms));

/** First-load timestamp for the one-shot live delivery (module lifetime). */
const bootedAt = Date.now();

/** The polling seam: delivers the scheduled demo notification once. */
function maybeDeliverIncoming(): void {
  if (wasLiveDelivered()) return;
  if (Date.now() - bootedAt < LIVE_DELIVERY_AFTER_MS) return;
  markLiveDelivered();
  writeNotifications([buildIncomingNotification(), ...readNotifications()]);
}

/* ── Notifications ──────────────────────────────────────────────── */

async function fetchNotifications(): Promise<readonly DoctorNotification[]> {
  await delay();
  maybeDeliverIncoming();
  return [...readNotifications()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** The bell feed: unarchived, pinned first then newest — the API's order. */
async function fetchRecent(limit: number): Promise<readonly DoctorNotification[]> {
  await delay();
  maybeDeliverIncoming();
  return readNotifications()
    .filter((notification) => !notification.archived)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.createdAt.localeCompare(a.createdAt))
    .slice(0, Math.max(0, limit));
}

/** Applies a patch to many ids at once (single-row actions pass one id). */
async function updateNotifications(
  ids: readonly string[],
  patch: NotificationPatch,
): Promise<void> {
  await delay();
  const idSet = new Set(ids);
  writeNotifications(
    readNotifications().map((notification) =>
      idSet.has(notification.id) ? { ...notification, ...patch } : notification,
    ),
  );
}

/** "Mark all as read": every unread, unarchived notification, like the API. */
async function markAllRead(): Promise<number> {
  await delay();
  let affected = 0;
  writeNotifications(
    readNotifications().map((notification) => {
      if (!notification.read && !notification.archived) {
        affected += 1;
        return { ...notification, read: true };
      }
      return notification;
    }),
  );
  return affected;
}

async function deleteNotifications(ids: readonly string[]): Promise<void> {
  await delay();
  const idSet = new Set(ids);
  writeNotifications(readNotifications().filter((notification) => !idSet.has(notification.id)));
}

/** "Clear all read": archives every read, unarchived notification. */
async function archiveAllRead(): Promise<number> {
  await delay();
  let affected = 0;
  writeNotifications(
    readNotifications().map((notification) => {
      if (notification.read && !notification.archived) {
        affected += 1;
        return { ...notification, archived: true };
      }
      return notification;
    }),
  );
  return affected;
}

/* ── Badge counts (polled by the shell) ─────────────────────────── */

async function fetchBadgeCounts(): Promise<NotificationBadgeCounts> {
  await delay(120);
  maybeDeliverIncoming();
  const notifications = readNotifications().filter(
    (notification) => !notification.read && !notification.archived,
  ).length;
  const messages = readConversations().reduce(
    (sum, conversation) => sum + conversation.unreadCount,
    0,
  );
  return { notifications, messages };
}

/* ── Preferences ────────────────────────────────────────────────── */

/**
 * Per user under the `medora.<userId>.` prefix, which the auth provider
 * wipes on logout (`clearUserPreferences`). A structured document, so it
 * lives with the feature rather than in the flat typed preferences schema.
 */
function preferencesKey(userId: string): string {
  return `medora.${userId}.notificationPreferences`;
}

function readStoredPreferences(userId: string): NotificationPreferences {
  try {
    const raw = window.localStorage.getItem(preferencesKey(userId));
    if (raw === null) return DEFAULT_NOTIFICATION_PREFERENCES;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_NOTIFICATION_PREFERENCES;
    const partial = parsed as Partial<NotificationPreferences>;
    return {
      channels: { ...DEFAULT_NOTIFICATION_PREFERENCES.channels, ...partial.channels },
      quietHours: { ...DEFAULT_NOTIFICATION_PREFERENCES.quietHours, ...partial.quietHours },
      categories: { ...DEFAULT_NOTIFICATION_PREFERENCES.categories, ...partial.categories },
    };
  } catch {
    return DEFAULT_NOTIFICATION_PREFERENCES;
  }
}

async function fetchPreferences(userId: string): Promise<NotificationPreferences> {
  await delay(120);
  return readStoredPreferences(userId);
}

/** Refuses what the API's schema refuses (422), so the demo keeps nothing the server would not. */
async function savePreferences(
  userId: string,
  preferences: NotificationPreferences,
): Promise<NotificationPreferences> {
  await delay(120);
  if (!preferences.categories.security) {
    throw Object.assign(new Error('API error: validation'), {
      kind: 'validation',
      code: 'validation_failed',
      detail: 'Security notifications cannot be turned off.',
    });
  }
  try {
    window.localStorage.setItem(preferencesKey(userId), JSON.stringify(preferences));
  } catch {
    // Storage unavailable — the demo keeps nothing, and says what it holds.
    return readStoredPreferences(userId);
  }
  return preferences;
}

/* ── Communication center ───────────────────────────────────────── */

async function fetchConversations(): Promise<readonly Conversation[]> {
  await delay();
  return readConversations();
}

async function markConversationRead(conversationId: string): Promise<void> {
  await delay(120);
  writeConversations(
    readConversations().map((conversation) =>
      conversation.id === conversationId ? { ...conversation, unreadCount: 0 } : conversation,
    ),
  );
}

/**
 * Sends a message; direct conversations get a deterministic auto-reply
 * (unread until the thread is reopened elsewhere — here we keep it read
 * since the sender is looking at the thread). Messages containing
 * "[fail]" throw on attempt 1; retries (attempt ≥ 2) always succeed.
 */
async function sendMessage(input: SendMessageInput): Promise<Conversation> {
  await delay(450);

  const failForced = input.body.toLowerCase().includes('[fail]');
  const failHash = hashString(input.body) % 100 < 8;
  if (input.attempt <= 1 && (failForced || failHash)) {
    throw new Error(MESSAGE_SEND_FAILED);
  }

  const conversations = readConversations();
  const target = conversations.find((conversation) => conversation.id === input.conversationId);
  if (!target || target.readOnly) throw new Error('CONVERSATION_NOT_WRITABLE');

  const now = new Date().toISOString();
  const withMessage: Conversation = {
    ...target,
    messages: [
      ...target.messages,
      { id: localId('msg'), from: 'me', body: input.body, at: now },
      {
        id: localId('msg'),
        from: target.name,
        body: buildAutoReply(target.name),
        at: new Date(Date.now() + 1_000).toISOString(),
      },
    ],
  };

  writeConversations(
    conversations.map((conversation) =>
      conversation.id === input.conversationId ? withMessage : conversation,
    ),
  );
  return withMessage;
}

/**
 * The mock adapter. Reached only through
 * `features/doctor/notifications/service.ts` (`docs/handoff/auth-seam.md` §1,
 * rule 3) — nothing downstream may import this module, and `service.test.ts`
 * asserts it over the source tree because a type alone does not keep a seam
 * closed.
 */
export const mockNotificationService: NotificationService = {
  capabilities: MOCK_NOTIFICATION_CAPABILITIES,

  fetchNotifications,
  fetchRecent,
  updateNotifications,
  markAllRead,
  deleteNotifications,
  archiveAllRead,
  fetchBadgeCounts,
  fetchPreferences,
  savePreferences,
  fetchConversations,
  markConversationRead,
  sendMessage,
};
