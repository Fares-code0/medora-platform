import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { zodBody, zodQuery } from '../../../common/validation/zod-validation.pipe';
import { Authenticated } from '../../../shared/authz';
import type { BadgeCounts } from '../dto/notification.dto';
import {
  notificationFlagSchema,
  notificationQuerySchema,
  type NotificationFlagBody,
  type NotificationQuery,
} from '../dto/notification.schema';
import {
  NotificationService,
  type NotificationSummary,
  type PaginatedNotifications,
} from '../services/notification.service';

/**
 * Notifications — API §10.1–10.4.
 *
 * ## Why these are `/notifications` and not `/me/notifications`
 *
 * API §10 already defines this surface, and marks every route `✓` — any
 * authenticated user. That is not an oversight: the feed is scoped by
 * `notifications.recipient_id`, so it is self-scoped by construction and
 * one code path serves a doctor and a patient identically.
 *
 * Adding `/me/notifications` for patients would be a second route over
 * the same table — the parallel model the design brief rules out — and
 * would leave two places to get the ownership predicate right.
 *
 * ## Authorization
 *
 * `@Authenticated()` is the whole decision: the recipient **is** the
 * token's subject, and there is no `userId` parameter on any route here
 * to substitute. A patient holds zero capabilities (ADR-030 §6), so a
 * `@Can(...)` would deny the audience these routes serve.
 *
 * Someone else's notification and a non-existent one both answer **404**.
 * The write routes use a scoped `updateMany` rather than `update` by id,
 * so the two are indistinguishable on the write path as well — an
 * `update` would throw a distinguishable error and turn a mark-read route
 * into an enumeration oracle.
 *
 * ## The row actions are explicit, not toggles
 *
 * `/archive`, `/favorite` and `/pin` take `{ value }` (default `true`).
 * §10.2 calls the client optimistic with "rollback on failure", and a
 * toggle cannot be rolled back safely: two clicks racing each other
 * settle on whichever state the second write computed, and the client's
 * undo would then flip a value it never saw.
 *
 * ## Not implemented here
 *
 * Badge counts are served from the database on every poll. RM **M31.1**
 * owns the Redis counter behind them — "badge counters" is one of its
 * named caches — and the verify step's 100-client p95 belongs with it.
 */
@Authenticated()
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  feed(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(notificationQuerySchema)) query: NotificationQuery,
  ): Promise<PaginatedNotifications> {
    return this.notifications.feed(user.id, query);
  }

  /**
   * Declared before `:notificationId` routes.
   *
   * Nest matches in declaration order, so a `:notificationId` route above
   * this one would capture `badge-counts` as an id and answer 404 on the
   * poll target.
   */
  @Get('badge-counts')
  badgeCounts(@CurrentUser() user: AuthenticatedUser): Promise<BadgeCounts> {
    return this.notifications.badgeCounts(user.id);
  }

  /** API §10.6 — the summary cards. Declared above `:notificationId`. */
  @Get('summary')
  summary(@CurrentUser() user: AuthenticatedUser): Promise<NotificationSummary> {
    return this.notifications.summary(user.id);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  readAll(@CurrentUser() user: AuthenticatedUser): Promise<{ updated: number }> {
    return this.notifications.markAllRead(user.id);
  }

  /** API §10.3 — archives every read, unarchived row and says how many. */
  @Post('clear-read')
  @HttpCode(HttpStatus.OK)
  clearRead(@CurrentUser() user: AuthenticatedUser): Promise<{ archived: number }> {
    return this.notifications.clearRead(user.id);
  }

  @Post(':notificationId/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  read(
    @CurrentUser() user: AuthenticatedUser,
    @Param('notificationId') notificationId: string,
  ): Promise<void> {
    return this.notifications.markRead(user.id, notificationId);
  }

  @Post(':notificationId/unread')
  @HttpCode(HttpStatus.NO_CONTENT)
  unread(
    @CurrentUser() user: AuthenticatedUser,
    @Param('notificationId') notificationId: string,
  ): Promise<void> {
    return this.notifications.markUnread(user.id, notificationId);
  }

  @Post(':notificationId/archive')
  @HttpCode(HttpStatus.NO_CONTENT)
  archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('notificationId') notificationId: string,
    @Body(zodBody(notificationFlagSchema)) body: NotificationFlagBody,
  ): Promise<void> {
    return this.notifications.setFlag(user.id, notificationId, 'archived', body.value);
  }

  @Post(':notificationId/favorite')
  @HttpCode(HttpStatus.NO_CONTENT)
  favorite(
    @CurrentUser() user: AuthenticatedUser,
    @Param('notificationId') notificationId: string,
    @Body(zodBody(notificationFlagSchema)) body: NotificationFlagBody,
  ): Promise<void> {
    return this.notifications.setFlag(user.id, notificationId, 'favorite', body.value);
  }

  @Post(':notificationId/pin')
  @HttpCode(HttpStatus.NO_CONTENT)
  pin(
    @CurrentUser() user: AuthenticatedUser,
    @Param('notificationId') notificationId: string,
    @Body(zodBody(notificationFlagSchema)) body: NotificationFlagBody,
  ): Promise<void> {
    return this.notifications.setFlag(user.id, notificationId, 'pinned', body.value);
  }
}
