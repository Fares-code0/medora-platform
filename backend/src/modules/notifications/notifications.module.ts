import { Module } from '@nestjs/common';

import { DatabaseModule } from '../../shared/database';
import { MailKernelModule } from '../../shared/mail';

import { NotificationPreferenceController } from './controllers/notification-preference.controller';
import { NotificationController } from './controllers/notification.controller';
import { DomainEventRepository } from './repositories/domain-event.repository';
import { NotificationRecipientRepository } from './repositories/notification-recipient.repository';
import { NotificationRepository } from './repositories/notification.repository';
import { NotificationDeliveryService } from './services/notification-delivery.service';
import { NotificationDispatchService } from './services/notification-dispatch.service';
import { NotificationJobs } from './services/notification.jobs';
import { NotificationPreferenceService } from './services/notification-preference.service';
import { NotificationService } from './services/notification.service';

/**
 * Notifications — API §10. M19.
 *
 * The in-app feed, its read state and the badge counts the shell polls.
 *
 * **One model, serving every role.** `notifications.recipient_id` points
 * at `users.id`, and ADR-030 made patients users — so a patient became a
 * valid recipient with no schema change, no second table and no parallel
 * route tree. API §10 already marks these routes `✓` (any authenticated
 * user), which says the same thing: the feed is self-scoped by
 * construction.
 *
 * Built here: the feed with its filters and paging (§10.1), read/unread
 * (§10.2), read-all (§10.3) and badge counts (§10.4), and — since
 * **M19.2** — the fan-out that writes these rows in the first place:
 * `NotificationDispatchService` claims the `domain_events` M19.1 makes
 * transactional, applies `NOTIFICATION_RULES`, and records a delivery
 * row per channel.
 *
 * Draining on a schedule is **M30.1**, which owns the queue registry and
 * the retry policy. Nothing here starts a timer: a `setInterval` in a
 * request-serving process is the ad-hoc periodic behaviour that
 * milestone's exit gate forbids.
 *
 * **M19.3** completed the feed surface: archive, favorite and pin
 * (§10.2), `clear-read` (§10.3), the `q` filter (§10.1) and the summary
 * cards (§10.6). **M19.4** added `GET/PUT /me/notification-preferences`
 * (§10.5), whose two rules live where they belong — `categories.security`
 * in the schema and the DB CHECK, quiet hours in `channel-selection.ts`
 * at the moment a notification is sent.
 *
 * **M19.5** added the channel workers: `NotificationDeliveryService`
 * claims the `pending` delivery rows M19.2 wrote and sends them. Email
 * goes through the mail kernel; SMS, push and desktop have no provider
 * and record `skipped` with the reason `no-provider`, which is the
 * honest record of a deployment state rather than a `sent` an
 * administrator could not detect as false.
 *
 * Left outside M19: the Redis counter behind the badge endpoint is
 * **M31.1** ("badge counters" is one of its named caches), and both
 * schedules — the event drain and the delivery run — are **M30.1**.
 */
@Module({
  imports: [DatabaseModule, MailKernelModule],
  controllers: [NotificationController, NotificationPreferenceController],
  providers: [
    NotificationService,
    NotificationRepository,
    NotificationDispatchService,
    DomainEventRepository,
    NotificationRecipientRepository,
    NotificationPreferenceService,
    NotificationDeliveryService,
    NotificationJobs,
  ],
  exports: [NotificationDispatchService, NotificationDeliveryService],
})
export class NotificationsModule {}
