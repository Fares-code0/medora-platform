import { randomUUID } from 'node:crypto';

import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Permission } from './authz.types';
import { PERMISSION_CACHE_KEY_PREFIX, RedisPermissionCache } from './redis-permission-cache';

/**
 * The Redis `PERMISSION_CACHE` (RM M7.1, AF-25).
 *
 * Against a real broker, as M30.1's BullMQ driver spec is, because the
 * properties that matter — a TTL the server enforces, an invalidation
 * that one connection makes and another observes, a prefix-scoped clear
 * that leaves the job queue's keys alone — are Redis's behaviour, and a
 * mock would only assert this file's spelling of the commands.
 *
 * > ✅ Verify (M7.1): guard unit tests; **cache invalidation test**.
 */
const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
const TTL_MS = 60_000;

const DOCTOR: readonly Permission[] = ['patients.view', 'appointments.manageOwn'];

let first: RedisPermissionCache;
let second: RedisPermissionCache;
let raw: Redis;

const user = (): string => randomUUID();

beforeAll(async () => {
  // Two instances: two API processes, one shared store.
  first = new RedisPermissionCache(REDIS_URL, TTL_MS);
  second = new RedisPermissionCache(REDIS_URL, TTL_MS);
  raw = new Redis(REDIS_URL);
  // Before `ready`, a command fails by design (no offline queue) — see
  // the last describe block. These cases are about the cache, not that.
  await Promise.all([first.ready(), second.ready()]);
});

afterAll(async () => {
  await first.onModuleDestroy();
  await second.onModuleDestroy();
  await raw.quit();
});

describe('read-through storage', () => {
  it('returns what was set', async () => {
    const id = user();
    await first.set(id, DOCTOR);

    expect(await first.get(id)).toEqual(DOCTOR);
  });

  it('answers a miss as undefined, not as an empty set', async () => {
    // An empty array would read as "holds nothing" — a denial. A miss
    // must send the resolver to the database instead.
    expect(await first.get(user())).toBeUndefined();
  });

  it('stores the entry with the TTL, so the server expires it', async () => {
    const id = user();
    await first.set(id, DOCTOR);

    const ttl = await raw.pttl(`${PERMISSION_CACHE_KEY_PREFIX}${id}`);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(TTL_MS);
  });

  it('treats a corrupt entry as a miss rather than trusting it', async () => {
    const id = user();
    await raw.set(`${PERMISSION_CACHE_KEY_PREFIX}${id}`, '{"not":"an array"}');
    expect(await first.get(id)).toBeUndefined();

    await raw.set(`${PERMISSION_CACHE_KEY_PREFIX}${id}`, '[1, 2]');
    expect(await first.get(id)).toBeUndefined();

    await raw.set(`${PERMISSION_CACHE_KEY_PREFIX}${id}`, 'not json');
    expect(await first.get(id)).toBeUndefined();
  });
});

describe('an invalidation on one instance reaches every instance (the reason for Redis)', () => {
  it('forget on one instance is seen by the other', async () => {
    const id = user();
    await first.set(id, DOCTOR);
    expect(await second.get(id)).toEqual(DOCTOR);

    await second.forget(id);

    // With the per-process map, `first` would still answer DOCTOR here
    // until its TTL ran out — the revocation that did not take.
    expect(await first.get(id)).toBeUndefined();
  });

  it('forgetMany drops every named user, and only those', async () => {
    const [a, b, kept] = [user(), user(), user()];
    await Promise.all([first.set(a, DOCTOR), first.set(b, DOCTOR), first.set(kept, DOCTOR)]);

    await second.forgetMany([a, b]);

    expect(await first.get(a)).toBeUndefined();
    expect(await first.get(b)).toBeUndefined();
    expect(await first.get(kept)).toEqual(DOCTOR);
  });

  it('forgetMany with nobody to forget is a no-op, not an error', async () => {
    await expect(first.forgetMany([])).resolves.toBeUndefined();
  });

  it('clear empties the permission entries and leaves the job queue alone', async () => {
    const id = user();
    const queueKey = `bull:permission-cache-spec:${randomUUID()}`;
    await first.set(id, DOCTOR);
    await raw.set(queueKey, 'job state');

    await second.clear();

    expect(await first.get(id)).toBeUndefined();
    // Shares `REDIS_URL` with BullMQ (M30.1): a FLUSHDB-style clear would
    // have deleted the queue's state along with ours.
    expect(await raw.get(queueKey)).toBe('job state');
    await raw.del(queueKey);
  });
});

describe('an unreachable Redis fails fast, so the resolver can fall back', () => {
  it('rejects promptly instead of queueing the command until a reconnect', async () => {
    // Nothing listens on port 1. ioredis's defaults would hold this
    // command in the offline queue indefinitely, stalling every `@Can`
    // request behind it; the resolver can only treat a failure as a miss
    // if the failure arrives.
    const down = new RedisPermissionCache('redis://127.0.0.1:1', TTL_MS);
    const started = Date.now();

    await expect(down.get(user())).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(1_000);

    await down.onModuleDestroy();
  });
});
