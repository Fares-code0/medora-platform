/**
 * Administrative oversight of messaging (API §9.11, DB §S4, ADR-006).
 *
 * ## Metadata and content are different tables' worth of care
 *
 * `listConversations` never selects a message body. That is not a
 * convention to remember — the select is the whole guarantee, and
 * `communications.viewMetadata` is a capability that must never expose
 * one. Content is reached only through `contentFor`, which the service
 * calls after a grant has been checked and inside the transaction that
 * writes the audit row.
 */

import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/database';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const OVERSIGHT_SELECT = {
  id: true,
  kind: true,
  topic: true,
  readOnly: true,
  lastActivityAt: true,
  createdAt: true,
  patient: { select: { publicId: true } },
  participants: { select: { userId: true } },
  _count: { select: { messages: true } },
} as const;

const FLAG_SELECT = {
  id: true,
  messageId: true,
  category: true,
  source: true,
  excerpt: true,
  status: true,
  resolution: true,
  resolutionNote: true,
  resolvedAt: true,
  createdAt: true,
} as const;

const GRANT_SELECT = {
  id: true,
  conversationId: true,
  requestedBy: true,
  justificationCategory: true,
  reason: true,
  status: true,
  approvedBy: true,
  grantedAt: true,
  expiresAt: true,
  accessRef: true,
  createdAt: true,
} as const;

@Injectable()
export class OversightRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Metadata only — no `messages.body` is reachable from this select. */
  async listConversations(
    page: number,
    pageSize: number,
  ): Promise<{ rows: readonly OversightRow[]; totalItems: number }> {
    const [rows, totalItems] = await Promise.all([
      this.prisma.db.conversation.findMany({
        select: OVERSIGHT_SELECT,
        orderBy: { lastActivityAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.db.conversation.count(),
    ]);

    return { rows, totalItems };
  }

  conversationExists(conversationId: string): Promise<number> {
    if (!UUID.test(conversationId)) return Promise.resolve(0);

    return this.prisma.db.conversation.count({ where: { id: conversationId } });
  }

  createRequest(data: Prisma.CommunicationAccessRequestUncheckedCreateInput): Promise<GrantRow> {
    return this.prisma.db.communicationAccessRequest.create({
      data,
      select: GRANT_SELECT,
    });
  }

  requestById(requestId: string): Promise<GrantRow | null> {
    if (!UUID.test(requestId)) return Promise.resolve(null);

    return this.prisma.db.communicationAccessRequest.findUnique({
      where: { id: requestId },
      select: GRANT_SELECT,
    });
  }

  /**
   * The caller's **active** grant on this conversation, if any.
   *
   * "Active" is `approved` and not yet expired, evaluated against the
   * clock passed in rather than `now()` in the database, so a test can
   * drive expiry without sleeping. A `denied`, `expired` or `terminated`
   * row is not a grant, and neither is an approved one past its window —
   * ADR-006 §4.
   */
  activeGrant(
    conversationId: string,
    adminId: string,
    now: Date,
  ): Promise<GrantRow | null> {
    if (!UUID.test(conversationId) || !UUID.test(adminId)) return Promise.resolve(null);

    return this.prisma.db.communicationAccessRequest.findFirst({
      where: {
        conversationId,
        requestedBy: adminId,
        status: 'approved',
        expiresAt: { gt: now },
      },
      orderBy: { grantedAt: 'desc' },
      select: GRANT_SELECT,
    });
  }

  approve(requestId: string, approverId: string, grantedAt: Date, expiresAt: Date): Promise<number> {
    return this.prisma.db.communicationAccessRequest
      .updateMany({
        where: { id: requestId, status: 'pending' },
        data: { status: 'approved', approvedBy: approverId, grantedAt, expiresAt },
      })
      .then((result) => result.count);
  }

  /** The bodies. Only ever called inside the audited transaction. */
  contentFor(tx: Prisma.TransactionClient, conversationId: string): Promise<readonly ContentRow[]> {
    return tx.message.findMany({
      where: { conversationId },
      select: { id: true, authorId: true, body: true, sentAt: true, editedAt: true },
      orderBy: { sentAt: 'asc' },
    });
  }

  async listFlags(
    status: string | undefined,
    page: number,
    pageSize: number,
  ): Promise<{ rows: readonly FlagRow[]; totalItems: number }> {
    const where = status === undefined ? {} : { status };

    const [rows, totalItems] = await Promise.all([
      this.prisma.db.messageFlag.findMany({
        where,
        select: FLAG_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.db.messageFlag.count({ where }),
    ]);

    return { rows, totalItems };
  }

  /**
   * Open → resolved, and only from a state that has not been resolved.
   *
   * The predicate carries the current status, so two administrators
   * resolving the same flag at once produce one write and one loser that
   * sees a 409 — rather than the second silently overwriting the first's
   * resolution note.
   */
  async resolveFlag(input: {
    readonly flagId: string;
    readonly resolvedBy: string;
    readonly resolution: string;
    readonly note: string;
  }): Promise<number> {
    if (!UUID.test(input.flagId)) return 0;

    const result = await this.prisma.db.messageFlag.updateMany({
      where: { id: input.flagId, status: { in: ['open', 'under_review'] } },
      data: {
        status: 'resolved',
        resolution: input.resolution,
        resolutionNote: input.note,
        resolvedBy: input.resolvedBy,
        resolvedAt: new Date(),
      },
    });

    return result.count;
  }

  flagById(flagId: string): Promise<FlagRow | null> {
    if (!UUID.test(flagId)) return Promise.resolve(null);

    return this.prisma.db.messageFlag.findUnique({ where: { id: flagId }, select: FLAG_SELECT });
  }
}

export type OversightRow = Prisma.ConversationGetPayload<{ select: typeof OVERSIGHT_SELECT }>;
export type FlagRow = Prisma.MessageFlagGetPayload<{ select: typeof FLAG_SELECT }>;
export type GrantRow = Prisma.CommunicationAccessRequestGetPayload<{ select: typeof GRANT_SELECT }>;

export interface ContentRow {
  readonly id: string;
  readonly authorId: string | null;
  readonly body: string;
  readonly sentAt: Date;
  readonly editedAt: Date | null;
}
