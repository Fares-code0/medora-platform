import type {
  Conversation,
  DoctorNotification,
  NotificationBadgeCounts,
  NotificationPreferences,
} from './types';

/**
 * The notifications port — `api/seam.ts`'s pattern, one feature, one port.
 *
 * Two adapters implement it: the session-lifetime mock, and the HTTP adapter
 * over API §10 (`http/http-notification-service.ts`, FE-10.8), which serves
 * the inbox and its flags, clear-read, preferences and the shell's badge
 * counts. What the server has
 * no route for is declared in `capabilities`, and the screens do not offer it.
 *
 * `fetchBadgeCounts` is polled by the shell; a realtime channel that
 * invalidates it is a transport change and does not alter the port.
 */

/** The port's one error contract: the message did not reach the recipient. */
export const MESSAGE_SEND_FAILED = 'MESSAGE_SEND_FAILED';

/**
 * The mutable per-notification flags. Optional per field, because each
 * control on the row writes exactly one and a patch that carried the others
 * would let "mark read" silently unpin.
 */
export type NotificationPatch = Partial<
  Pick<DoctorNotification, 'read' | 'archived' | 'favorite' | 'pinned'>
>;

export interface SendMessageInput {
  readonly conversationId: string;
  readonly body: string;
  /**
   * Which try this is. The composer's retry re-sends the same body, and the
   * mock's deterministic failure fires only on the first attempt so the retry
   * path stays demonstrable.
   */
  readonly attempt: number;
}

export interface NotificationService {
  /* ── Notifications ─────────────────────────────────────────── */
  fetchNotifications(): Promise<readonly DoctorNotification[]>;
  /** Applies a patch to many ids at once; single-row actions pass one id. */
  updateNotifications(ids: readonly string[], patch: NotificationPatch): Promise<void>;
  /**
   * "Mark all as read" — every unread, unarchived notification, in **one**
   * write, answering how many it changed. One write rather than a fan-out of
   * the ids the client happens to hold: a notification delivered between the
   * last poll and the click is still marked, and a half-applied fan-out
   * cannot leave the badge disagreeing with the rows.
   */
  markAllRead(): Promise<number>;
  deleteNotifications(ids: readonly string[]): Promise<void>;
  /**
   * "Clear all read" — archives every read, unarchived notification and
   * answers **how many it moved**, because the toast reports a number and a
   * count computed on the client would be a guess about what the write did.
   */
  archiveAllRead(): Promise<number>;

  /* ── Badge counts (polled by the shell) ────────────────────── */
  fetchBadgeCounts(): Promise<NotificationBadgeCounts>;

  /* ── Preferences (API §10.5) ───────────────────────────────── */
  /**
   * The signed-in user's delivery channels, quiet hours and category
   * opt-ins. `userId` keys the demo's per-user store; the server knows the
   * caller from the session and ignores it, as `addNote`'s author is.
   */
  fetchPreferences(userId: string): Promise<NotificationPreferences>;
  /**
   * Replaces the **whole** document and answers what was stored — a `PUT`,
   * so a channel the client left out is never read as switched off. The
   * server refuses `categories.security: false` (422).
   */
  savePreferences(
    userId: string,
    preferences: NotificationPreferences,
  ): Promise<NotificationPreferences>;

  /* ── Communication center ──────────────────────────────────── */
  fetchConversations(): Promise<readonly Conversation[]>;
  markConversationRead(conversationId: string): Promise<void>;
  /**
   * Answers the **patched conversation**, not void: the thread renders from
   * this value, and re-deriving it on the client would mean the sent message
   * and the counterpart's reply were composed twice, in two places, from two
   * clocks.
   *
   * Rejects with {@link MESSAGE_SEND_FAILED} when delivery fails.
   */
  sendMessage(input: SendMessageInput): Promise<Conversation>;

  readonly capabilities: NotificationServiceCapabilities;
}

export interface NotificationServiceCapabilities {
  /** Archive, favourite and pin — per-notification flags beyond read/unread. */
  readonly organize: boolean;
  /** Deleting a notification. */
  readonly remove: boolean;
  /** "Clear all read" — archive every read notification in one write. */
  readonly clearRead: boolean;
  /** The communication center's conversations. */
  readonly messaging: boolean;
  /**
   * Delivery channels, quiet hours and category opt-ins. The demo keeps
   * them in this browser; the API stores them per user
   * (`/me/notification-preferences`).
   */
  readonly preferences: boolean;
}
