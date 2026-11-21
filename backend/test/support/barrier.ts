import type { PrismaService } from '../../src/shared/database';

/**
 * Deterministic interleaving for the booking-concurrency suite (BE-1).
 *
 * A concurrency test that relies on two requests "probably" overlapping
 * passes on a fast machine and fails on a slow one, or the reverse. These
 * helpers let a test hold one request at a known point and decide when it
 * moves on — from observed state, never from elapsed time.
 *
 * Timeouts here only turn a hang into a readable failure. They never
 * decide an outcome: `waitUntil` throws when its deadline passes, it does
 * not return a default.
 */

/**
 * A one-shot gate. Callers `arrive()` and park until the test calls
 * `open()`; anyone arriving after `open()` passes straight through.
 */
export interface Gate {
  arrive(): Promise<void>;
  /** How many callers have arrived so far, parked or not. */
  arrivals(): number;
  open(): void;
}

export function createGate(): Gate {
  let count = 0;
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });

  return {
    arrive: async () => {
      count += 1;
      await opened;
    },
    arrivals: () => count,
    open: () => release(),
  };
}

/**
 * Polls `probe` until it returns a value other than `undefined`, and
 * returns that value. Throws, naming `what`, if `timeoutMs` passes first.
 */
export async function waitUntil<T>(
  probe: () => Promise<T | undefined> | T | undefined,
  what: string,
  timeoutMs = 10_000,
  intervalMs = 15,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    const value = await probe();
    if (value !== undefined) return value;
    if (Date.now() > deadline) {
      throw new Error(`Timed out after ${String(timeoutMs)} ms waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

/**
 * How many sessions are blocked waiting for the row lock on one doctor's
 * `doctors` row.
 *
 * Precise to the row, not just the table: PostgreSQL's first waiter on a
 * locked row holds the heavyweight *tuple* lock for that row (and then
 * waits on the holder's transaction id); later waiters queue on the tuple
 * lock itself. Either way a `tuple` entry for this row's page and offset
 * belongs to a session whose wait event is `Lock`. Filtering by `ctid`
 * keeps a booking for some other doctor — in this file or a parallel one
 * — from being counted.
 */
export async function scheduleLockWaiters(
  prisma: PrismaService,
  doctorId: string,
): Promise<number> {
  const rows = await prisma.$queryRaw<{ waiters: number }[]>`
    WITH target AS (
      SELECT (ctid::text::point)[0]::int AS page, (ctid::text::point)[1]::int AS tuple
      FROM doctors WHERE id = ${doctorId}::uuid
    )
    SELECT count(DISTINCT l.pid)::int AS waiters
    FROM pg_locks l
    JOIN pg_stat_activity a ON a.pid = l.pid
    CROSS JOIN target t
    WHERE l.locktype = 'tuple'
      AND l.relation = 'doctors'::regclass
      AND l.page = t.page
      AND l.tuple = t.tuple
      AND a.wait_event_type = 'Lock'`;

  return rows[0]?.waiters ?? 0;
}
