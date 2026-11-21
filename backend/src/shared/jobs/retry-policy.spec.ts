import { describe, expect, it } from 'vitest';

import { assertValidRetry, backoffDelayMs, DEFAULT_RETRY, FREQUENT_RETRY } from './retry-policy';

/**
 * Retry and backoff (RM M30.1).
 *
 * One policy with two enforcers — the in-process loop and BullMQ's
 * custom backoff strategy — and both call `backoffDelayMs`. These are
 * the numbers both of them produce.
 */
describe('backoffDelayMs', () => {
  it('waits nothing before the first attempt', () => {
    // 1-based, matching `JobContext.attempt`. The first try is not a
    // retry, so a caller looping from 1 needs no special case.
    expect(backoffDelayMs(DEFAULT_RETRY, 1)).toBe(0);
    expect(backoffDelayMs(DEFAULT_RETRY, 0)).toBe(0);
  });

  it('waits `delayMs` before the first retry, not double it', () => {
    expect(backoffDelayMs(DEFAULT_RETRY, 2)).toBe(30_000);
  });

  it('doubles per attempt after that', () => {
    expect(backoffDelayMs(DEFAULT_RETRY, 3)).toBe(60_000);
    expect(backoffDelayMs(DEFAULT_RETRY, 4)).toBe(120_000);
  });

  it('never exceeds the ceiling', () => {
    // The reason `maxDelayMs` exists: without it a generous `attempts`
    // turns a job meant to recover in minutes into one that recovers
    // tomorrow.
    expect(backoffDelayMs(DEFAULT_RETRY, 12)).toBe(DEFAULT_RETRY.maxDelayMs);
  });

  it('holds a fixed policy flat', () => {
    expect(backoffDelayMs(FREQUENT_RETRY, 2)).toBe(5_000);
    expect(backoffDelayMs(FREQUENT_RETRY, 9)).toBe(5_000);
  });
});

describe('assertValidRetry', () => {
  it('refuses zero attempts, which reads as “no retry” and means “never run”', () => {
    expect(() => {
      assertValidRetry('x', { ...DEFAULT_RETRY, attempts: 0 });
    }).toThrow(/at least one is required/);
  });

  it('refuses a ceiling below the first delay', () => {
    expect(() => {
      assertValidRetry('x', { ...DEFAULT_RETRY, delayMs: 60_000, maxDelayMs: 1_000 });
    }).toThrow(/below its first delay/);
  });

  it('accepts the two shipped policies', () => {
    expect(() => {
      assertValidRetry('a', DEFAULT_RETRY);
      assertValidRetry('b', FREQUENT_RETRY);
    }).not.toThrow();
  });
});
