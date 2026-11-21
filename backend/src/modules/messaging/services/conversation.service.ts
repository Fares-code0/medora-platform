/**
 * Conversations — API §9.1, §9.2, §9.7.
 *
 * ## `sent` is the one folder the database cannot answer alone
 *
 * `messaging/model/selectors.ts` defines it as "the **last** message is
 * mine". A participant predicate can narrow to threads the caller has
 * written in, but "last" is a property of the page that was read, so the
 * final filter is applied here — over the thread rows already loaded,
 * never by loading more than the page.
 *
 * ## A thread the caller is not in is a 404, not a 403
 *
 * A 403 confirms the thread exists. Messaging threads are between named
 * people about named patients, so their *existence* is the fact worth
 * protecting — the same rule ADR-022 applies to patient scope.
 */

import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';
import { CONVERSATION_KIND_TO_WIRE } from '../dto/messaging-enums';
import type { ConversationView } from '../dto/messaging.dto';
import type {
  ConversationQuery,
  CreateConversationBody,
  PatchConversationBody,
} from '../dto/messaging.schema';
import {
  ConversationRepository,
  type MembershipRow,
  type ParticipantRow,
} from '../repositories/conversation.repository';

export interface PaginatedConversations {
  readonly items: readonly ConversationView[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

@Injectable()
export class ConversationService {
  constructor(private readonly conversations: ConversationRepository) {}

  async list(userId: string, query: ConversationQuery): Promise<PaginatedConversations> {
    const { rows, totalItems } = await this.conversations.list(userId, query);

    const items = rows
      .filter((row) => (query.folder === 'sent' ? lastAuthorIs(row, userId) : true))
      .map((row) => toView(row));

    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      // `sent`'s final predicate is applied after the page is read, so
      // the total is the narrowed one for that folder. Reporting the
      // pre-filter count would promise pages that render empty.
      totalItems: query.folder === 'sent' ? items.length : totalItems,
      totalPages: Math.ceil((query.folder === 'sent' ? items.length : totalItems) / query.pageSize),
    };
  }

  /**
   * API §9.2. Every named participant must be a real, active account.
   *
   * A thread created against a deleted or suspended id would be one
   * nobody can answer, and silently dropping the id would create a
   * *different* thread from the one the caller asked for — so an
   * unknown participant is a 422 naming the count rather than the ids,
   * which would confirm which of them exist.
   */
  async create(userId: string, body: CreateConversationBody): Promise<{ id: string }> {
    const requested = [...new Set(body.participantIds)].filter((id) => id !== userId);

    if (requested.length === 0) {
      throw AppException.validation(
        { participantIds: ['A conversation needs at least one other participant'] },
        'A conversation needs at least one other participant',
      );
    }

    const existing = await this.conversations.existingUsers(requested);

    if (existing.length !== requested.length) {
      // The count, never the ids: naming which of them resolved would
      // confirm which accounts exist to a caller guessing at uuids.
      throw AppException.validation(
        { participantIds: ['One or more participants could not be found'] },
        'One or more participants could not be found',
      );
    }

    const id = await this.conversations.create({
      authorId: userId,
      participantIds: requested,
      topic: body.topic,
      patientId: body.patientId,
    });

    return { id };
  }

  /** The membership row, or 404 — every thread route starts here. */
  async requireMembership(userId: string, conversationId: string): Promise<MembershipRow> {
    const membership = await this.conversations.membership(userId, conversationId);

    if (membership === null) throw AppException.notFound('Conversation not found');

    return membership;
  }

  async patch(
    userId: string,
    conversationId: string,
    body: PatchConversationBody,
  ): Promise<void> {
    await this.requireMembership(userId, conversationId);

    // Spread rather than passed through: `exactOptionalPropertyTypes`
    // makes an explicitly-undefined field a different thing from an
    // absent one, and Prisma's update input accepts only the latter.
    const patch = Object.fromEntries(
      Object.entries(body).filter(([, value]) => value !== undefined),
    );

    const moved = await this.conversations.patchState(userId, conversationId, patch);

    if (moved === 0) throw AppException.notFound('Conversation not found');
  }
}

function lastAuthorIs(row: ParticipantRow, userId: string): boolean {
  return row.conversation.messages[0]?.authorId === userId;
}

function toView(row: ParticipantRow): ConversationView {
  const conversation = row.conversation;
  const last = conversation.messages[0];

  return {
    id: conversation.id,
    kind: CONVERSATION_KIND_TO_WIRE[conversation.kind],
    topic: conversation.topic,
    participantIds: conversation.participants.map((participant) => participant.userId),
    patientId: conversation.patientId,
    readOnly: conversation.readOnly,
    lastActivityAt: conversation.lastActivityAt.toISOString(),
    unreadCount: row.unreadCount,
    pinned: row.pinned,
    starred: row.starred,
    archived: row.archived,
    muted: row.muted,
    draft: row.draft,
    lastMessage:
      last === undefined
        ? null
        : {
            id: last.id,
            authorId: last.authorId,
            body: last.body,
            sentAt: last.sentAt.toISOString(),
          },
  };
}
