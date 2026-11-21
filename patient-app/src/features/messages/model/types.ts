import type { MessageStatus } from '@/types/vocabularies';

/**
 * Doctor–patient messaging.
 *
 * ── Structurally blocked, and the shape says why ─────────────────────
 * `ConversationParticipant.userId -> users.id` and
 * `Message.authorId -> users.id` (`10-communication.prisma:52`). A patient
 * with no `User` row cannot be a participant, cannot be an author, and
 * cannot have unread state. This whole feature is downstream of AD-1 and
 * BE-02/BE-13 — the UI is buildable now, the wiring is not.
 *
 * ── No realtime, on purpose ──────────────────────────────────────────
 * There is no WebSocket and no SSE beyond the AI stream anywhere in this
 * project (audit AD-7). This feature polls on foreground and will lean on
 * push when it exists. Architecting around a socket that does not exist
 * would produce a client that has to be rewritten twice: once when
 * polling turns out to be what ships, and again when the socket arrives.
 *
 * ── Existing rules the client must honour ────────────────────────────
 * - Edit window <= 5 minutes, and it is a **platform setting**, not a
 *   client constant — so `canEditUntil` is a timestamp the server sends.
 * - **Delete is 405 in patient threads.** There is no delete affordance
 *   in this feature and there must not be one; archive is the operation.
 * - Attachments are `403 scan_pending` until scanned clean.
 */

export interface ConversationSummary {
  readonly id: string;
  /** The clinician's display name. */
  readonly title: string;
  readonly subtitle: string | null;
  readonly lastMessagePreview: string;
  readonly lastMessageAt: string;
  readonly unreadCount: number;
}

export interface Message {
  readonly id: string;
  readonly body: string;
  readonly sentAt: string;
  /** True when this patient wrote it. */
  readonly mine: boolean;
  readonly authorName: string;
  readonly status: MessageStatus;
  /** Server-supplied. Null when the window has passed or never applied. */
  readonly editableUntil: string | null;
  readonly editedAt: string | null;
}

export interface Conversation extends ConversationSummary {
  readonly messages: readonly Message[];
  readonly readOnly: boolean;
}

export interface MessagingService {
  listConversations(): Promise<readonly ConversationSummary[]>;
  getConversation(id: string): Promise<Conversation>;
  send(conversationId: string, body: string): Promise<Message>;
  markRead(conversationId: string): Promise<void>;
}
