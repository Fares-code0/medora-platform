import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { NotificationDispatchService } from '../src/modules/notifications/services/notification-dispatch.service';
import { BADGE_COUNTS, CacheService } from '../src/shared/cache';
import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
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
 * The badge cache (RM M31.1, RA-M19.1) — `GET /notifications/badge-counts`
 * served from Redis, and **never stale after a write**.
 *
 * Every test follows one shape: prime the cache with a read, perform one
 * writer's mutation through its real path, read again. A writer that did
 * not invalidate would leave the primed entry in place and the second read
 * would return the first read's number — so each case fails on exactly
 * the regression it exists to catch. The nine writers are the ones
 * `docs/CACHING.md` lists:
 *
 *   notifications — the dispatcher's create; read / unread; read-all;
 *                   archive; clear-read
 *   messaging     — thread creation; send; mark-read; archive (PATCH)
 */
let harness: AuthHarness;
let cache: CacheService;

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const BADGES = '/api/v1/notifications/badge-counts';
const NOTIFICATIONS = '/api/v1/notifications';
const CONV = '/api/v1/conversations';
const PASSWORD = 'Medora123!';

interface Session {
  readonly token: string;
  readonly userId: string;
}

interface Badges {
  notifications: number;
  messages: number;
}

let alice: Session;
let bob: Session;

async function signUp(local: string): Promise<Session> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);

  const token = dataOf<{ accessToken: string }>(
    await request(harness.server)
      .post(LOGIN)
      .send({ email, password: PASSWORD, rememberMe: false }),
  ).accessToken;
  const user = await harness.prisma.user.findUniqueOrThrow({ where: { email } });

  return { token, userId: user.id };
}

const as = (session: Session) => ({ Authorization: `Bearer ${session.token}` });

async function badges(session: Session): Promise<Badges> {
  return dataOf<Badges>(await request(harness.server).get(BADGES).set(as(session)).expect(200));
}

/** An unread notification, written directly — before the cache is primed. */
async function seedNotification(recipientId: string, read = false): Promise<string> {
  const row = await harness.prisma.db.notification.create({
    data: {
      recipientId,
      title: 'Badge cache',
      body: 'Open Medora for details.',
      category: 'SYSTEM',
      priority: 'NORMAL',
      kind: 'UPDATE',
      sender: 'Medora',
      ...(read ? { readAt: new Date() } : {}),
    },
    select: { id: true },
  });
  return row.id;
}

async function clearNotifications(session: Session): Promise<void> {
  await harness.prisma.db.notification.deleteMany({ where: { recipientId: session.userId } });
  // A direct delete bypasses the writers — the out-of-band write
  // `docs/CACHING.md` says must bump the cache itself.
  await cache.invalidate(BADGE_COUNTS, [session.userId]);
}

async function thread(author: Session, others: Session[]): Promise<string> {
  return dataOf<{ id: string }>(
    await request(harness.server)
      .post(CONV)
      .set(as(author))
      .send({ participantIds: others.map((other) => other.userId), topic: 'Badges' })
      .expect(201),
  ).id;
}

async function send(author: Session, conversationId: string): Promise<string> {
  return dataOf<{ id: string }>(
    await request(harness.server)
      .post(`${CONV}/${conversationId}/messages`)
      .set(as(author))
      .send({ body: 'ping' })
      .expect(201),
  ).id;
}

/**
 * Excludes the other notification-pipeline specs for this file's whole
 * run — see `support/delivery-worker-lock.ts`. The release is registered
 * before this file's own `afterAll`, so under Vitest's default `stack`
 * hook order it runs last, after this file's cleanup has deleted its rows.
 */
let pipelineLock: DeliveryWorkerLock | undefined;

beforeAll(async () => {
  pipelineLock = await acquireDeliveryWorkerLock();
}, DELIVERY_WORKER_LOCK_TIMEOUT_MS + 10_000);

afterAll(async () => {
  await pipelineLock?.release();
});

beforeAll(async () => {
  harness = await createAuthHarness('badge-cache-m311');
  cache = harness.app.get(CacheService);
  alice = await signUp('badge-alice');
  bob = await signUp('badge-bob');
}, 60_000);

afterAll(async () => {
  if (harness === undefined) return;
  await harness.prisma.conversation.deleteMany({
    where: { participants: { some: { userId: { in: [alice.userId, bob.userId] } } } },
  });
  await harness.reset();
  await harness.close();
});

describe('the badge is served from the cache', () => {
  it('answers a second read without querying, and counts the hit', async () => {
    await clearNotifications(alice);
    await seedNotification(alice.userId);
    await cache.invalidate(BADGE_COUNTS, [alice.userId]);

    const hitsBefore = hitsOf('hit');
    expect((await badges(alice)).notifications).toBe(1);

    const count = vi.spyOn(harness.prisma.db.notification, 'count');
    try {
      expect((await badges(alice)).notifications).toBe(1);
      expect(count).not.toHaveBeenCalled();
    } finally {
      count.mockRestore();
    }
    expect(hitsOf('hit')).toBeGreaterThan(hitsBefore);
  });

  it('keeps users apart', async () => {
    await clearNotifications(alice);
    await clearNotifications(bob);
    await seedNotification(alice.userId);
    await cache.invalidate(BADGE_COUNTS, [alice.userId, bob.userId]);

    expect((await badges(alice)).notifications).toBe(1);
    expect((await badges(bob)).notifications).toBe(0);
  });
});

describe('every notification writer invalidates the badge', () => {
  it('the dispatcher — a new notification is counted on the next read', async () => {
    await clearNotifications(alice);
    const doctor = await harness.prisma.doctor.findFirstOrThrow({
      where: { userId: alice.userId },
      select: { id: true },
    });
    expect((await badges(alice)).notifications).toBe(0); // primed

    await harness.prisma.domainEvent.create({
      data: {
        topic: 'doctor.license_expiring',
        payload: { doctorId: doctor.id, expiresOn: '2027-01-01' },
        dedupeKey: `badge-cache:${doctor.id}:${String(Date.now())}`,
      },
    });
    const dispatch = harness.app.get(NotificationDispatchService);
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const written = await harness.prisma.db.notification.count({
        where: { recipientId: alice.userId },
      });
      if (written > 0) break;
      await dispatch.drain();
    }

    expect((await badges(alice)).notifications).toBe(1);
  });

  it('read and unread', async () => {
    await clearNotifications(alice);
    const id = await seedNotification(alice.userId);
    expect((await badges(alice)).notifications).toBe(1);

    await request(harness.server).post(`${NOTIFICATIONS}/${id}/read`).set(as(alice)).expect(204);
    expect((await badges(alice)).notifications).toBe(0);

    await request(harness.server).post(`${NOTIFICATIONS}/${id}/unread`).set(as(alice)).expect(204);
    expect((await badges(alice)).notifications).toBe(1);
  });

  it('read-all', async () => {
    await clearNotifications(alice);
    await seedNotification(alice.userId);
    await seedNotification(alice.userId);
    expect((await badges(alice)).notifications).toBe(2);

    await request(harness.server).post(`${NOTIFICATIONS}/read-all`).set(as(alice)).expect(200);
    expect((await badges(alice)).notifications).toBe(0);
  });

  it('archive', async () => {
    await clearNotifications(alice);
    const id = await seedNotification(alice.userId);
    expect((await badges(alice)).notifications).toBe(1);

    await request(harness.server)
      .post(`${NOTIFICATIONS}/${id}/archive`)
      .set(as(alice))
      .send({ value: true })
      .expect(204);
    expect((await badges(alice)).notifications).toBe(0);
  });

  it('clear-read — and the cache was really in front of it', async () => {
    await clearNotifications(alice);
    await seedNotification(alice.userId, true);
    await seedNotification(alice.userId);
    expect((await badges(alice)).notifications).toBe(1);

    const invalidate = vi.spyOn(cache, 'invalidate');
    try {
      await request(harness.server).post(`${NOTIFICATIONS}/clear-read`).set(as(alice)).expect(200);
      expect(invalidate).toHaveBeenCalledWith(BADGE_COUNTS, [alice.userId]);
    } finally {
      invalidate.mockRestore();
    }
    expect((await badges(alice)).notifications).toBe(1);
  });

  it('a write that matched nothing does not bump', async () => {
    const invalidate = vi.spyOn(cache, 'invalidate');
    try {
      await request(harness.server)
        .post(`${NOTIFICATIONS}/00000000-0000-4000-8000-000000000000/read`)
        .set(as(alice))
        .expect(404);
      expect(invalidate).not.toHaveBeenCalled();
    } finally {
      invalidate.mockRestore();
    }
  });
});

describe('every messaging writer invalidates the badge', () => {
  it('send raises the recipient’s count, mark-read lowers it', async () => {
    const conversationId = await thread(alice, [bob]);
    const before = (await badges(bob)).messages;

    const messageId = await send(alice, conversationId);
    expect((await badges(bob)).messages).toBe(before + 1);

    await request(harness.server)
      .post(`${CONV}/${conversationId}/read`)
      .set(as(bob))
      .send({ messageId })
      .expect(200);
    expect((await badges(bob)).messages).toBe(before);
  });

  it('archiving a thread drops its unread messages from the badge', async () => {
    const conversationId = await thread(alice, [bob]);
    const before = (await badges(bob)).messages;
    await send(alice, conversationId);
    expect((await badges(bob)).messages).toBe(before + 1);

    await request(harness.server)
      .patch(`${CONV}/${conversationId}`)
      .set(as(bob))
      .send({ archived: true })
      .expect(204);
    expect((await badges(bob)).messages).toBe(before);
  });

  it('thread creation bumps every participant', async () => {
    const invalidate = vi.spyOn(cache, 'invalidate');
    try {
      await thread(alice, [bob]);
      expect(invalidate).toHaveBeenCalledWith(BADGE_COUNTS, [alice.userId, bob.userId]);
    } finally {
      invalidate.mockRestore();
    }
  });

  it('serves the same, fresh answer to a burst of concurrent polls after a write', async () => {
    const conversationId = await thread(alice, [bob]);
    const before = (await badges(bob)).messages;
    await send(alice, conversationId);

    const burst = await Promise.all(Array.from({ length: 10 }, () => badges(bob)));

    expect(new Set(burst.map((row) => row.messages))).toEqual(new Set([before + 1]));
  });
});

function hitsOf(result: string): number {
  return (
    cache.metrics().find((row) => row.cache === BADGE_COUNTS.name && row.result === result)
      ?.count ?? 0
  );
}
