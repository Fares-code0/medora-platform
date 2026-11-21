/**
 * The caller's own notification feed (API §10).
 *
 * ## Ownership is a WHERE clause, and it is also the index
 *
 * Every query here is scoped by `recipientId` taken from the access
 * token, and there is no path that reads a notification without it. A
 * later caller cannot forget a filter that is not optional, and a row
 * belonging to someone else is never loaded rather than loaded and then
 * rejected.
 *
 * `@@index([recipientId, createdAt(sort: Desc)])` is exactly this access
 * pattern — the feed, newest first — so the security property and the
 * fast path are the same clause.
 *
 * ## Writes are scoped the same way
 *
 * `markRead` and `markUnread` use `updateMany` with the recipient in the
 * predicate rather than `update` by id. `update` would throw a
 * `RecordNotFound` for someone else's notification, and a caller could
 * tell that apart from a genuinely missing one — an enumeration oracle on
 * a write route. `updateMany` returns a count instead, so "not yours" and
 * "no such row" are the same answer: zero.
 */

import { Injectable } from '@nestjs/common';

import type { NotificationCategory, NotificationPriority } from '../../../generated/prisma/enums';
import { BADGE_COUNTS, CacheService } from '../../../shared/cache';
import { PrismaService } from '../../../shared/database';

export interface FeedCriteria {
  readonly category?: NotificationCategory | undefined;
  readonly priority?: NotificationPriority | undefined;
  readonly status: 'active' | 'unread' | 'read' | 'archived';
  readonly q?: string | undefined;
  readonly page: number;
  readonly pageSize: number;
}

/** The mutable row flags of API §10.2, one write per control. */
export type NotificationFlag = 'archived' | 'favorite' | 'pinned';

const FEED_SELECT = {
  id: true,
  title: true,
  body: true,
  category: true,
  priority: true,
  kind: true,
  sender: true,
  readAt: true,
  archived: true,
  favorite: true,
  pinned: true,
  createdAt: true,
  patientId: true,
  recordId: true,
  labOrderId: true,
  prescriptionId: true,
  appointmentId: true,
} as const;

/** Translates the contract's `status` vocabulary into column predicates. */
function statusWhere(status: FeedCriteria['status']): Record<string, unknown> {
  switch (status) {
    case 'unread':
      return { readAt: null, archived: false };
    case 'read':
      return { readAt: { not: null }, archived: false };
    case 'archived':
      return { archived: true };
    case 'active':
    default:
      // "Active" is the default feed: everything not filed away.
      return { archived: false };
  }
}

@Injectable()
export class NotificationRepository {
  constructor(
    private readonly prisma: PrismaService,
    /**
     * Badge invalidation (RM M31.1). Every write below changes the
     * recipient's unread, unarchived set — the badge's `notifications` —
     * so each bumps that badge once it has committed.
     */
    private readonly cache: CacheService,
  ) {}

  async feed(
    recipientId: string,
    criteria: FeedCriteria,
  ): Promise<{ rows: readonly FeedRow[]; totalItems: number }> {
    if (!UUID.test(recipientId)) return { rows: [], totalItems: 0 };

    const where = {
      recipientId,
      ...statusWhere(criteria.status),
      ...(criteria.category === undefined ? {} : { category: criteria.category }),
      ...(criteria.priority === undefined ? {} : { priority: criteria.priority }),
      // Title *or* body, case-insensitively. Scoped by `recipientId`
      // above, so the scan a `contains` implies is over one caller's own
      // feed rather than the table.
      ...(criteria.q === undefined
        ? {}
        : {
            OR: [
              { title: { contains: criteria.q, mode: 'insensitive' as const } },
              { body: { contains: criteria.q, mode: 'insensitive' as const } },
            ],
          }),
    };

    const [rows, totalItems] = await Promise.all([
      this.prisma.db.notification.findMany({
        where,
        select: FEED_SELECT,
        // Pinned first (UX 2.9: critical alerts stay pinned until acted
        // on), then newest. The second key is what the index serves.
        orderBy: [{ pinned: 'desc' }, { createdAt: 'desc' }],
        skip: (criteria.page - 1) * criteria.pageSize,
        take: criteria.pageSize,
      }),
      this.prisma.db.notification.count({ where }),
    ]);

    return { rows, totalItems };
  }

  /** Returns how many rows moved — 0 for "not yours" and "no such row" alike. */
  async setRead(recipientId: string, notificationId: string, readAt: Date | null): Promise<number> {
    if (!UUID.test(recipientId) || !UUID.test(notificationId)) return 0;

    const result = await this.prisma.db.notification.updateMany({
      where: { id: notificationId, recipientId },
      data: { readAt },
    });

    if (result.count > 0) await this.cache.invalidate(BADGE_COUNTS, [recipientId]);

    return result.count;
  }

  /** Marks every unread, unarchived notification read. Returns the count. */
  async markAllRead(recipientId: string, readAt: Date): Promise<number> {
    if (!UUID.test(recipientId)) return 0;

    const result = await this.prisma.db.notification.updateMany({
      where: { recipientId, readAt: null, archived: false },
      data: { readAt },
    });

    if (result.count > 0) await this.cache.invalidate(BADGE_COUNTS, [recipientId]);

    return result.count;
  }

  /**
   * Sets one flag, scoped to the owner (API §10.2).
   *
   * The column is chosen from a closed union rather than interpolated,
   * so no caller can reach a column this route does not own — and each
   * control writes exactly one field, which is what keeps "mark read"
   * from silently unpinning.
   */
  async setFlag(
    recipientId: string,
    notificationId: string,
    flag: NotificationFlag,
    value: boolean,
  ): Promise<number> {
    if (!UUID.test(recipientId) || !UUID.test(notificationId)) return 0;

    const result = await this.prisma.db.notification.updateMany({
      where: { id: notificationId, recipientId },
      data: { [flag]: value },
    });

    if (result.count > 0) await this.cache.invalidate(BADGE_COUNTS, [recipientId]);

    return result.count;
  }

  /**
   * API §10.3 "clear-read" — archives every read, unarchived row.
   *
   * Archives rather than deletes: the frontend port names this
   * `archiveAllRead` and returns "how many it moved", and a delete would
   * make the toast's count the record of something irrecoverable.
   */
  async archiveAllRead(recipientId: string): Promise<number> {
    if (!UUID.test(recipientId)) return 0;

    const result = await this.prisma.db.notification.updateMany({
      where: { recipientId, readAt: { not: null }, archived: false },
      data: { archived: true },
    });

    if (result.count > 0) await this.cache.invalidate(BADGE_COUNTS, [recipientId]);

    return result.count;
  }

  /**
   * API §10.6 — the summary cards.
   *
   * One `groupBy` for the per-category counts rather than eight counts:
   * the cards are drawn from the same unread, unarchived set, and asking
   * the same question eight ways is the N+1 this endpoint would be
   * easiest to write as.
   */
  async summary(recipientId: string): Promise<{
    unread: number;
    critical: number;
    byCategory: Record<string, number>;
  }> {
    if (!UUID.test(recipientId)) return { unread: 0, critical: 0, byCategory: {} };

    const where = { recipientId, readAt: null, archived: false };

    const [unread, critical, grouped] = await Promise.all([
      this.prisma.db.notification.count({ where }),
      this.prisma.db.notification.count({ where: { ...where, priority: 'CRITICAL' } }),
      this.prisma.db.notification.groupBy({
        by: ['category'],
        where,
        _count: { _all: true },
      }),
    ]);

    const byCategory: Record<string, number> = {};
    for (const row of grouped) byCategory[row.category] = row._count._all;

    return { unread, critical, byCategory };
  }

  /**
   * API §10.4 — "must be O(1)-cheap", because this is the 10–15 s
   * foreground poll.
   *
   * Two indexed aggregates, run concurrently, returning integers. No row
   * is loaded and nothing is serialized beyond two numbers.
   */
  async badgeCounts(recipientId: string): Promise<{ notifications: number; messages: number }> {
    if (!UUID.test(recipientId)) return { notifications: 0, messages: 0 };

    const [notifications, messages] = await Promise.all([
      this.prisma.db.notification.count({
        where: { recipientId, readAt: null, archived: false },
      }),
      // Unread messages live on the participant row, per viewer — the
      // same table the messaging module will use. Counting it here is a
      // read of an existing column, not a second messaging model.
      this.prisma.db.conversationParticipant.aggregate({
        where: { userId: recipientId, archived: false },
        _sum: { unreadCount: true },
      }),
    ]);

    return { notifications, messages: messages._sum.unreadCount ?? 0 };
  }
}

export interface FeedRow {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly category: string;
  readonly priority: string;
  readonly kind: string;
  readonly sender: string;
  readonly readAt: Date | null;
  readonly archived: boolean;
  readonly favorite: boolean;
  readonly pinned: boolean;
  readonly createdAt: Date;
  readonly patientId: string | null;
  readonly recordId: string | null;
  readonly labOrderId: string | null;
  readonly prescriptionId: string | null;
  readonly appointmentId: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
