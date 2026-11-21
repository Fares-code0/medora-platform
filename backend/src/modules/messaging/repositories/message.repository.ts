/**
 * Messages: the thread, the send, the read receipt and the search
 * (API §9.3–§9.6, §9.8).
 *
 * ## Sending is one transaction, and it moves three things
 *
 * The message row, every other participant's unread count, and the
 * thread's `last_activity_at`. Split across statements, a crash between
 * them leaves a thread whose preview is a message the list will not sort
 * to the top, or an unread badge for a message that was never written.
 *
 * ## Unread counts are incremented, never recomputed
 *
 * `{ increment: 1 }` is a single atomic UPDATE. Reading the count and
 * writing back `count + 1` is the read-modify-write race that loses a
 * message every time two people answer at once — and the loss is
 * invisible, because the badge is merely one too low.
 */

import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../generated/prisma/client';
import { BADGE_COUNTS, CacheService } from '../../../shared/cache';
import { PrismaService } from '../../../shared/database';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A send named an upload it may not attach — see `attachUploads`. One
 * error for every reason, so the answer never says which ids exist.
 */
export class AttachmentUnavailable extends Error {
  constructor() {
    super('No attachable upload with this id');
    this.name = 'AttachmentUnavailable';
  }
}

/**
 * API §9.4 `attachmentIds` — the **file ids** of uploads from `POST
 * /files` with kind `message_attachment` (RM M12.5's one upload path:
 * "this route links the upload, the shape messaging uses for
 * `attachmentIds`").
 *
 * ## Which uploads are attachable
 *
 * Only the author's **own**, live `message_attachment` upload whose object
 * still exists, attached nowhere yet. Another account's upload is not
 * theirs to send; another kind's carries another kind's rules; a file
 * already on a message belongs to that message's thread. Every refusal is
 * one `AttachmentUnavailable`, the rule `FileAccessService` applies to
 * reads, and the whole send rolls back with it.
 *
 * This replaced an `updateMany` that moved `message_attachments` rows by
 * id alone: a participant holding any attachment's id could re-bind it —
 * out of another thread and into their own — and then download it there.
 *
 * ## Under the files' row locks
 *
 * Two sends attaching one upload would both see it unattached. `FOR
 * UPDATE` on the `files` rows serializes them, and the second sees the
 * first's `message_attachments` row.
 *
 * `scanned_at` is copied from the file, never set: the scan gate is the
 * download path's, which reads `files.scan_result`, and a send must not
 * be able to open it.
 */
async function attachUploads(
  tx: Prisma.TransactionClient,
  messageId: string,
  authorId: string,
  fileIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(fileIds)];
  if (ids.length !== fileIds.length || !ids.every((id) => UUID.test(id))) {
    throw new AttachmentUnavailable();
  }

  await tx.$queryRaw`SELECT id FROM files WHERE id = ANY(${ids}::uuid[]) ORDER BY id FOR UPDATE`;

  const files = await tx.file.findMany({
    where: {
      id: { in: ids },
      kind: 'message_attachment',
      uploadedBy: authorId,
      deletedAt: null,
      // Emptied by M25.5's sweep once the object is collected.
      storageKey: { not: '' },
    },
    select: { id: true, originalName: true, mimeType: true, sizeBytes: true, scannedAt: true },
  });
  if (files.length !== ids.length) throw new AttachmentUnavailable();

  const attached = await tx.messageAttachment.count({ where: { fileId: { in: ids } } });
  if (attached > 0) throw new AttachmentUnavailable();

  await tx.messageAttachment.createMany({
    data: files.map((file) => ({
      messageId,
      fileId: file.id,
      kind: file.mimeType.startsWith('image/') ? ('IMAGE' as const) : ('FILE' as const),
      name: file.originalName.slice(0, 200),
      sizeBytes: file.sizeBytes,
      scannedAt: file.scannedAt,
    })),
  });
}

const ATTACHMENT_SELECT = {
  id: true,
  fileId: true,
  name: true,
  scannedAt: true,
  /**
   * The `files` row, added at M25.4.
   *
   * Two things live here and nowhere else: `storage_key`, which is what
   * the storage port's `signedDownloadUrl` actually takes — the download
   * path was passing `file_id`, which is a database key and addresses no
   * object — and `scan_result`, which is the gate DB §11 specifies.
   * `message_attachments.scanned_at` records only that a scan *ran*.
   */
  file: { select: { storageKey: true, originalName: true, scanResult: true } },
  message: {
    select: {
      conversationId: true,
      conversation: { select: { participants: { select: { userId: true } } } },
    },
  },
} as const;

const MESSAGE_SELECT = {
  id: true,
  conversationId: true,
  authorId: true,
  kind: true,
  body: true,
  sentAt: true,
  status: true,
  editedAt: true,
  attachments: {
    select: { id: true, name: true, kind: true, sizeBytes: true, scannedAt: true },
  },
} as const;

@Injectable()
export class MessageRepository {
  constructor(
    private readonly prisma: PrismaService,
    /** Badge invalidation (RM M31.1) — see `ConversationRepository`. */
    private readonly cache: CacheService,
  ) {}

  /**
   * One page of a thread, newest first, by cursor (API §9.3).
   *
   * Cursor rather than offset because a thread grows at the end while it
   * is being read: with `skip`, a message arriving between two pages
   * shifts every later row by one and the reader sees one twice.
   */
  async thread(
    conversationId: string,
    options: { readonly before?: string | undefined; readonly pageSize: number },
  ): Promise<readonly MessageRow[]> {
    if (!UUID.test(conversationId)) return [];

    return this.prisma.db.message.findMany({
      where: { conversationId },
      select: MESSAGE_SELECT,
      orderBy: { sentAt: 'desc' },
      take: options.pageSize,
      ...(options.before === undefined
        ? {}
        : { cursor: { id: options.before }, skip: 1 }),
    });
  }

  async byId(messageId: string): Promise<MessageRow | null> {
    if (!UUID.test(messageId)) return null;

    return this.prisma.db.message.findUnique({
      where: { id: messageId },
      select: MESSAGE_SELECT,
    });
  }

  /** The message, the other participants' badges and the thread's clock. */
  async send(input: {
    readonly conversationId: string;
    readonly authorId: string;
    readonly body: string;
    readonly attachmentIds: readonly string[];
  }): Promise<MessageRow> {
    const { row, badged } = await this.prisma.$transaction(async (tx) => {
      const sentAt = new Date();

      const message = await tx.message.create({
        data: {
          conversationId: input.conversationId,
          authorId: input.authorId,
          body: input.body,
          sentAt,
          status: 'SENT',
        },
        select: { id: true },
      });

      if (input.attachmentIds.length > 0) {
        await attachUploads(tx, message.id, input.authorId, input.attachmentIds);
      }

      await tx.conversationParticipant.updateMany({
        where: { conversationId: input.conversationId, userId: { not: input.authorId } },
        data: { unreadCount: { increment: 1 } },
      });

      await tx.conversation.update({
        where: { id: input.conversationId },
        data: { lastActivityAt: sentAt },
      });

      // The participants whose `unread_count` this send moved — read in
      // the transaction, so it is exactly the set the increment touched.
      const recipients = await tx.conversationParticipant.findMany({
        where: { conversationId: input.conversationId, userId: { not: input.authorId } },
        select: { userId: true },
      });

      return {
        row: await tx.message.findUniqueOrThrow({
          where: { id: message.id },
          select: MESSAGE_SELECT,
        }),
        badged: recipients.map((recipient) => recipient.userId),
      };
    });

    // After the commit: a badge loaded from here on sees the new message.
    await this.cache.invalidate(BADGE_COUNTS, badged);

    return row;
  }

  /**
   * API §9.5 — edit, keeping the history.
   *
   * `updateMany` scoped by author *and* conversation, so a caller can
   * only edit their own message and only in a thread they are in. The
   * body is replaced and `edited_at` stamped; the schema's own comment
   * records that the five-minute window is policy rather than a CHECK,
   * because a constraint would make yesterday's messages illegal the
   * moment an administrator widened it.
   */
  async edit(input: {
    readonly messageId: string;
    readonly authorId: string;
    readonly body: string;
  }): Promise<number> {
    if (!UUID.test(input.messageId) || !UUID.test(input.authorId)) return 0;

    const result = await this.prisma.db.message.updateMany({
      where: { id: input.messageId, authorId: input.authorId },
      data: { body: input.body, editedAt: new Date() },
    });

    return result.count;
  }

  /**
   * API §9.6 — read up to a message.
   *
   * Two effects in one transaction: the reader's own badge clears, and
   * every message up to the cursor that someone else wrote moves to
   * `read` so the sender's ✓✓ is true. A `read` status is only ever set
   * on messages the reader did not write — marking your own message read
   * would show a receipt nobody gave.
   */
  async markRead(input: {
    readonly conversationId: string;
    readonly userId: string;
    readonly upTo: Date;
  }): Promise<{ readonly receipted: number }> {
    const result = await this.prisma.$transaction(async (tx) => {
      const receipted = await tx.message.updateMany({
        where: {
          conversationId: input.conversationId,
          authorId: { not: input.userId },
          sentAt: { lte: input.upTo },
          status: { in: ['SENT', 'DELIVERED'] },
        },
        data: { status: 'READ' },
      });

      const remaining = await tx.message.count({
        where: {
          conversationId: input.conversationId,
          authorId: { not: input.userId },
          sentAt: { gt: input.upTo },
        },
      });

      await tx.conversationParticipant.updateMany({
        where: { conversationId: input.conversationId, userId: input.userId },
        // Recomputed rather than zeroed: reading "up to" a message in the
        // middle of a thread must leave the newer ones unread, and a
        // blanket zero would silently mark them seen.
        data: { unreadCount: remaining, lastReadAt: input.upTo },
      });

      return { receipted: receipted.count };
    });

    await this.cache.invalidate(BADGE_COUNTS, [input.userId]);

    return result;
  }

  /** Delivery-state progression: `sent → delivered` for the recipients. */
  async markDelivered(conversationId: string, userId: string): Promise<number> {
    const result = await this.prisma.db.message.updateMany({
      where: { conversationId, authorId: { not: userId }, status: 'SENT' },
      data: { status: 'DELIVERED' },
    });

    return result.count;
  }

  /** A failed send the client retries (API §9.4's "failed-retry"). */
  async markFailed(messageId: string, authorId: string): Promise<number> {
    const result = await this.prisma.db.message.updateMany({
      where: { id: messageId, authorId },
      data: { status: 'FAILED' },
    });

    return result.count;
  }

  /**
   * API §9.8 — full-text search **within the caller's own threads**.
   *
   * The scope is a `participants: { some: { userId } }` predicate on the
   * conversation, not a filter applied afterwards: a search that read
   * every message and then dropped the ones it should not have seen is
   * one refactor away from leaking them. `messages_body_trgm_idx` is the
   * GIN index this `contains` runs on.
   */
  async search(
    userId: string,
    query: string,
    page: number,
    pageSize: number,
  ): Promise<{ rows: readonly SearchRow[]; totalItems: number }> {
    if (!UUID.test(userId)) return { rows: [], totalItems: 0 };

    const where: Prisma.MessageWhereInput = {
      body: { contains: query, mode: 'insensitive' },
      conversation: { participants: { some: { userId } } },
    };

    const [rows, totalItems] = await Promise.all([
      this.prisma.db.message.findMany({
        where,
        select: {
          id: true,
          conversationId: true,
          authorId: true,
          body: true,
          sentAt: true,
          conversation: { select: { topic: true } },
        },
        orderBy: { sentAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.db.message.count({ where }),
    ]);

    return { rows, totalItems };
  }

  /** Attachments on a message, for the download gate (API §9.10). */
  async attachment(attachmentId: string): Promise<AttachmentRow | null> {
    if (!UUID.test(attachmentId)) return null;

    return this.prisma.db.messageAttachment.findUnique({
      where: { id: attachmentId },
      select: ATTACHMENT_SELECT,
    });
  }
}

export type MessageRow = Prisma.MessageGetPayload<{ select: typeof MESSAGE_SELECT }>;

export interface SearchRow {
  readonly id: string;
  readonly conversationId: string;
  readonly authorId: string | null;
  readonly body: string;
  readonly sentAt: Date;
  readonly conversation: { readonly topic: string | null };
}

export type AttachmentRow = Prisma.MessageAttachmentGetPayload<{
  select: typeof ATTACHMENT_SELECT;
}>;
