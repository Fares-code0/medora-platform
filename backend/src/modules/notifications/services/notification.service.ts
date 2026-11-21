/**
 * The notification feed (API §10.1–10.4).
 *
 * Self-scoped for every role: the recipient is the token's subject, so a
 * doctor and a patient run the same code path over the same table. That
 * is what "one notification model" means in practice.
 */

import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';
import { BADGE_COUNTS, CacheService } from '../../../shared/cache';
import type {
  NotificationCategory,
  NotificationKind,
  NotificationPriority,
} from '../../../generated/prisma/enums';
import {
  categoryToWire,
  CATEGORY_FROM_WIRE,
  CATEGORY_VALUES,
  kindToWire,
  priorityToWire,
  PRIORITY_FROM_WIRE,
} from '../dto/notification-enums';
import type { BadgeCounts, NotificationView } from '../dto/notification.dto';
import type { NotificationQuery } from '../dto/notification.schema';
import {
  NotificationRepository,
  type FeedRow,
  type NotificationFlag,
} from '../repositories/notification.repository';

/** API §10.6 — unread, critical and the per-category breakdown. */
export interface NotificationSummary {
  readonly unread: number;
  readonly critical: number;
  readonly byCategory: Record<string, number>;
}

export interface PaginatedNotifications {
  readonly items: readonly NotificationView[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

@Injectable()
export class NotificationService {
  constructor(
    private readonly notifications: NotificationRepository,
    private readonly cache: CacheService,
  ) {}

  async feed(recipientId: string, query: NotificationQuery): Promise<PaginatedNotifications> {
    const { rows, totalItems } = await this.notifications.feed(recipientId, {
      category: query.category === undefined ? undefined : CATEGORY_FROM_WIRE[query.category],
      priority: query.priority === undefined ? undefined : PRIORITY_FROM_WIRE[query.priority],
      status: query.status,
      q: query.q,
      page: query.page,
      pageSize: query.pageSize,
    });

    return {
      items: rows.map(toView),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }

  /**
   * Idempotent by design: marking an already-read notification read
   * succeeds. The client is optimistic (API §10.2 — "optimistic client,
   * rollback on failure"), so a retry after a flaky connection must not
   * produce an error the UI then rolls back a correct state for.
   *
   * A row that is not the caller's produces the same 404 as one that does
   * not exist — the repository's `updateMany` cannot tell them apart, and
   * that is the point.
   */
  async markRead(recipientId: string, notificationId: string): Promise<void> {
    const moved = await this.notifications.setRead(recipientId, notificationId, new Date());

    if (moved === 0) throw AppException.notFound('Notification not found');
  }

  async markUnread(recipientId: string, notificationId: string): Promise<void> {
    const moved = await this.notifications.setRead(recipientId, notificationId, null);

    if (moved === 0) throw AppException.notFound('Notification not found');
  }

  /** API §10.3. Returns the count so the client can reconcile its badge. */
  async markAllRead(recipientId: string): Promise<{ updated: number }> {
    return { updated: await this.notifications.markAllRead(recipientId, new Date()) };
  }

  /**
   * API §10.2 — archive, favorite and pin.
   *
   * Idempotent for the same reason `markRead` is: the client is
   * optimistic, so archiving an already-archived row must succeed rather
   * than produce an error the UI rolls a correct state back for.
   */
  async setFlag(
    recipientId: string,
    notificationId: string,
    flag: NotificationFlag,
    value: boolean,
  ): Promise<void> {
    const moved = await this.notifications.setFlag(recipientId, notificationId, flag, value);

    if (moved === 0) throw AppException.notFound('Notification not found');
  }

  /**
   * API §10.3 — "clear read".
   *
   * The count is the answer, not a side effect: the frontend port's
   * `archiveAllRead` returns "how many it moved" because the toast
   * reports a number, and a count computed on the client would be a
   * guess about what the write did.
   */
  async clearRead(recipientId: string): Promise<{ archived: number }> {
    return { archived: await this.notifications.archiveAllRead(recipientId) };
  }

  /** API §10.6 — the summary cards. */
  async summary(recipientId: string): Promise<NotificationSummary> {
    const counts = await this.notifications.summary(recipientId);

    // Every category is present, including the zeroes: a card that
    // disappeared when its count reached zero would make the row jump
    // as notifications are read.
    const byCategory: Record<string, number> = {};
    for (const wire of CATEGORY_VALUES) {
      const member = CATEGORY_FROM_WIRE[wire];
      byCategory[wire] = member === undefined ? 0 : (counts.byCategory[member] ?? 0);
    }

    return { unread: counts.unread, critical: counts.critical, byCategory };
  }

  /**
   * API §10.4, served from the badge cache (RM M31.1, RA-M19.1).
   *
   * The two counts are invalidated by every writer of the rows they are
   * computed from — the four notification updates and the dispatcher here,
   * the four participant writes in messaging — so an entry is the
   * database's answer until one of them runs. `docs/CACHING.md` lists them.
   */
  badgeCounts(recipientId: string): Promise<BadgeCounts> {
    return this.cache.get(BADGE_COUNTS, recipientId, '', () =>
      this.notifications.badgeCounts(recipientId),
    );
  }
}

function toView(row: FeedRow): NotificationView {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    category: categoryToWire(row.category as NotificationCategory),
    priority: priorityToWire(row.priority as NotificationPriority),
    kind: kindToWire(row.kind as NotificationKind),
    sender: row.sender,
    readAt: row.readAt?.toISOString() ?? null,
    archived: row.archived,
    favorite: row.favorite,
    pinned: row.pinned,
    createdAt: row.createdAt.toISOString(),
    // Ids only. A notification announcing a lab result must not become a
    // way to read one — the client follows the id to a route that
    // enforces its own authorization.
    related: {
      patientId: row.patientId,
      recordId: row.recordId,
      labOrderId: row.labOrderId,
      prescriptionId: row.prescriptionId,
      appointmentId: row.appointmentId,
    },
  };
}
