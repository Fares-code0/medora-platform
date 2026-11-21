import pg from 'pg';

/**
 * One delivery-worker spec at a time, across Vitest's parallel workers.
 *
 * `NotificationDeliveryService.run()` is the process-wide worker: it
 * claims **every** pending row in `notification_deliveries`, oldest first,
 * whoever wrote it. Two spec files drive it — `notification-delivery` and
 * `push-delivery` — each against its own application, with its own mailer
 * and push provider. Run together, each claimed the other's rows and
 * delivered them through the wrong double: `push-delivery`'s row came back
 * `skipped / no-provider` from the other file's unconfigured provider, and
 * its scripted provider was never called. Reproduced 6 times in 12 runs of
 * the two files with `notification-fanout`.
 *
 * Scoping the assertions to a file's own rows (which `notification-
 * delivery` already does) cannot help here, because the outcome being
 * asserted is decided by whichever application claimed the row. So the
 * two files exclude each other for their whole run: a session-level
 * PostgreSQL advisory lock, held on a dedicated connection from `beforeAll`
 * to `afterAll`.
 *
 * Three more files hold the same lock: `notification-fanout`,
 * `badge-cache` and `record-issue-queue`, the only specs that call
 * `NotificationDispatchService.drain()`. A drain writes pending delivery
 * rows, and those files delete their notifications (and so, by cascade,
 * the rows) in their own cleanup. A worker run that had claimed one of
 * those rows then failed in `finish`, whose `update` refuses a row that is
 * gone — a production behaviour that is recorded as a finding and is
 * **not** changed by this test isolation (see the last case of
 * `push-delivery.e2e-spec.ts`). Holding the lock, no drain and no worker
 * run overlap. Every other file keeps running in parallel.
 *
 * A worker that dies holding the lock drops its connection, and
 * PostgreSQL releases a session lock with it, so a crashed file cannot
 * wedge the next one.
 */

/** Arbitrary, fixed, and used for nothing else in this repository. */
const DELIVERY_WORKER_LOCK = 4_120_419;

/**
 * How long a file waits for the other to finish. Each takes seconds; the
 * hook that calls this must allow at least this long.
 */
export const DELIVERY_WORKER_LOCK_TIMEOUT_MS = 180_000;

export interface DeliveryWorkerLock {
  release(): Promise<void>;
}

export async function acquireDeliveryWorkerLock(
  connectionString: string = process.env['DATABASE_URL'] ?? '',
): Promise<DeliveryWorkerLock> {
  const client = new pg.Client({ connectionString });
  await client.connect();

  try {
    // Server-side bound, so a wait that outlives the hook fails with a
    // named error rather than as an anonymous hook timeout.
    await client.query(`SET lock_timeout = ${String(DELIVERY_WORKER_LOCK_TIMEOUT_MS)}`);
    await client.query('SELECT pg_advisory_lock($1)', [DELIVERY_WORKER_LOCK]);
  } catch (error) {
    await client.end();
    throw error;
  }

  return {
    async release(): Promise<void> {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [DELIVERY_WORKER_LOCK]);
      } finally {
        await client.end();
      }
    },
  };
}
