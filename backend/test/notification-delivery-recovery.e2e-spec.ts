import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DELIVERY_BACKOFF_BASE_SECONDS,
  DELIVERY_LEASE_SECONDS,
  DELIVERY_MAX_ATTEMPTS,
  NotificationDeliveryService,
} from '../src/modules/notifications/services/notification-delivery.service';
import { MAILER, type Mailer } from '../src/shared/mail';

import {
  type AuthHarness,
  asJob,
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

/**
 * NOT-01 — a row left `sending` by a crashed worker is recovered, and a
 * failed email is retried with backoff, then terminal after the cap.
 *
 * Mail goes to the harness's real SMTP sink; a transient relay failure is
 * produced by making `trySend` report failure for chosen calls only.
 */
let harness: AuthHarness;
let delivery: NotificationDeliveryService;
let mailer: Mailer;
let workerLock: DeliveryWorkerLock | undefined;
let userId = '';
let userEmail = '';

const SEEDED_AT = new Date('2000-01-01T00:00:00.000Z');

async function seedEmail(
  data: { status?: string; attempts?: number; lastAttemptAt?: Date | null } = {},
): Promise<string> {
  const notification = await harness.prisma.db.notification.create({
    data: {
      recipientId: userId,
      title: 'Recovery probe',
      body: 'Order LAB-9',
      category: 'SYSTEM',
      kind: 'UPDATE',
      sender: 'Medora',
    },
    select: { id: true },
  });
  const row = await harness.prisma.db.notificationDelivery.create({
    data: {
      notificationId: notification.id,
      channel: 'EMAIL',
      status: data.status ?? 'pending',
      attempts: data.attempts ?? 0,
      lastAttemptAt: data.lastAttemptAt ?? null,
      createdAt: SEEDED_AT,
    },
    select: { id: true },
  });
  return row.id;
}

const row = (id: string) =>
  harness.prisma.db.notificationDelivery.findUniqueOrThrow({ where: { id } });
const mine = () => harness.sink.messages.filter((m) => m.recipients.includes(userEmail));
const ago = (seconds: number) => new Date(Date.now() - seconds * 1000);
const FAIL = { ok: false, error: 'relay-down' } as const;

beforeAll(async () => {
  workerLock = await acquireDeliveryWorkerLock();
}, DELIVERY_WORKER_LOCK_TIMEOUT_MS + 10_000);

beforeAll(async () => {
  harness = await createAuthHarness('notify-delivery-recovery');
  delivery = asJob(harness.app.get(NotificationDeliveryService));
  mailer = harness.app.get<Mailer>(MAILER);

  userEmail = testEmail('delivery-recovery');
  await request(harness.server)
    .post('/api/v1/auth/register')
    .send(registrationBody({ email: userEmail }));
  await markVerified(harness.prisma, userEmail);
  userId = (
    await harness.prisma.db.user.findUniqueOrThrow({
      where: { email: userEmail },
      select: { id: true },
    })
  ).id;
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
  vi.restoreAllMocks();
  await harness.prisma.db.notification.deleteMany({ where: { recipientId: userId } });
  harness.sink.clear();
});

describe('NOT-01 stale claim recovery', () => {
  it('re-claims a row left sending past the lease and delivers it once', async () => {
    const id = await seedEmail({
      status: 'sending',
      attempts: 1,
      lastAttemptAt: ago(DELIVERY_LEASE_SECONDS + 60),
    });

    await delivery.run();
    await delivery.run();

    expect(mine()).toHaveLength(1);
    expect(await row(id)).toMatchObject({ status: 'sent', attempts: 2 });
  });

  it('drops the late outcome of a superseded claim instead of overwriting the newer one', async () => {
    // Worker A claimed the row (attempts → 1) and stalled past its lease.
    const id = await seedEmail({
      status: 'sending',
      attempts: 1,
      lastAttemptAt: ago(DELIVERY_LEASE_SECONDS + 60),
    });
    // Worker B re-claims it (attempts → 2) and delivers.
    await delivery.run();
    expect(await row(id)).toMatchObject({ status: 'sent', attempts: 2 });

    // Worker A wakes up and reports its own (stale) failure.
    const stale = delivery as unknown as {
      finish(claim: { id: string; attempts: number }, status: 'failed', error: string, ref: null): Promise<void>;
    };
    await stale.finish({ id, attempts: 1 }, 'failed', 'relay-down', null);

    expect(await row(id)).toMatchObject({ status: 'sent', attempts: 2, error: null });
    expect(mine()).toHaveLength(1);
  });

  it('leaves a fresh sending claim alone (the worker may still be alive)', async () => {
    const id = await seedEmail({ status: 'sending', attempts: 1, lastAttemptAt: ago(5) });

    await delivery.run();

    expect(mine()).toHaveLength(0);
    expect(await row(id)).toMatchObject({ status: 'sending', attempts: 1 });
  });

  it('fails a stale claim that has used every attempt instead of re-sending it', async () => {
    const id = await seedEmail({
      status: 'sending',
      attempts: DELIVERY_MAX_ATTEMPTS,
      lastAttemptAt: ago(DELIVERY_LEASE_SECONDS + 60),
    });

    await delivery.run();

    expect(mine()).toHaveLength(0);
    expect(await row(id)).toMatchObject({ status: 'failed', error: 'lease-expired' });
  });

  it('does not double-deliver a stale row when two workers run concurrently', async () => {
    const id = await seedEmail({
      status: 'sending',
      attempts: 1,
      lastAttemptAt: ago(DELIVERY_LEASE_SECONDS + 60),
    });

    await Promise.all([delivery.run(), delivery.run()]);

    expect(mine()).toHaveLength(1);
    expect((await row(id)).attempts).toBe(2);
  });
});

describe('NOT-01 retry with backoff', () => {
  it('returns a transient failure to pending, waits out the backoff, then delivers', async () => {
    const id = await seedEmail();
    vi.spyOn(mailer, 'trySend').mockResolvedValueOnce(FAIL);

    const first = await delivery.run();
    expect(first.retried).toBeGreaterThanOrEqual(1);
    expect(await row(id)).toMatchObject({ status: 'pending', attempts: 1, error: 'relay-down' });
    expect(mine()).toHaveLength(0);

    // Inside the backoff window: not claimed.
    await delivery.run();
    expect(await row(id)).toMatchObject({ status: 'pending', attempts: 1 });

    // Backoff elapsed.
    await harness.prisma.db.notificationDelivery.update({
      where: { id },
      data: { lastAttemptAt: ago(DELIVERY_BACKOFF_BASE_SECONDS + 5) },
    });
    await delivery.run();

    expect(mine()).toHaveLength(1);
    expect(await row(id)).toMatchObject({ status: 'sent', attempts: 2 });
  });

  it('goes terminal failed after the maximum attempts', async () => {
    const id = await seedEmail({
      attempts: DELIVERY_MAX_ATTEMPTS - 1,
      lastAttemptAt: ago(24 * 3600),
    });
    vi.spyOn(mailer, 'trySend').mockResolvedValue(FAIL);

    await delivery.run();

    expect(await row(id)).toMatchObject({
      status: 'failed',
      attempts: DELIVERY_MAX_ATTEMPTS,
      error: 'relay-down',
    });

    await delivery.run();
    expect((await row(id)).attempts).toBe(DELIVERY_MAX_ATTEMPTS);
  });
});
