/**
 * The two notification schedules (RM M30.1).
 *
 * M19 built both halves of the pipeline and deliberately started no
 * timer for either — `NotificationDispatchService`'s header says a
 * `setInterval` in a request-serving process "is precisely the ad-hoc
 * periodic behaviour M30's exit gate forbids". This is the file that
 * replaces the timer neither of them wrote.
 *
 * ## Why they are two jobs and not one
 *
 * They fail independently and for different reasons. The drain talks
 * only to Postgres; the delivery run talks to an SMTP relay. A relay
 * outage must not stop events becoming notifications — the in-app feed
 * keeps working, and the email backlog drains when the relay returns —
 * and a single job would tie the two together by its retry policy.
 *
 * ## A minute, and both are safe to run concurrently with themselves
 *
 * The badge the shell polls is supposed to be live, and a minute is the
 * coarsest interval that still reads as live. Both claim their rows with
 * `FOR UPDATE SKIP LOCKED` and mark them in the same statement, so an
 * overlapping run finds nothing rather than doing the work twice — which
 * is what lets the interval be this short without an overlap guard doing
 * the real work.
 */

import { Injectable, type OnModuleInit } from '@nestjs/common';

import { everyMinutes, FREQUENT_RETRY, JobRegistry } from '../../../shared/jobs';

import { NotificationDeliveryService } from './notification-delivery.service';
import { NotificationDispatchService } from './notification-dispatch.service';

@Injectable()
export class NotificationJobs implements OnModuleInit {
  constructor(
    private readonly registry: JobRegistry,
    private readonly dispatch: NotificationDispatchService,
    private readonly delivery: NotificationDeliveryService,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      name: 'notifications.event-drain',
      summary: 'Turns committed domain events into notifications and delivery rows (M19.2).',
      schedule: everyMinutes(1),
      retry: FREQUENT_RETRY,
      timeoutMs: 60_000,
      handler: async () => {
        const result = await this.dispatch.drain();

        return {
          claimed: result.claimed,
          notificationsCreated: result.notificationsCreated,
          skippedNoRule: result.skippedNoRule,
          failed: result.failed,
        };
      },
    });

    this.registry.register({
      name: 'notifications.delivery-run',
      summary: 'Sends the pending per-channel deliveries (M19.5).',
      schedule: everyMinutes(1),
      retry: FREQUENT_RETRY,
      timeoutMs: 120_000,
      handler: async () => {
        const result = await this.delivery.run();

        return {
          claimed: result.claimed,
          sent: result.sent,
          failed: result.failed,
          skipped: result.skipped,
        };
      },
    });
  }
}
