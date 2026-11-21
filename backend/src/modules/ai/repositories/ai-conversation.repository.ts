/**
 * Assistant persistence (RM M16.2, M16.5, DB §H1–H4).
 *
 * ## Containment is structural here, and it is the point (M16.6)
 *
 * > "The AI module has **no write access to clinical tables**. Saving to
 * > a record happens only through M12.6 notes with `aiAssisted: true`."
 *
 * Every write below names `aiConversation`, `aiMessage` or
 * `aiUserSetting`. There is no method on this class that writes a
 * clinical table, and the clinical reads that do exist —
 * `ai-context.repository.ts` — are a separate class with no write
 * methods at all, so "the assistant cannot write to a chart" is
 * something a reader can check by looking rather than something a
 * comment promises. `ai-containment.spec.ts` asserts it mechanically,
 * against the source, so a later edit cannot quietly add one.
 *
 * ## Soft delete, because a patient-bound thread carries PHI
 *
 * DB §7 makes `ai_conversations` soft-delete and the schema's own
 * comment says why. `deletedAt` is filtered on every read, so a deleted
 * thread is gone from the API while the row — and the audit trail of
 * what was asked about a patient — survives.
 */

import { Injectable } from '@nestjs/common';

import type {
  AiChatRole,
  AiContextMode,
  AiMessageStatus,
  Prisma,
} from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/database';

/** Live rows only. Repeated as a constant so no read can forget it. */
const LIVE = { deletedAt: null } as const;

/**
 * The shape of `ai_conversations.id`. A path parameter that is not one
 * names no thread — answered "not found" here, as every other repository
 * does, rather than handed to PostgreSQL as a uuid cast that fails with a
 * 500 (API contract audit, 2026-11-14).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MESSAGE_SELECT = {
  id: true,
  role: true,
  content: true,
  status: true,
  error: true,
  feedback: true,
  createdAt: true,
} satisfies Prisma.AiMessageSelect;

const CONVERSATION_SELECT = {
  id: true,
  title: true,
  contextMode: true,
  refPublicId: true,
  favorite: true,
  createdAt: true,
  updatedAt: true,
  patient: { select: { publicId: true, fullName: true } },
  _count: { select: { messages: true } },
} satisfies Prisma.AiConversationSelect;

const DETAIL_SELECT = {
  ...CONVERSATION_SELECT,
  messages: { select: MESSAGE_SELECT, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.AiConversationSelect;

export type ConversationRow = Prisma.AiConversationGetPayload<{
  select: typeof CONVERSATION_SELECT;
}>;
export type ConversationDetailRow = Prisma.AiConversationGetPayload<{
  select: typeof DETAIL_SELECT;
}>;
export type MessageRow = Prisma.AiMessageGetPayload<{ select: typeof MESSAGE_SELECT }>;

const HEADER_SELECT = {
  id: true,
  title: true,
  contextMode: true,
  refPublicId: true,
  patient: { select: { publicId: true } },
} satisfies Prisma.AiConversationSelect;

export type HeaderRow = Prisma.AiConversationGetPayload<{ select: typeof HEADER_SELECT }>;

@Injectable()
export class AiConversationRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** API §11.1 — the caller's own threads, newest activity first. */
  list(
    ownerId: string,
    criteria: { readonly q?: string | undefined; readonly favorite?: boolean | undefined },
  ): Promise<readonly ConversationRow[]> {
    return this.prisma.db.aiConversation.findMany({
      where: {
        ...LIVE,
        // Ownership, not care scope. A thread belongs to the doctor who
        // opened it; a colleague sharing the patient has no business
        // reading their working notes with an assistant.
        ownerId,
        ...(criteria.favorite === undefined ? {} : { favorite: criteria.favorite }),
        ...(criteria.q === undefined
          ? {}
          : {
              // Title only. Searching message bodies would make `?q=`
              // a PHI search surface across every thread the caller
              // owns, and the frontend's own list filters on title.
              title: { contains: criteria.q, mode: 'insensitive' as const },
            }),
      },
      select: CONVERSATION_SELECT,
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
  }

  /** API §11.2 — one thread with its turns. */
  detail(ownerId: string, conversationId: string): Promise<ConversationDetailRow | null> {
    if (!UUID.test(conversationId)) return Promise.resolve(null);
    return this.prisma.db.aiConversation.findFirst({
      where: { ...LIVE, id: conversationId, ownerId },
      select: DETAIL_SELECT,
    });
  }

  /**
   * The header, for a check before a write.
   *
   * The patient comes back as its **handle**, not its uuid, because the
   * only consumer is `AiContextService.reresolve`, which speaks the same
   * `{ mode, patientId, refId }` vocabulary the client does — passing it
   * a uuid would mean translating back at the call site, which is where
   * a `PT-…` and a uuid get confused.
   */
  header(ownerId: string, conversationId: string): Promise<HeaderRow | null> {
    if (!UUID.test(conversationId)) return Promise.resolve(null);
    return this.prisma.db.aiConversation.findFirst({
      where: { ...LIVE, id: conversationId, ownerId },
      select: HEADER_SELECT,
    });
  }

  /** API §11.1 — `POST /ai/conversations`. */
  create(input: {
    readonly ownerId: string;
    readonly title: string;
    readonly contextMode: AiContextMode;
    readonly patientId: string | null;
    readonly refPublicId: string | null;
  }): Promise<ConversationDetailRow> {
    return this.prisma.db.aiConversation.create({
      data: {
        ownerId: input.ownerId,
        title: input.title,
        contextMode: input.contextMode,
        ...(input.patientId === null ? {} : { patientId: input.patientId }),
        ...(input.refPublicId === null ? {} : { refPublicId: input.refPublicId }),
      },
      select: DETAIL_SELECT,
    });
  }

  /** API §11.1 — `PATCH …/{id}`. Title and favourite only; see the schema. */
  async update(
    ownerId: string,
    conversationId: string,
    patch: { readonly title?: string | undefined; readonly favorite?: boolean | undefined },
  ): Promise<ConversationDetailRow | null> {
    if (!UUID.test(conversationId)) return null;
    const updated = await this.prisma.db.aiConversation.updateMany({
      where: { ...LIVE, id: conversationId, ownerId },
      data: {
        ...(patch.title === undefined ? {} : { title: patch.title }),
        ...(patch.favorite === undefined ? {} : { favorite: patch.favorite }),
      },
    });

    if (updated.count === 0) return null;

    return this.detail(ownerId, conversationId);
  }

  /**
   * API §11.1 — `DELETE …/{id}`, soft.
   *
   * `updateMany` on the base client rather than `db.delete`: the
   * soft-delete extension would do the same thing, and writing it out
   * here keeps the one place a thread disappears visible. Returns
   * whether a row was actually hidden, so a second delete answers 404
   * rather than reporting success for nothing.
   */
  async softDelete(ownerId: string, conversationId: string): Promise<boolean> {
    if (!UUID.test(conversationId)) return false;
    const updated = await this.prisma.db.aiConversation.updateMany({
      where: { ...LIVE, id: conversationId, ownerId },
      data: { deletedAt: new Date() },
    });

    return updated.count > 0;
  }

  /**
   * Appends a turn and touches the thread, in one transaction.
   *
   * `updatedAt` is what the list orders by, so a thread whose message
   * landed but whose timestamp did not would sink down the sidebar
   * while holding the newest answer.
   */
  async appendMessage(input: {
    readonly conversationId: string;
    readonly role: AiChatRole;
    readonly content: string;
    readonly status: AiMessageStatus;
    readonly error: string | null;
  }): Promise<MessageRow> {
    return this.prisma.$transaction(async (tx) => {
      const message = await tx.aiMessage.create({
        data: {
          conversationId: input.conversationId,
          role: input.role,
          content: input.content,
          status: input.status,
          ...(input.error === null ? {} : { error: input.error }),
        },
        select: MESSAGE_SELECT,
      });

      await tx.aiConversation.update({
        where: { id: input.conversationId },
        data: { updatedAt: new Date() },
      });

      return message;
    });
  }

  /** Replaces a streamed answer's body once the stream ends. */
  finishMessage(input: {
    readonly messageId: string;
    readonly content: string;
    readonly status: AiMessageStatus;
    readonly error: string | null;
  }): Promise<MessageRow> {
    return this.prisma.db.aiMessage.update({
      where: { id: input.messageId },
      data: {
        content: input.content,
        status: input.status,
        error: input.error,
      },
      select: MESSAGE_SELECT,
    });
  }

  /** The turns to send the model, oldest first. */
  turnsFor(conversationId: string, limit: number): Promise<readonly MessageRow[]> {
    return this.prisma.db.aiMessage
      .findMany({
        where: { conversationId },
        select: MESSAGE_SELECT,
        // Newest `limit` turns, then reversed: a long thread sends the
        // model its recent history, not its opening. Taking the oldest
        // would give the model the least relevant window.
        orderBy: { createdAt: 'desc' },
        take: limit,
      })
      .then((rows) => [...rows].reverse());
  }

  /**
   * API §11.7 — the thumbs.
   *
   * Scoped through the owning conversation rather than by message id
   * alone: a message id is a uuid a caller could otherwise guess at, and
   * rating someone else's answer would write to a thread they cannot
   * read.
   */
  async rateMessage(
    ownerId: string,
    messageId: string,
    rating: number,
  ): Promise<MessageRow | null> {
    const updated = await this.prisma.db.aiMessage.updateMany({
      where: {
        id: messageId,
        // Only an assistant turn can be rated: a thumb on the doctor's
        // own question is a rating of themselves.
        role: 'ASSISTANT',
        conversation: { ownerId, deletedAt: null },
      },
      data: { feedback: rating },
    });

    if (updated.count === 0) return null;

    return this.prisma.db.aiMessage.findUnique({
      where: { id: messageId },
      select: MESSAGE_SELECT,
    });
  }
}
