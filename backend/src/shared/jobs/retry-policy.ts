/**
 * Retry and backoff (RM M30.1).
 *
 * > ✅ Verify: poisoned job lands in DLQ after N retries.
 *
 * One policy, two enforcers. The in-process driver walks the attempts
 * itself; the BullMQ driver hands the same numbers to the broker as
 * `attempts` and a custom backoff. Both read *this* file, so a job
 * cannot be retried three times on one deployment and five on another —
 * which is the failure mode of writing the numbers twice.
 */

import type { RetryPolicy } from './job.types';

/**
 * The default every sweep uses unless it says otherwise.
 *
 * Three attempts and not more: every job M30.2 registers is a sweep over
 * rows it can re-select, so a failure that survives three tries is a bug
 * or an outage rather than contention, and retrying it forty times turns
 * one broken job into sustained load against a database that is already
 * unhappy. Exponential, because the two failures a retry genuinely fixes
 * — a lock and a brief connection loss — both clear on their own and
 * both are made worse by an immediate retry.
 */
export const DEFAULT_RETRY: RetryPolicy = {
  attempts: 3,
  backoff: 'exponential',
  delayMs: 30_000,
  maxDelayMs: 5 * 60_000,
};

/**
 * A stricter policy for the two drains that run every minute.
 *
 * A one-minute schedule retries itself by existing: the next tick
 * re-claims whatever the failed run left behind, because both drains
 * claim with `FOR UPDATE SKIP LOCKED` and mark as they claim. So a long
 * backoff would only queue a second attempt behind a tick that was going
 * to do the same work anyway.
 */
export const FREQUENT_RETRY: RetryPolicy = {
  attempts: 2,
  backoff: 'fixed',
  delayMs: 5_000,
  maxDelayMs: 5_000,
};

/**
 * How long to wait *before* `attempt`.
 *
 * `attempt` is 1-based and matches `JobContext.attempt`, so the delay
 * before the first retry is `backoffDelayMs(policy, 2)`. Asking for the
 * delay before attempt 1 answers 0 rather than throwing: the first try
 * is not a retry, and a caller that loops from 1 should not have to
 * special-case it.
 */
export function backoffDelayMs(policy: RetryPolicy, attempt: number): number {
  if (attempt <= 1) return 0;

  const raw =
    policy.backoff === 'fixed'
      ? policy.delayMs
      : // `attempt - 2` so the first retry waits `delayMs`, not double it.
        policy.delayMs * 2 ** (attempt - 2);

  return Math.min(raw, policy.maxDelayMs);
}

/**
 * Rejects an unusable policy at registration.
 *
 * `attempts: 0` is the dangerous one — it reads as "do not retry" and
 * means "never run", so a job written that way would sit in the registry
 * looking scheduled and never execute once.
 */
export function assertValidRetry(name: string, policy: RetryPolicy): void {
  if (!Number.isInteger(policy.attempts) || policy.attempts < 1) {
    throw new Error(
      `Job \`${name}\` declares ${String(policy.attempts)} attempts; at least one is required.`,
    );
  }

  if (policy.delayMs < 0 || policy.maxDelayMs < policy.delayMs) {
    throw new Error(
      `Job \`${name}\` has a backoff ceiling (${String(policy.maxDelayMs)} ms) below its first delay (${String(policy.delayMs)} ms).`,
    );
  }
}
