import { randomUUID } from 'node:crypto';

import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CacheService } from './cache.service';
import { entryKey, versionKey } from './cache.specs';
import { RedisCacheBackend } from './redis-cache.backend';

/**
 * Against the suite's real Redis (`REDIS_URL`), in a namespace of this
 * file's own, so the commands the kernel depends on — `MULTI`, `SET NX`,
 * `PEXPIRE`, `INCR` — are asserted as Redis executes them.
 */
const URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
const SPEC = { name: `spec-${randomUUID().slice(0, 8)}`, ttlMs: 2_000 };

let backend: RedisCacheBackend;
let probe: Redis;

beforeAll(() => {
  backend = new RedisCacheBackend(URL);
  probe = new Redis(URL);
});

afterAll(async () => {
  const keys = await probe.keys(`medora:cache:${SPEC.name}:*`);
  if (keys.length > 0) await probe.del(...keys);
  backend.onModuleDestroy();
  probe.disconnect();
});

async function ready(): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      await backend.mget(['medora:cache:warmup']);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

describe('RedisCacheBackend', () => {
  it('stores an entry and creates the scope version at 0, outliving the entry', async () => {
    await ready();
    const entry = entryKey(SPEC, 's1', 'k');
    const version = versionKey(SPEC, 's1');

    await backend.write({
      entryKey: entry,
      value: 'v',
      ttlMs: 2_000,
      versionKey: version,
      versionTtlMs: 4_000,
    });

    expect(await backend.mget([entry, version])).toEqual(['v', '0']);
    const [entryTtl, versionTtl] = await Promise.all([probe.pttl(entry), probe.pttl(version)]);
    expect(entryTtl).toBeGreaterThan(0);
    expect(versionTtl).toBeGreaterThan(entryTtl);
  });

  it('does not reset an existing version when an entry is written', async () => {
    const version = versionKey(SPEC, 's2');
    await probe.set(version, '7');

    await backend.write({
      entryKey: entryKey(SPEC, 's2', 'k'),
      value: 'v',
      ttlMs: 2_000,
      versionKey: version,
      versionTtlMs: 4_000,
    });

    expect(await probe.get(version)).toBe('7');
    expect(await probe.pttl(version)).toBeGreaterThan(0);
  });

  it('bumps versions, creating an absent one at 1, with an expiry', async () => {
    const a = versionKey(SPEC, 's3');
    const b = versionKey(SPEC, 's4');
    await probe.set(a, '3');

    await backend.bump([a, b], 4_000);

    expect(await probe.mget(a, b)).toEqual(['4', '1']);
    expect(await probe.pttl(b)).toBeGreaterThan(0);
  });

  it('rejects when a command inside the transaction fails', async () => {
    const version = versionKey(SPEC, 's5');
    await probe.set(version, 'not-a-number');

    await expect(backend.bump([version], 4_000)).rejects.toBeDefined();
  });

  it('fails at once, without queueing, when Redis is unreachable', async () => {
    const dead = new RedisCacheBackend('redis://127.0.0.1:6391');
    const started = Date.now();

    await expect(dead.mget(['x'])).rejects.toBeDefined();
    expect(Date.now() - started).toBeLessThan(1_000);

    dead.onModuleDestroy();
  });

  it('serves a hit through the service, and a miss after a bump', async () => {
    const cache = new CacheService(backend);
    let value = 1;

    expect(await cache.get(SPEC, 's6', '', () => Promise.resolve(value))).toBe(1);
    value = 2;
    expect(await cache.get(SPEC, 's6', '', () => Promise.resolve(value))).toBe(1);

    await cache.invalidate(SPEC, ['s6']);
    expect(await cache.get(SPEC, 's6', '', () => Promise.resolve(value))).toBe(2);
  });

  it('expires an entry at its TTL even when nothing invalidates it', async () => {
    const cache = new CacheService(backend);
    const short = { name: SPEC.name, ttlMs: 150 };
    let value = 1;

    await cache.get(short, 's7', '', () => Promise.resolve(value));
    value = 2;
    await new Promise((resolve) => setTimeout(resolve, 250));

    expect(await cache.get(short, 's7', '', () => Promise.resolve(value))).toBe(2);
  });
});
