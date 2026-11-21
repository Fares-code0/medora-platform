/**
 * Messaging wire shapes (API §9).
 *
 * `participantIds` are `users.id`. That is deliberate and matches the
 * frontend's `Conversation.participantIds`: a thread is between
 * accounts, and resolving them to names is the contacts directory's job
 * (§9.9), not this projection's. Repeating names on every thread row
 * would also mean a renamed colleague was stale in every list until the
 * next write.
 */

export interface MessageAttachmentView {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly sizeBytes: number;
  /** Null until scanned. The download gate reads this, not the client. */
  readonly scannedAt: string | null;
}

export interface MessageView {
  readonly id: string;
  readonly conversationId: string;
  readonly authorId: string | null;
  readonly kind: string;
  readonly body: string;
  readonly sentAt: string;
  readonly status: string;
  /** Present and non-null is the "edited" mark UX 2.8 renders. */
  readonly editedAt: string | null;
  readonly attachments: readonly MessageAttachmentView[];
}

export interface ConversationView {
  readonly id: string;
  readonly kind: string;
  readonly topic: string | null;
  readonly participantIds: readonly string[];
  readonly patientId: string | null;
  readonly readOnly: boolean;
  readonly lastActivityAt: string;
  readonly unreadCount: number;
  readonly pinned: boolean;
  readonly starred: boolean;
  readonly archived: boolean;
  readonly muted: boolean;
  readonly draft: string;
  readonly lastMessage: {
    readonly id: string;
    readonly authorId: string | null;
    readonly body: string;
    readonly sentAt: string;
  } | null;
}

export interface SearchHitView {
  readonly messageId: string;
  readonly conversationId: string;
  readonly topic: string | null;
  readonly authorId: string | null;
  readonly body: string;
  readonly sentAt: string;
}
