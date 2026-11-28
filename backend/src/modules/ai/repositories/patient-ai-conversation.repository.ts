/**
 * Patient assistant persistence (ADR-050).
 *
 * The same `ai_conversations` / `ai_messages` tables as the clinician
 * assistant, told apart by `patient_mode`: NULL on every clinician thread,
 * `general` | `personal` on a patient's. Every read and write here is keyed
 * on **both** the owner and `patientMode: { not: null }`, and the clinician
 * repository filters `patientMode: null` — so neither surface can list or
 * open the other's threads even if ownership were somehow shared.
 *
 * A patient thread never stores a patient id, chart or reference (a CHECK
 * in `20261126120000_patient_ai` makes that structural): the personal
 * mode's context is re-read from the session every turn.
 *
 * Writes touch `aiConversation` and `aiMessage` only (M16.6 containment).
 */

import { Injectable } from '@nestjs/common';

import type { AiChatRole, AiMessageStatus, Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/database';

export type PatientAiMode = 'general' | 'personal';

const PATIENT_LIVE = { deletedAt: null, patientMode: { not: null } } as const;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MESSAGE_SELECT = {
  id: true,
  role: true,
  content: true,
  status: true,
  error: true,
  escalated: true,
  createdAt: true,
} satisfies Prisma.AiMessageSelect;

const THREAD_SELECT = {
  id: true,
  title: true,
  patientMode: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { messages: true } },
} satisfies Prisma.AiConversationSelect;

const DETAIL_SELECT = {
  ...THREAD_SELECT,
  messages: { select: MESSAGE_SELECT, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.AiConversationSelect;

export type PatientThreadRow = Prisma.AiConversationGetPayload<{ select: typeof THREAD_SELECT }>;
export type PatientThreadDetailRow = Prisma.AiConversationGetPayload<{
  select: typeof DETAIL_SELECT;
}>;
export type PatientMessageRow = Prisma.AiMessageGetPayload<{ select: typeof MESSAGE_SELECT }>;

@Injectable()
export class PatientAiConversationRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(ownerId: string): Promise<readonly PatientThreadRow[]> {
    return this.prisma.db.aiConversation.findMany({
      where: { ...PATIENT_LIVE, ownerId },
      select: THREAD_SELECT,
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
  }

  detail(ownerId: string, conversationId: string): Promise<PatientThreadDetailRow | null> {
    if (!UUID.test(conversationId)) return Promise.resolve(null);
    return this.prisma.db.aiConversation.findFirst({
      where: { ...PATIENT_LIVE, id: conversationId, ownerId },
      select: DETAIL_SELECT,
    });
  }

  header(ownerId: string, conversationId: string): Promise<PatientThreadRow | null> {
    if (!UUID.test(conversationId)) return Promise.resolve(null);
    return this.prisma.db.aiConversation.findFirst({
      where: { ...PATIENT_LIVE, id: conversationId, ownerId },
      select: THREAD_SELECT,
    });
  }

  create(input: {
    readonly ownerId: string;
    readonly mode: PatientAiMode;
    readonly title: string;
  }): Promise<PatientThreadRow> {
    return this.prisma.db.aiConversation.create({
      data: {
        ownerId: input.ownerId,
        title: input.title,
        contextMode: 'GENERAL',
        patientMode: input.mode,
      },
      select: THREAD_SELECT,
    });
  }

  async rename(ownerId: string, conversationId: string, title: string): Promise<void> {
    await this.prisma.db.aiConversation.updateMany({
      where: { ...PATIENT_LIVE, id: conversationId, ownerId },
      data: { title },
    });
  }

  async softDelete(ownerId: string, conversationId: string): Promise<boolean> {
    if (!UUID.test(conversationId)) return false;
    const updated = await this.prisma.db.aiConversation.updateMany({
      where: { ...PATIENT_LIVE, id: conversationId, ownerId },
      data: { deletedAt: new Date() },
    });

    return updated.count > 0;
  }

  /** Appends a turn and touches the thread, in one transaction. */
  async appendMessage(input: {
    readonly conversationId: string;
    readonly role: AiChatRole;
    readonly content: string;
    readonly status: AiMessageStatus;
    readonly escalated?: boolean;
  }): Promise<PatientMessageRow> {
    return this.prisma.$transaction(async (tx) => {
      const message = await tx.aiMessage.create({
        data: {
          conversationId: input.conversationId,
          role: input.role,
          content: input.content,
          status: input.status,
          escalated: input.escalated ?? false,
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

  finishMessage(input: {
    readonly messageId: string;
    readonly content: string;
    readonly status: AiMessageStatus;
    readonly error: string | null;
  }): Promise<PatientMessageRow> {
    return this.prisma.db.aiMessage.update({
      where: { id: input.messageId },
      data: { content: input.content, status: input.status, error: input.error },
      select: MESSAGE_SELECT,
    });
  }

  /** The newest `limit` turns, oldest first. Escalation turns are included as said. */
  turnsFor(conversationId: string, limit: number): Promise<readonly PatientMessageRow[]> {
    return this.prisma.db.aiMessage
      .findMany({
        where: { conversationId },
        select: MESSAGE_SELECT,
        orderBy: { createdAt: 'desc' },
        take: limit,
      })
      .then((rows) => [...rows].reverse());
  }
}
