import { describe, expect, it } from 'vitest';

import { InMemoryPermissionCache, PERMISSION_CACHE_TTL_MS } from './in-memory-permission-cache';
import type { Permission } from './authz.types';

const HELD: readonly Permission[] = ['patients.view', 'records.view'];

/** A cache whose clock the test drives. */
function cacheWithClock(ttlMs = 1_000): {
  cache: InMemoryPermissionCache;
  advance: (ms: number) => void;
} {
  let now = 0;
  const cache = new InMemoryPermissionCache(ttlMs, () => now);

  return {
    cache,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('InMemoryPermissionCache', () => {
  it('returns undefined for a user it has never seen', async () => {
    const { cache } = cacheWithClock();

    expect(await cache.get('u-1')).toBeUndefined();
  });

  it('round-trips a permission set', async () => {
    const { cache } = cacheWithClock();
    await cache.set('u-1', HELD);

    expect(await cache.get('u-1')).toEqual(HELD);
  });

  it('expires an entry once its TTL passes', async () => {
    const { cache, advance } = cacheWithClock(1_000);
    await cache.set('u-1', HELD);

    advance(999);
    expect(await cache.get('u-1')).toEqual(HELD);

    advance(1);
    expect(await cache.get('u-1')).toBeUndefined();
  });

  it('drops the expired entry rather than leaving it resident', async () => {
    const { cache, advance } = cacheWithClock(1_000);
    await cache.set('u-1', HELD);
    advance(2_000);

    await cache.get('u-1');

    expect(cache.size).toBe(0);
  });

  it('forgets one user without touching the others', async () => {
    const { cache } = cacheWithClock();
    await cache.set('u-1', HELD);
    await cache.set('u-2', HELD);

    await cache.forget('u-1');

    expect(await cache.get('u-1')).toBeUndefined();
    expect(await cache.get('u-2')).toEqual(HELD);
  });

  it('forgets many at once and tolerates ids it does not hold', async () => {
    const { cache } = cacheWithClock();
    await cache.set('u-1', HELD);
    await cache.set('u-2', HELD);
    await cache.set('u-3', HELD);

    await cache.forgetMany(['u-1', 'u-3', 'u-absent']);

    expect(cache.size).toBe(1);
    expect(await cache.get('u-2')).toEqual(HELD);
  });

  it('clears everything', async () => {
    const { cache } = cacheWithClock();
    await cache.set('u-1', HELD);
    await cache.set('u-2', HELD);

    await cache.clear();

    expect(cache.size).toBe(0);
  });

  it('overwrites and re-dates an existing entry', async () => {
    const { cache, advance } = cacheWithClock(1_000);
    await cache.set('u-1', HELD);
    advance(900);
    await cache.set('u-1', ['ai.use']);
    advance(900);

    // Re-dated by the second write, so it is still live at t=1800.
    expect(await cache.get('u-1')).toEqual(['ai.use']);
  });

  it('defaults to a TTL inside the access-token life of API §1.2', () => {
    // A cache entry outliving the 15-minute token would let a revoked
    // capability survive a re-login, pushing the "next session issue"
    // boundary of reconciliation §5 rule 4 out past where it is stated.
    expect(PERMISSION_CACHE_TTL_MS).toBeLessThan(15 * 60 * 1000);
  });
});
