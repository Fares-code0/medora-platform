/**
 * The per-client rate limit (M37.2, unified counters per RM M31.1).
 *
 * A port, like the permission cache: the counter lives in Redis so N
 * instances share one count per client, and a spec substitutes a fake.
 */

export const RATE_LIMITER = Symbol('RATE_LIMITER');

/**
 * A named group of routes that share one counter per client.
 *
 * `patient_ai` (ADR-050): patient assistant sends, counted apart from the
 * credential routes so a chat cannot spend a login allowance. Same
 * max / window as `auth` (RATE_LIMIT_AUTH_*), off unless RATE_LIMIT_ENABLED.
 */
export type RateLimitBucket = 'auth' | 'patient_ai';

export interface RateLimitHit {
  /** Requests counted in the current window, this one included. */
  readonly count: number;
  /** Seconds until the window resets. */
  readonly resetSeconds: number;
}

export interface RateLimiter {
  /**
   * Counts one request for `key` in a fixed window of `windowSeconds`.
   * Resolves `null` when the counter is unavailable, so the caller can
   * decide what an outage means rather than receiving an exception.
   */
  hit(key: string, windowSeconds: number): Promise<RateLimitHit | null>;
}
