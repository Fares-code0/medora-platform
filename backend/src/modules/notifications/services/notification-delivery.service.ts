/**
 * Channel workers — RM M19.5.
 *
 * > ✅ Verify: mailhog receives an email for an email-enabled category;
 * > a delivery row records per-channel status.
 *
 * M19.2 decided *whether* each channel should carry a notification and
 * wrote one `notification_deliveries` row per channel — `pending` for
 * the channels that should go out, `skipped` with a reason for the ones
 * a preference or quiet hours suppressed. This is the other half: it
 * takes the `pending` rows and actually sends them.
 *
 * ## Only email has a provider, and the others say so
 *
 * Push has a port since M41.2 (`shared/push`, `deliverPush` below), bound
 * to an unconfigured provider until one is chosen; until then it behaves
 * as the stubs do.
 *
 * The milestone asks for "email (SMTP from platform slice), SMS stub,
 * push stub". A stub that marked its rows `sent` would be a lie an
 * administrator could not detect; one that marked them `failed` would
 * read as a relay problem to go and fix. So an unprovisioned channel is
 * `skipped` with the reason `no-provider` — the same status a deliberate
 * suppression uses, because it *is* one, distinguished by the reason
 * string rather than by a status the vocabulary does not have.
 *
 * `in-app` needs no provider at all: the notification row **is** the
 * in-app delivery, so it is marked `sent` the moment it is considered.
 *
 * ## Claiming, again, is the concurrency story
 *
 * Same shape as M19.2's event claim: rows are taken with `FOR UPDATE
 * SKIP LOCKED` and flipped out of `pending` in the same statement, so
 * two instances cannot both send one email. `notification_deliveries`
 * carries `@@unique([notificationId, channel])`, which is the backstop —
 * there can only ever be one row per channel to claim.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';

import { NotificationChannel } from '../../../generated/prisma/enums';
import { PrismaService } from '../../../shared/database';
import { MAILER, type Mailer } from '../../../shared/mail';
import { PUSH_PROVIDER, type PushOutcome, type PushProvider } from '../../../shared/push';

export interface DeliveryRunResult {
  readonly claimed: number;
  readonly sent: number;
  readonly failed: number;
  readonly skipped: number;
  /** Failures returned to `pending` for another attempt (NOT-01). */
  readonly retried: number;
}

/**
 * The claim is raw SQL, so `channel` arrives as the **column's** value —
 * `inApp`, not `IN_APP`. `$queryRaw` does not map enums back the way the
 * query builder does, and comparing the member name against it is a bug
 * that type-checks: every channel would fall through to the stub branch
 * and every email would go unsent while the run reported success.
 */
type ChannelColumnValue = 'email' | 'sms' | 'push' | 'desktop' | 'inApp';

interface ClaimedDelivery {
  readonly id: string;
  readonly channel: ChannelColumnValue;
  readonly title: string;
  readonly body: string;
  readonly email: string | null;
  readonly recipientId: string;
  readonly attempts: number;
}

/**
 * `Record<…>` keyed by the enum member, so a channel added to the schema
 * without a column value here stops the build rather than silently
 * becoming an unrecognised string at runtime.
 */
const COLUMN_VALUE: Record<NotificationChannel, ChannelColumnValue> = {
  EMAIL: 'email',
  SMS: 'sms',
  PUSH: 'push',
  DESKTOP: 'desktop',
  IN_APP: 'inApp',
};

const BATCH = 50;

/**
 * NOT-01 — crash recovery and retry, on the columns the table already has
 * (`status`, `attempts`, `last_attempt_at`; no `next_attempt_at` exists).
 *
 * - A row in `sending` whose `last_attempt_at` (stamped by the claim) is
 *   older than the lease belongs to a worker that died; it is re-claimed.
 *   The lease must exceed the longest legitimate send (job timeout is
 *   120 s), or a slow-but-alive worker would be raced by a second one.
 *   Delivery is therefore at-least-once across a crash that lands between
 *   the relay accepting a message and `finish` recording it.
 * - A failed email goes back to `pending` and is re-claimed once
 *   `last_attempt_at + backoff(attempts)` has passed — the "next attempt
 *   time" is derived, not stored. After `MAX_ATTEMPTS` the row is
 *   terminal `failed`.
 */
export const DELIVERY_LEASE_SECONDS = 10 * 60;
export const DELIVERY_MAX_ATTEMPTS = 5;
export const DELIVERY_BACKOFF_BASE_SECONDS = 30;
export const DELIVERY_BACKOFF_CAP_SECONDS = 30 * 60;

@Injectable()
export class NotificationDeliveryService {
  private readonly logger = new Logger('NotificationDelivery');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
  ) {}

  async run(limit: number = BATCH): Promise<DeliveryRunResult> {
    await this.failExhaustedClaims();
    const claimed = await this.claim(limit);

    let sent = 0;
    let failed = 0;
    let skipped = 0;
    let retried = 0;

    for (const delivery of claimed) {
      const outcome = await this.deliver(delivery);

      if (outcome === 'sent') sent += 1;
      else if (outcome === 'failed') failed += 1;
      else if (outcome === 'retry') retried += 1;
      else skipped += 1;
    }

    return { claimed: claimed.length, sent, failed, skipped, retried };
  }

  /**
   * A `sending` row whose lease expired and which has already used every
   * attempt is terminal: re-sending it forever after repeated crashes is
   * the unbounded retry the cap exists to stop. Same SKIP LOCKED shape
   * as the claim, so two instances do not both touch it.
   */
  private async failExhaustedClaims(): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE notification_deliveries AS d
      SET status = 'failed',
          error = 'lease-expired',
          updated_at = now()
      FROM (
        SELECT id
        FROM notification_deliveries
        WHERE status = 'sending'
          AND last_attempt_at < now() - make_interval(secs => ${DELIVERY_LEASE_SECONDS}::double precision)
          AND attempts >= ${DELIVERY_MAX_ATTEMPTS}
        FOR UPDATE SKIP LOCKED
      ) AS stale
      WHERE d.id = stale.id
    `;
  }

  /**
   * Claims pending rows and moves them out of `pending` in one
   * statement, joining the notification and the recipient so the worker
   * does not then issue two queries per row — the N+1 a per-delivery
   * lookup would be.
   */
  private async claim(limit: number): Promise<readonly ClaimedDelivery[]> {
    return this.prisma.$queryRaw<ClaimedDelivery[]>`
      WITH claimed AS (
        SELECT id
        FROM notification_deliveries
        WHERE (
            status = 'pending'
            AND (
              attempts = 0
              OR last_attempt_at IS NULL
              OR last_attempt_at + make_interval(
                   secs => LEAST(
                     ${DELIVERY_BACKOFF_CAP_SECONDS}::double precision,
                     ${DELIVERY_BACKOFF_BASE_SECONDS}::double precision * power(2, attempts - 1)
                   )
                 ) <= now()
            )
          )
          OR (
            status = 'sending'
            AND last_attempt_at < now() - make_interval(secs => ${DELIVERY_LEASE_SECONDS}::double precision)
            AND attempts < ${DELIVERY_MAX_ATTEMPTS}
          )
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      ),
      taken AS (
        UPDATE notification_deliveries AS d
        SET status = 'sending',
            attempts = d.attempts + 1,
            last_attempt_at = now()
        FROM claimed
        WHERE d.id = claimed.id
        RETURNING d.id, d.channel, d.notification_id, d.attempts
      )
      SELECT taken.id,
             taken.channel,
             n.title,
             n.body,
             u.email,
             u.id AS "recipientId",
             taken.attempts
      FROM taken
      JOIN notifications n ON n.id = taken.notification_id
      JOIN users u ON u.id = n.recipient_id
    `;
  }

  private async deliver(delivery: ClaimedDelivery): Promise<'sent' | 'failed' | 'skipped' | 'retry'> {
    if (delivery.channel === COLUMN_VALUE[NotificationChannel.IN_APP]) {
      // The notification row **is** the in-app delivery, so this is the
      // one channel that can honestly claim `delivered` rather than
      // `sent`: there is no provider between us and the feed, and the
      // `delivered_at IS NOT NULL ⟺ status = 'delivered'` CHECK is
      // satisfied because the row really has arrived.
      await this.finish(delivery, 'delivered', null, null);

      return 'sent';
    }

    if (delivery.channel === COLUMN_VALUE[NotificationChannel.EMAIL]) {
      if (delivery.email === null || delivery.email.length === 0) {
        await this.finish(delivery, 'skipped', 'no-address', null);

        return 'skipped';
      }

      const result = await this.mailer.trySend({
        to: delivery.email,
        subject: delivery.title,
        // The body carries identifiers only — M19.2 builds it from the
        // event payload, which is scalar and PHI-free by the outbox's
        // own contract. Nothing clinical reaches a mail relay here.
        text: `${delivery.body}\n\nOpen Medora to view this notification.`,
      });

      if (result.ok) {
        // `sent`, not `delivered`: the relay accepted the message, which
        // is not the same as the mailbox receiving it. Moving a row to
        // `delivered` needs a delivery report from the provider, and
        // `provider_ref` is stored here so that report can be matched
        // when a provider that sends one arrives.
        await this.finish(delivery, 'sent', null, result.providerRef ?? null);

        return 'sent';
      }

      // Transient until proven otherwise: the mailer reports no
      // permanent/temporary distinction, so every failure is retried with
      // backoff up to the cap, then becomes terminal.
      const error = result.error ?? 'send-failed';
      if (delivery.attempts < DELIVERY_MAX_ATTEMPTS) {
        await this.finish(delivery, 'pending', error, null);
        this.logger.warn(
          { deliveryId: delivery.id, attempts: delivery.attempts },
          'Email delivery failed; will retry',
        );

        return 'retry';
      }

      await this.finish(delivery, 'failed', error, null);
      this.logger.warn({ deliveryId: delivery.id }, 'Email delivery failed');

      return 'failed';
    }

    if (delivery.channel === COLUMN_VALUE[NotificationChannel.PUSH]) {
      return this.deliverPush(delivery);
    }

    // SMS and desktop: RM M19.5 calls these stubs, and the platform SMS
    // slice is where a provider arrives. Saying `no-provider` is the
    // honest record of a deployment state.
    await this.finish(delivery, 'skipped', 'no-provider', null);

    return 'skipped';
  }

  /**
   * Push (M41.2), to every device of the recipient that registered a token.
   *
   * The provider is checked **first**, so a deployment with none records
   * `skipped / no-provider` exactly as it did before this channel had a
   * port. Then: no registered device is `skipped / no-device` (a
   * preference allowed push, nothing can receive it); otherwise one send
   * to all of them, `sent` if any device accepted. A token the provider
   * says is permanently invalid is cleared, so the next notification does
   * not try it again.
   */
  private async deliverPush(delivery: ClaimedDelivery): Promise<'sent' | 'failed' | 'skipped' | 'retry'> {
    if (!this.push.configured) {
      await this.finish(delivery, 'skipped', 'no-provider', null);
      return 'skipped';
    }

    const devices = await this.prisma.db.trustedDevice.findMany({
      where: { userId: delivery.recipientId, removedAt: null, pushToken: { not: null } },
      select: { pushToken: true, platform: true },
    });
    const targets = devices.flatMap((device) =>
      device.pushToken === null
        ? []
        : [{ token: device.pushToken, platform: device.platform.toLowerCase() }],
    );

    if (targets.length === 0) {
      await this.finish(delivery, 'skipped', 'no-device', null);
      return 'skipped';
    }

    let outcomes: readonly PushOutcome[];
    try {
      outcomes = await this.push.send(targets, { title: delivery.title, body: delivery.body });
    } catch {
      await this.finish(delivery, 'failed', 'send-failed', null);
      this.logger.warn({ deliveryId: delivery.id }, 'Push delivery failed');
      return 'failed';
    }

    const invalid = outcomes.filter((outcome) => outcome.outcome === 'invalid-token');
    if (invalid.length > 0) {
      await this.prisma.db.trustedDevice.updateMany({
        where: { pushToken: { in: invalid.map((outcome) => outcome.token) } },
        data: { pushToken: null },
      });
    }

    const accepted = outcomes.find((outcome) => outcome.outcome === 'sent');
    if (accepted !== undefined) {
      // `sent`, not `delivered`, for the reason the email branch gives:
      // the provider accepted it, which is not a device receiving it.
      await this.finish(delivery, 'sent', null, accepted.providerRef ?? null);
      return 'sent';
    }

    await this.finish(
      delivery,
      'failed',
      invalid.length > 0 ? 'invalid-token' : 'send-failed',
      null,
    );
    return 'failed';
  }

  /**
   * `delivered_at` is written **only** for `delivered`, because the
   * schema's CHECK is an equivalence rather than an implication:
   * `(status = 'delivered') = (delivered_at IS NOT NULL)`. Stamping a
   * timestamp on a `sent` row is rejected by the database, and that is
   * the right rule — a time on a row whose arrival was never confirmed
   * would be a delivery receipt for something nobody acknowledged.
   *
   * Records the outcome of *this* claim only. The claim stamps `sending` and
   * increments `attempts`, so `(status = 'sending', attempts = claimed)` is
   * a fencing token: a worker that outlived its lease, whose row was
   * re-claimed by another worker, matches nothing here and cannot overwrite
   * the newer claim's outcome.
   */
  private async finish(
    delivery: Pick<ClaimedDelivery, 'id' | 'attempts'>,
    status: 'delivered' | 'sent' | 'failed' | 'skipped' | 'pending',
    error: string | null,
    providerRef: string | null,
  ): Promise<void> {
    const { count } = await this.prisma.db.notificationDelivery.updateMany({
      where: { id: delivery.id, status: 'sending', attempts: delivery.attempts },
      data: {
        status,
        ...(status === 'delivered' ? { deliveredAt: new Date() } : {}),
        error,
        providerRef,
      },
    });
    if (count === 1) return;

    // Nothing matched. A row that still exists was re-claimed by a newer
    // worker: its outcome wins, and this late one is dropped. A row that no
    // longer exists keeps today's behaviour — `update` raises P2025 — which
    // `push-delivery.e2e-spec.ts` pins as a known defect awaiting a decision;
    // fencing does not decide it.
    const current = await this.prisma.db.notificationDelivery.findUnique({
      where: { id: delivery.id },
      select: { id: true },
    });
    if (current === null) {
      await this.prisma.db.notificationDelivery.update({ where: { id: delivery.id }, data: { status } });
      return;
    }
    this.logger.warn({ deliveryId: delivery.id }, 'Delivery outcome dropped: the claim was superseded');
  }
}
