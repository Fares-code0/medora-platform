import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { NotificationDeliveryService } from '../src/modules/notifications/services/notification-delivery.service';
import {
  PUSH_PROVIDER,
  type PushMessage,
  type PushOutcome,
  type PushProvider,
  type PushTarget,
} from '../src/shared/push';
import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  markVerified,
  registrationBody,
  testEmail,
  asJob,
} from './support/auth-app';
import {
  acquireDeliveryWorkerLock,
  DELIVERY_WORKER_LOCK_TIMEOUT_MS,
  type DeliveryWorkerLock,
} from './support/delivery-worker-lock';

/**
 * Push registration and delivery (RM M41.2, mobile contract P5.8).
 *
 * **The provider is a test double.** No push provider is chosen or
 * credentialed for this project, so what is verified is the platform's
 * half: that `POST /me/devices` stores a token it never returns, that a
 * token belongs to one device, and that the delivery worker turns each
 * provider answer into the right `notification_deliveries` row. That a
 * real FCM, APNs or Expo service accepts these requests is **not**
 * verified — see `docs/EXTERNAL_INTEGRATIONS.md`.
 *
 * ## The worker is shared, so this file takes care to read only its own rows
 *
 * `delivery.run()` claims every pending delivery in the table. Three
 * things followed from that under a parallel run, each reproduced:
 *
 * · `notification-delivery.e2e-spec.ts` drives the same worker in another
 *   process, with an unconfigured provider, and claimed this file's rows
 *   first — so they came back `skipped / no-provider` and the scripted
 *   provider was never called. The two files now exclude each other
 *   (`support/delivery-worker-lock.ts`).
 * · A row this file's worker claimed for another suite could be deleted
 *   by that suite before its outcome was written. The worker then throws
 *   on the missing row (`finish` uses `update`, which refuses a row that
 *   is gone), and every row claimed after it in that batch is left in
 *   `sending`. **That is a production defect, and it is not fixed here**:
 *   changing `finish` is a production change that needs its own decision.
 *   The last case in this file pins today's behaviour so the finding is
 *   executable, and fails the moment the behaviour changes. What this
 *   file does instead is keep other suites' rows out of its own batches:
 *   `drainBacklog()` runs the worker over whatever is already pending
 *   before each case creates its rows, tolerating that defect on rows
 *   that are not this file's.
 * · The claim takes the 50 oldest rows. Other suites' leftovers are
 *   older, so one `run()` is not guaranteed to reach this file's row;
 *   `deliver()` runs the worker until it has.
 *
 * **Residual, test-side only:** another suite's row that becomes pending
 * *between* `drainBacklog()` and this case's own `run()`, and is deleted
 * by its owner while that run is in flight, still trips the defect above.
 * The window is milliseconds; closing it fully needs the worker change.
 */

const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const DEVICES = '/api/v1/me/devices';
const PASSWORD = 'Medora123!';

/** A provider whose answers each case scripts. */
class ScriptedPushProvider implements PushProvider {
  configured = true;
  calls: { targets: readonly PushTarget[]; message: PushMessage }[] = [];
  answer: (targets: readonly PushTarget[]) => Promise<readonly PushOutcome[]> = (targets) =>
    Promise.resolve(
      targets.map((target) => ({
        token: target.token,
        outcome: 'sent' as const,
        providerRef: `ref-${target.token}`,
      })),
    );

  send(targets: readonly PushTarget[], message: PushMessage): Promise<readonly PushOutcome[]> {
    this.calls.push({ targets, message });
    return this.answer(targets);
  }
}

const provider = new ScriptedPushProvider();
let harness: AuthHarness;
let delivery: NotificationDeliveryService;

interface Account {
  readonly id: string;
  readonly token: string;
}

async function account(local: string): Promise<Account> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  const login = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });
  const user = await harness.prisma.db.user.findUniqueOrThrow({
    where: { email },
    select: { id: true },
  });
  return { id: user.id, token: dataOf<{ accessToken: string }>(login).accessToken };
}

function registerDevice(owner: Account, body: Record<string, unknown>) {
  return request(harness.server)
    .post(DEVICES)
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ name: 'Phone', platform: 'ios', ...body });
}

/** One pending push delivery for `recipientId`; returns the delivery row id. */
async function pendingPush(
  recipientId: string,
  title = 'Critical lab result released',
): Promise<string> {
  const notification = await harness.prisma.db.notification.create({
    data: {
      recipientId,
      title,
      body: 'Order LAB-1 · Analytes: Potassium',
      category: 'LABORATORY',
      priority: 'CRITICAL',
      kind: 'ALERT',
      sender: 'Medora',
    },
    select: { id: true },
  });
  const row = await harness.prisma.db.notificationDelivery.create({
    data: { notificationId: notification.id, channel: 'PUSH', status: 'pending' },
    select: { id: true },
  });
  return row.id;
}

function deliveryRow(id: string) {
  return harness.prisma.db.notificationDelivery.findUniqueOrThrow({ where: { id } });
}

/** Enough batches to drain any realistic backlog ahead of this file's row. */
const MAX_RUNS = 20;

/**
 * Runs the worker until delivery `id` has been claimed and finished.
 *
 * Bounded, and it fails loudly rather than returning a row still in
 * `pending`: a worker that never reaches the row is a failure worth
 * seeing, not one to time out on.
 */
async function deliver(id: string): Promise<void> {
  for (let attempt = 0; attempt < MAX_RUNS; attempt += 1) {
    await delivery.run();
    const { status } = await deliveryRow(id);
    if (status !== 'pending' && status !== 'sending') return;
  }
  throw new Error(`fixture: delivery ${id} was still unfinished after ${String(MAX_RUNS)} runs`);
}

/**
 * Runs the worker until nothing older than this case is pending.
 *
 * Test isolation, not a workaround in production code: whatever another
 * suite left pending is delivered (or skipped) now, so it is not in the
 * same batch as this case's rows. A run that throws because one of those
 * foreign rows was deleted by its owner mid-run — the defect pinned by the
 * last case — is tolerated here, because the row is not this file's.
 */
async function drainBacklog(): Promise<void> {
  for (let attempt = 0; attempt < MAX_RUNS; attempt += 1) {
    try {
      if ((await delivery.run()).claimed === 0) return;
    } catch {
      // A foreign row vanished mid-run; the next run claims the rest.
    }
  }
}

let alice: Account;
let bob: Account;
let workerLock: DeliveryWorkerLock | undefined;

beforeAll(async () => {
  workerLock = await acquireDeliveryWorkerLock();
}, DELIVERY_WORKER_LOCK_TIMEOUT_MS + 10_000);

beforeAll(async () => {
  harness = await createAuthHarness('push-m412', {
    overrides: [{ token: PUSH_PROVIDER, value: provider }],
  });
  delivery = asJob(harness.app.get(NotificationDeliveryService));
  alice = await account('push-alice');
  bob = await account('push-bob');
}, 90_000);

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
  provider.configured = true;
  provider.calls = [];
  provider.answer = (targets) =>
    Promise.resolve(
      targets.map((target) => ({
        token: target.token,
        outcome: 'sent' as const,
        providerRef: `ref-${target.token}`,
      })),
    );
  await harness.prisma.db.trustedDevice.deleteMany({
    where: { userId: { in: [alice.id, bob.id] } },
  });
  await harness.prisma.db.notification.deleteMany({
    where: { recipientId: { in: [alice.id, bob.id] } },
  });
});

describe('POST /me/devices with a push token', () => {
  it('stores the token and never returns it', async () => {
    const created = await registerDevice(alice, { pushToken: 'token-alice-1' });

    expect(created.status).toBe(201);
    expect(JSON.stringify(created.body)).not.toContain('token-alice-1');
    const stored = await harness.prisma.db.trustedDevice.findUniqueOrThrow({
      where: { id: dataOf<{ id: string }>(created).id },
      select: { pushToken: true },
    });
    expect(stored.pushToken).toBe('token-alice-1');

    const listed = await request(harness.server)
      .get(DEVICES)
      .set('Authorization', `Bearer ${alice.token}`);
    expect(JSON.stringify(listed.body)).not.toContain('token-alice-1');
  });

  it('still registers a device with no token, as before', async () => {
    const created = await registerDevice(alice, {});

    expect(created.status).toBe(201);
    const stored = await harness.prisma.db.trustedDevice.findUniqueOrThrow({
      where: { id: dataOf<{ id: string }>(created).id },
      select: { pushToken: true },
    });
    expect(stored.pushToken).toBeNull();
  });

  it('moves a token to the account that registers it last', async () => {
    await registerDevice(alice, { pushToken: 'handset-1' });
    await registerDevice(bob, { pushToken: 'handset-1' });

    const holders = await harness.prisma.db.trustedDevice.findMany({
      where: { pushToken: 'handset-1' },
      select: { userId: true },
    });
    expect(holders).toEqual([{ userId: bob.id }]);
  });

  it('clears the token when the device is removed', async () => {
    const created = dataOf<{ id: string }>(
      await registerDevice(alice, { pushToken: 'token-gone' }),
    );

    await request(harness.server)
      .delete(`${DEVICES}/${created.id}`)
      .set('Authorization', `Bearer ${alice.token}`)
      .expect(204);

    expect(
      await harness.prisma.db.trustedDevice.count({ where: { pushToken: 'token-gone' } }),
    ).toBe(0);
  });

  it('refuses a token longer than the column', async () => {
    expect((await registerDevice(alice, { pushToken: 'x'.repeat(1025) })).status).toBe(422);
  });
});

describe('the push channel of the delivery worker', () => {
  beforeEach(async () => {
    await drainBacklog();
    // Whatever the drain sent is not this case's; the assertions on
    // `provider.calls` read only what the case itself causes.
    provider.calls = [];
  });

  it('records skipped / no-provider, without calling it, while no provider is configured', async () => {
    provider.configured = false;
    await registerDevice(alice, { pushToken: 'token-a' });
    const id = await pendingPush(alice.id);

    await deliver(id);

    expect(await deliveryRow(id)).toMatchObject({ status: 'skipped', error: 'no-provider' });
    expect(provider.calls).toEqual([]);
  });

  it('records skipped / no-device when the recipient registered no token', async () => {
    const id = await pendingPush(alice.id);

    await deliver(id);

    expect(await deliveryRow(id)).toMatchObject({ status: 'skipped', error: 'no-device' });
  });

  it('sends title and body to every registered device and records sent', async () => {
    await registerDevice(alice, { pushToken: 'token-phone', platform: 'ios' });
    await registerDevice(alice, { pushToken: 'token-tablet', platform: 'android' });
    const id = await pendingPush(alice.id);

    await deliver(id);

    const call = provider.calls.find((entry) =>
      entry.targets.some((target) => target.token === 'token-phone'),
    );
    expect(call?.targets.map((target) => target.token).sort()).toEqual([
      'token-phone',
      'token-tablet',
    ]);
    expect(call?.targets.find((target) => target.token === 'token-tablet')?.platform).toBe(
      'android',
    );
    expect(call?.message).toEqual({
      title: 'Critical lab result released',
      body: 'Order LAB-1 · Analytes: Potassium',
    });
    const row = await deliveryRow(id);
    expect(row.status).toBe('sent');
    expect(row.providerRef).toMatch(/^ref-token-/);
  });

  it('clears a token the provider calls invalid, and fails the row when no device accepted', async () => {
    await registerDevice(alice, { pushToken: 'token-stale' });
    provider.answer = (targets) =>
      Promise.resolve(
        targets.map((target) => ({ token: target.token, outcome: 'invalid-token' as const })),
      );
    const id = await pendingPush(alice.id);

    await deliver(id);

    expect(await deliveryRow(id)).toMatchObject({ status: 'failed', error: 'invalid-token' });
    expect(
      await harness.prisma.db.trustedDevice.count({ where: { pushToken: 'token-stale' } }),
    ).toBe(0);
  });

  it('records sent when one device accepts and another is invalid', async () => {
    await registerDevice(alice, { pushToken: 'token-good' });
    await registerDevice(alice, { pushToken: 'token-bad' });
    provider.answer = (targets) =>
      Promise.resolve(
        targets.map((target) =>
          target.token === 'token-bad'
            ? { token: target.token, outcome: 'invalid-token' as const }
            : { token: target.token, outcome: 'sent' as const, providerRef: 'ref-good' },
        ),
      );
    const id = await pendingPush(alice.id);

    await deliver(id);

    expect(await deliveryRow(id)).toMatchObject({ status: 'sent', providerRef: 'ref-good' });
    expect(
      await harness.prisma.db.trustedDevice.count({ where: { pushToken: 'token-good' } }),
    ).toBe(1);
    expect(await harness.prisma.db.trustedDevice.count({ where: { pushToken: 'token-bad' } })).toBe(
      0,
    );
  });

  it('records failed / send-failed when the provider itself fails', async () => {
    await registerDevice(alice, { pushToken: 'token-a' });
    provider.answer = () => Promise.reject(new Error('provider unavailable'));
    const id = await pendingPush(alice.id);

    await deliver(id);

    expect(await deliveryRow(id)).toMatchObject({ status: 'failed', error: 'send-failed' });
    // The token is not the problem, so it is kept.
    expect(await harness.prisma.db.trustedDevice.count({ where: { pushToken: 'token-a' } })).toBe(
      1,
    );
  });

  it('KNOWN DEFECT (not fixed; needs a decision): a claimed row deleted mid-run aborts the run and strands the rest of the batch in `sending`', async () => {
    // Characterisation, not a fix. The worker claims a batch (status
    // `pending` → `sending`), then delivers it row by row. When a row's
    // notification is deleted in between — here, during its own send —
    // `finish` calls `update` on a row that no longer exists, Prisma
    // throws P2025, and `run()` rejects. Every row claimed after it in the
    // same batch stays in `sending`, and `claim` only ever picks up
    // `pending`, so nothing delivers those rows again.
    //
    // Production code does not delete notifications or deliveries today,
    // so the path is not reachable in production as built; it is reached
    // in this suite by another file's cleanup. See the file header.
    await registerDevice(alice, { pushToken: 'token-vanish' });
    // Two rows, told apart by title. The batch's delivery order is not
    // specified (`claim` orders the claim, not the rows it returns), so
    // the provider deletes the notification of whichever row it is
    // actually asked to send first; the other row is the stranded one.
    const rows = new Map<string, string>([
      ['Vanishing A', await pendingPush(alice.id, 'Vanishing A')],
      ['Vanishing B', await pendingPush(alice.id, 'Vanishing B')],
    ]);

    let vanishedTitle: string | undefined;
    provider.answer = async (targets) => {
      if (vanishedTitle === undefined) {
        vanishedTitle = provider.calls.at(-1)?.message.title;
        const id = rows.get(vanishedTitle ?? '');
        if (id === undefined)
          throw new Error('fixture: the first send is not one of this case’s rows');
        const { notificationId } = await deliveryRow(id);
        await harness.prisma.db.notification.delete({ where: { id: notificationId } });
      }
      return targets.map((target) => ({
        token: target.token,
        outcome: 'sent' as const,
        providerRef: 'ref-after',
      }));
    };

    await expect(delivery.run()).rejects.toMatchObject({ code: 'P2025' });

    const vanished = rows.get(vanishedTitle ?? '');
    const stranded = [...rows.values()].find((id) => id !== vanished);
    if (vanished === undefined || stranded === undefined)
      throw new Error('fixture: no row vanished');
    // The vanished row is gone with its notification …
    expect(await harness.prisma.db.notificationDelivery.count({ where: { id: vanished } })).toBe(0);
    // … and the other row, claimed in the same batch, was never finished.
    expect(await deliveryRow(stranded)).toMatchObject({ status: 'sending', providerRef: null });
    // No later run picks it up again: `claim` takes only `pending`.
    await delivery.run();
    expect(await deliveryRow(stranded)).toMatchObject({ status: 'sending' });
  });
});
