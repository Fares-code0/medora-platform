import { randomUUID } from 'node:crypto';

import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { RATE_LIMIT_KEY_PREFIX, RedisRateLimiter } from './redis-rate-limiter';

/**
 * The counter against a real Redis — the same broker CI runs for M30.1 —
 * because the properties that matter (one count shared by two instances,
 * a window that traffic cannot extend) are Redis's semantics.
 */
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

let first: RedisRateLimiter;
let second: RedisRateLimiter;
let raw: Redis;

const key = (): string => `spec:${randomUUID()}`;

beforeAll(async () => {
  first = new RedisRateLimiter(REDIS_URL);
  second = new RedisRateLimiter(REDIS_URL);
  raw = new Redis(REDIS_URL);
  await Promise.all([first.ready(), second.ready()]);
});

afterAll(async () => {
  await first.onModuleDestroy();
  await second.onModuleDestroy();
  await raw.quit();
});

describe('RedisRateLimiter', () => {
  it('counts each hit in the window, across instances', async () => {
    const id = key();

    expect((await first.hit(id, 60))?.count).toBe(1);
    expect((await second.hit(id, 60))?.count).toBe(2);
    expect((await first.hit(id, 60))?.count).toBe(3);
  });

  it('starts the window on the first hit and never extends it', async () => {
    const id = key();
    await first.hit(id, 60);
    // Shorten the live window by hand, then hit again: an EXPIRE without
    // NX would push it back out to 60.
    await raw.expire(`${RATE_LIMIT_KEY_PREFIX}${id}`, 5);

    const hit = await first.hit(id, 60);

    expect(hit?.count).toBe(2);
    expect(hit?.resetSeconds).toBeLessThanOrEqual(5);
  });

  it('expires the key, so a quiet client starts again', async () => {
    const id = key();
    await first.hit(id, 1);
    await new Promise((resolve) => setTimeout(resolve, 1_200));

    expect((await first.hit(id, 1))?.count).toBe(1);
  });

  it('answers null at once when Redis is unreachable', async () => {
    // Port 1 refuses; no offline queue, so the hit fails fast.
    const down = new RedisRateLimiter('redis://127.0.0.1:1');
    const started = Date.now();

    expect(await down.hit(key(), 60)).toBeNull();
    expect(Date.now() - started).toBeLessThan(1_000);

    await down.onModuleDestroy();
  });
});
