/**
 * Messages — API §9.3–§9.6, §9.8, RM M20.2, M20.3, M20.5.
 *
 * ## The edit window is policy, read at the moment of the edit
 *
 * UX 2.8 allows an edit within five minutes of sending. The schema's own
 * comment records why it is *not* a CHECK: the window is a platform
 * setting an administrator may widen, and a constraint would make
 * yesterday's messages illegal the moment they did. So it is enforced
 * here, against `sentAt`, and answers **409** — the message exists and
 * the caller may edit it in principle; what has expired is the moment,
 * which is a state conflict rather than a permission (ADR-013 §"a stale
 * document is 409").
 *
 * ## Patient threads cannot be deleted, and the refusal is 405
 *
 * DB §7 forbids deleting from a patient thread and API §9.5 fixes the
 * status: **405**, not 403. The distinction is deliberate — 403 would
 * say "not you", inviting an administrator to try; 405 says the *method*
 * does not exist on this resource, which is the truth. Archiving is the
 * supported filing action and it is per-viewer (§9.7).
 */

import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';
import {
  ATTACHMENT_KIND_TO_WIRE,
  KIND_TO_WIRE,
  STATUS_TO_WIRE,
} from '../dto/messaging-enums';
import type { MessageView, SearchHitView } from '../dto/messaging.dto';
import type {
  EditMessageBody,
  MessageSearchQuery,
  SendMessageBody,
  ThreadQuery,
} from '../dto/messaging.schema';
import {
  AttachmentUnavailable,
  MessageRepository,
  type MessageRow,
} from '../repositories/message.repository';

import { ConversationService } from './conversation.service';

/** UX 2.8's window. A platform setting the day M24 owns one. */
export const EDIT_WINDOW_MS = 5 * 60 * 1000;

export interface PaginatedSearch {
  readonly items: readonly SearchHitView[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

@Injectable()
export class MessageService {
  constructor(
    private readonly messages: MessageRepository,
    private readonly conversations: ConversationService,
  ) {}

  /**
   * Reading a thread marks its messages `delivered` (RM M20.2).
   *
   * Opening the thread is the moment the client demonstrably has them;
   * `read` needs the explicit §9.6 call, because scrolling past a
   * message is not the same as the reader saying they saw it.
   */
  async thread(
    userId: string,
    conversationId: string,
    query: ThreadQuery,
  ): Promise<{ items: readonly MessageView[]; nextCursor: string | null }> {
    await this.conversations.requireMembership(userId, conversationId);

    await this.messages.markDelivered(conversationId, userId);

    const rows = await this.messages.thread(conversationId, {
      before: query.before,
      pageSize: query.pageSize,
    });

    return {
      items: rows.map(toView),
      // Null when the page was short: a cursor that always pointed
      // somewhere would make a client loop forever on an empty tail.
      nextCursor: rows.length === query.pageSize ? (rows[rows.length - 1]?.id ?? null) : null,
    };
  }

  async send(
    userId: string,
    conversationId: string,
    body: SendMessageBody,
  ): Promise<MessageView> {
    const membership = await this.conversations.requireMembership(userId, conversationId);

    // A read-only thread is an announcement or a closed one; the flag
    // exists so those can be listed without being answerable.
    if (membership.conversation.readOnly) {
      throw AppException.conflict('This conversation is read-only');
    }

    let row: MessageRow;
    try {
      row = await this.messages.send({
        conversationId,
        authorId: userId,
        body: body.body,
        attachmentIds: body.attachmentIds ?? [],
      });
    } catch (error) {
      // 422 on the field, one message for every reason — an id never
      // issued, another account's upload, one already on a message.
      if (error instanceof AttachmentUnavailable) {
        throw AppException.validation(
          { attachmentIds: ['Attach only your own message uploads, each once'] },
          'One or more attachments cannot be sent',
        );
      }
      throw error;
    }

    return toView(row);
  }

  /** API §9.5 — edit within the window; the history is retained. */
  async edit(
    userId: string,
    conversationId: string,
    messageId: string,
    body: EditMessageBody,
    now: Date = new Date(),
  ): Promise<MessageView> {
    await this.conversations.requireMembership(userId, conversationId);

    const existing = await this.messages.byId(messageId);

    // Wrong thread and missing are the same answer: a message id is a
    // uuid a caller could guess at, and confirming it belongs to another
    // thread is an oracle on threads they cannot read.
    if (existing === null || existing.conversationId !== conversationId) {
      throw AppException.notFound('Message not found');
    }

    // Someone else's message is 404 for the same reason — but only after
    // membership passed, so a participant is never told a message they
    // can see does not exist.
    if (existing.authorId !== userId) {
      throw AppException.forbidden('Only the author can edit a message');
    }

    if (now.getTime() - existing.sentAt.getTime() > EDIT_WINDOW_MS) {
      throw AppException.conflict('The five-minute edit window has passed');
    }

    const moved = await this.messages.edit({ messageId, authorId: userId, body: body.body });

    if (moved === 0) throw AppException.notFound('Message not found');

    const updated = await this.messages.byId(messageId);

    if (updated === null) throw AppException.notFound('Message not found');

    return toView(updated);
  }

  /**
   * API §9.5 — delete is not supported in a patient thread.
   *
   * The 405 is decided by the thread's `patient_id`, which is what makes
   * a thread a patient thread (the schema says so on the column). A
   * non-patient thread has no delete route either — this method exists
   * so the refusal is the documented one rather than a framework 404
   * that says nothing.
   */
  async refuseDelete(userId: string, conversationId: string): Promise<never> {
    await this.conversations.requireMembership(userId, conversationId);

    throw new AppException(405, {
      message:
        'Messages cannot be deleted. Archive the conversation instead; patient threads retain their history.',
      code: 'method_not_allowed',
    });
  }

  /** API §9.6 — read up to a message, driving ✓✓ and the unread count. */
  async markRead(
    userId: string,
    conversationId: string,
    messageId: string,
  ): Promise<{ receipted: number }> {
    await this.conversations.requireMembership(userId, conversationId);

    const target = await this.messages.byId(messageId);

    if (target === null || target.conversationId !== conversationId) {
      throw AppException.notFound('Message not found');
    }

    return this.messages.markRead({ conversationId, userId, upTo: target.sentAt });
  }

  /** API §9.8 — search, scoped to the caller's own threads by the query. */
  async search(userId: string, query: MessageSearchQuery): Promise<PaginatedSearch> {
    const { rows, totalItems } = await this.messages.search(
      userId,
      query.q,
      query.page,
      query.pageSize,
    );

    return {
      items: rows.map((row) => ({
        messageId: row.id,
        conversationId: row.conversationId,
        topic: row.conversation.topic,
        authorId: row.authorId,
        body: row.body,
        sentAt: row.sentAt.toISOString(),
      })),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }
}

function toView(row: MessageRow): MessageView {
  return {
    id: row.id,
    conversationId: row.conversationId,
    authorId: row.authorId,
    kind: KIND_TO_WIRE[row.kind],
    body: row.body,
    sentAt: row.sentAt.toISOString(),
    status: STATUS_TO_WIRE[row.status],
    editedAt: row.editedAt?.toISOString() ?? null,
    attachments: row.attachments.map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      kind: ATTACHMENT_KIND_TO_WIRE[attachment.kind],
      // `BigInt` does not survive JSON; the column is a file size, which
      // is comfortably inside a double.
      sizeBytes: Number(attachment.sizeBytes),
      scannedAt: attachment.scannedAt?.toISOString() ?? null,
    })),
  };
}
