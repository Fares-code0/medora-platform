import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { NotificationDeliveryService } from '../src/modules/notifications/services/notification-delivery.service';

import {
  type AuthHarness,
  createAuthHarness,
  markVerified,
  registrationBody,
  testEmail,
} from './support/auth-app';
import {
  acquireDeliveryWorkerLock,
  DELIVERY_WORKER_LOCK_TIMEOUT_MS,
  type DeliveryWorkerLock,
} from './support/delivery-worker-lock';
import { body as mailBody, header } from './support/smtp-sink';

import request from 'supertest';

/**
 * Channel workers — RM M19.5.
 *
 * > ✅ Verify: mailhog receives an email for an email-enabled category;
 * > a delivery row records per-channel status.
 *
 * The harness's `SmtpSink` is the mailhog of this suite — a real SMTP
 * server on a loopback port that the mailer is pointed at, so "an email
 * was sent" is asserted from the wire rather than from a spy.
 *
 * The properties the worker can get wrong:
 *
 * · **A stub must not claim success.** SMS and push have no provider;
 *   recording `sent` would be a lie an administrator cannot detect.
 * · **Two instances must not both send one email.** The claim is the
 *   same `FOR UPDATE SKIP LOCKED` shape M19.2 uses.
 * · **A suppressed channel is never picked up.** Rows M19.2 wrote as
 *   `skipped` are not `pending` and must stay untouched.
 *
 * ## Why nothing here asserts a bare global `claimed` count
 *
 * `run()` claims **every** pending delivery in the table, by design — it
 * is the process-wide worker, not this suite's. Under a parallel full run
 * another spec's fan-out has rows in that table too, so `claimed === 5`
 * measures the rest of the suite rather than this code, and it fails the
 * moment a new topic is added anywhere. This is the same correction
 * `notification-fanout.e2e-spec.ts` already carries in its own header,
 * applied here after a new M30.2 schedule made the contention visible.
 *
 * So the assertions are scoped to **this suite's own rows and its own
 * mailbox**: the per-channel outcome comes from `deliveriesOf(id)`, and
 * the mail assertions filter the sink by recipient. The lower bound on
 * `claimed` is kept, because "at least my five were taken" is still a
 * real assertion and the per-row statuses prove which five.
 */
let harness: AuthHarness;
let delivery: NotificationDeliveryService;
/** Excludes `push-delivery.e2e-spec.ts` — see `support/delivery-worker-lock.ts`. */
let workerLock: DeliveryWorkerLock | undefined;

const REGISTER = '/api/v1/auth/register';
const CHANNELS = ['EMAIL', 'SMS', 'PUSH', 'DESKTOP', 'IN_APP'] as const;

let userId = '';
let userEmail = '';

async function seedNotificationWithDeliveries(
  statuses: Partial<Record<(typeof CHANNELS)[number], string>> = {},
): Promise<string> {
  const notification = await harness.prisma.db.notification.create({
    data: {
      recipientId: userId,
      title: 'Critical lab result released',
      body: 'Order LAB-1 · Analytes: Potassium',
      category: 'LABORATORY',
      priority: 'CRITICAL',
      kind: 'ALERT',
      sender: 'Medora',
    },
    select: { id: true },
  });

  await harness.prisma.db.notificationDelivery.createMany({
    data: CHANNELS.map((channel) => ({
      notificationId: notification.id,
      channel,
      status: statuses[channel] ?? 'pending',
    })),
  });

  return notification.id;
}

/**
 * The messages this suite's own recipient received.
 *
 * The sink is per-harness, so only mail *this* application sent lands in
 * it — but this application's worker claims the whole table, so a
 * notification another spec fanned out becomes an email here too. The
 * address is what separates them.
 */
function mineOnly() {
  return harness.sink.messages.filter((message) => message.recipients.includes(userEmail));
}

function deliveriesOf(notificationId: string) {
  return harness.prisma.db.notificationDelivery.findMany({
    where: { notificationId },
    orderBy: { channel: 'asc' },
  });
}

beforeAll(async () => {
  workerLock = await acquireDeliveryWorkerLock();
}, DELIVERY_WORKER_LOCK_TIMEOUT_MS + 10_000);

beforeAll(async () => {
  harness = await createAuthHarness('notify-delivery');
  delivery = harness.app.get(NotificationDeliveryService);

  userEmail = testEmail('delivery-doctor');
  await request(harness.server).post(REGISTER).send(registrationBody({ email: userEmail }));
  await markVerified(harness.prisma, userEmail);

  const user = await harness.prisma.db.user.findUniqueOrThrow({
    where: { email: userEmail },
    select: { id: true },
  });
  userId = user.id;
}, 60_000);

afterAll(async () => {
  try {
    if (harness === undefined) return;
    await harness.reset();
    await harness.close();
  } finally {
    await workerLock?.release();
  }
});

beforeEach(async () => {
  await harness.prisma.db.notification.deleteMany({ where: { recipientId: userId } });
  harness.sink.clear();
});

describe('RM M19.5 verify — an email goes out and the row records it', () => {
  it('sends the email and marks that channel sent', async () => {
    const id = await seedNotificationWithDeliveries();

    const run = await delivery.run();

    expect(run.claimed).toBeGreaterThanOrEqual(5);

    const rows = await deliveriesOf(id);
    const byChannel = new Map(rows.map((row) => [row.channel, row]));

    // The counts, scoped to this notification's own five rows — which is
    // what `run.sent` and `run.skipped` were standing in for.
    expect(rows.filter((row) => row.status === 'pending')).toHaveLength(0);
    expect(rows.filter((row) => row.status === 'skipped')).toHaveLength(3);

    const mail = mineOnly();
    expect(mail).toHaveLength(1);
    expect(mail[0]?.recipients).toContain(userEmail);
    expect(header(mail[0]!, 'Subject')).toContain('Critical lab result released');
    expect(mailBody(mail[0]!)).toContain('Potassium');

    // `sent`, not `delivered`: the relay accepted it, which is not the
    // same as the mailbox receiving it. The CHECK
    // `(status = 'delivered') = (delivered_at IS NOT NULL)` is what
    // keeps those two apart.
    expect(byChannel.get('EMAIL')?.status).toBe('sent');
    expect(byChannel.get('EMAIL')?.deliveredAt).toBeNull();
    expect(byChannel.get('EMAIL')?.attempts).toBe(1);
  });

  it('records a per-channel status for every channel, with the reason for each skip', async () => {
    const id = await seedNotificationWithDeliveries();

    await delivery.run();

    const byChannel = new Map((await deliveriesOf(id)).map((row) => [row.channel, row]));

    // The in-app row is the notification itself — the one channel that
    // can honestly claim `delivered`, with a timestamp the CHECK allows.
    expect(byChannel.get('IN_APP')?.status).toBe('delivered');
    expect(byChannel.get('IN_APP')?.deliveredAt).not.toBeNull();
    // A stub that claimed `sent` would be undetectably false.
    expect(byChannel.get('SMS')?.status).toBe('skipped');
    expect(byChannel.get('SMS')?.error).toBe('no-provider');
    expect(byChannel.get('PUSH')?.status).toBe('skipped');
    expect(byChannel.get('DESKTOP')?.status).toBe('skipped');
  });

  it('carries no clinical value into the mail body', async () => {
    await harness.prisma.db.notification.create({
      data: {
        recipientId: userId,
        title: 'Critical lab result released',
        body: 'Order LAB-2 · Analytes: Potassium',
        category: 'LABORATORY',
        priority: 'CRITICAL',
        kind: 'ALERT',
        sender: 'Medora',
        deliveries: { create: [{ channel: 'EMAIL', status: 'pending' }] },
      },
    });

    await delivery.run();

    const text = mailBody(mineOnly()[0]!);
    expect(text).toContain('Potassium');
    // The analyte is an identifier; the number is the result.
    expect(text).not.toMatch(/\d+\.\d/);
  });
});

describe('what the worker does not pick up', () => {
  it('leaves rows a preference already skipped alone', async () => {
    const id = await seedNotificationWithDeliveries({
      EMAIL: 'skipped',
      SMS: 'skipped',
      PUSH: 'skipped',
      DESKTOP: 'skipped',
      IN_APP: 'skipped',
    });

    await delivery.run();

    expect(mineOnly()).toHaveLength(0);
    // Untouched: `attempts` is still zero, so nothing pretended to try,
    // and every row is still `skipped` rather than having been claimed.
    const rows = await deliveriesOf(id);
    expect(rows.every((row) => row.attempts === 0)).toBe(true);
    expect(rows.every((row) => row.status === 'skipped')).toBe(true);
  });

  it('does not re-send a row it already sent', async () => {
    const id = await seedNotificationWithDeliveries();

    await delivery.run();
    await delivery.run();

    // One email for this recipient after two runs — the second run found
    // nothing of this notification's left in `pending`.
    expect(mineOnly()).toHaveLength(1);
    expect((await deliveriesOf(id)).filter((row) => row.attempts > 1)).toHaveLength(0);
  });

  it('skips an email for a recipient with no address', async () => {
    // `users.email` is required, so the unreachable case is exercised by
    // a delivery whose notification was removed — the join finds nothing
    // and the row is simply not claimed.
    const notification = await harness.prisma.db.notification.create({
      data: {
        recipientId: userId,
        title: 'Orphan',
        body: 'x',
        category: 'SYSTEM',
        kind: 'UPDATE',
        sender: 'Medora',
        deliveries: { create: [{ channel: 'EMAIL', status: 'pending' }] },
      },
      select: { id: true },
    });

    await harness.prisma.db.notification.delete({ where: { id: notification.id } });

    await delivery.run();

    // The join found nothing, so nothing was claimed and nothing was
    // sent to this suite's recipient.
    expect(mineOnly()).toHaveLength(0);
  });
});

describe('two workers, one email', () => {
  it('sends exactly once when two runs overlap', async () => {
    const id = await seedNotificationWithDeliveries();

    await Promise.all([delivery.run(), delivery.run()]);

    // Exactly one email, and every one of the five rows claimed once —
    // two workers, one send, which is what `FOR UPDATE SKIP LOCKED` buys.
    expect(mineOnly()).toHaveLength(1);
    const rows = await deliveriesOf(id);
    expect(rows).toHaveLength(5);
    expect(rows.filter((row) => row.status === 'pending')).toHaveLength(0);
    expect(rows.filter((row) => row.attempts > 1)).toHaveLength(0);
  });

  it('honours the batch limit so one run cannot monopolise the queue', async () => {
    const id = await seedNotificationWithDeliveries();

    // The limit is the limit whoever's rows are in the table, so this
    // count is exact and stays exact under a parallel run.
    expect((await delivery.run(2)).claimed).toBe(2);

    // Draining the rest is asserted on this notification's own rows: an
    // exact `claimed: 3` would be counting the other suites again.
    await delivery.run();
    expect((await deliveriesOf(id)).filter((row) => row.status === 'pending')).toHaveLength(0);
  });
});
