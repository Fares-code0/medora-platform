import { describe, expect, it, vi } from 'vitest';

import { CacheService } from './cache.service';
import type { CacheBackend, CacheSpec } from './cache.types';

/** Redis's semantics for the three operations, without Redis. */
class MemoryBackend implements CacheBackend {
  readonly values = new Map<string, string>();
  failReads = false;
  failWrites = false;
  failBumps = false;

  mget(keys: readonly string[]): Promise<(string | null)[]> {
    if (this.failReads) return Promise.reject(new Error('read down'));
    return Promise.resolve(keys.map((key) => this.values.get(key) ?? null));
  }

  write(input: { entryKey: string; value: string; versionKey: string }): Promise<void> {
    if (this.failWrites) return Promise.reject(new Error('write down'));
    this.values.set(input.entryKey, input.value);
    if (!this.values.has(input.versionKey)) this.values.set(input.versionKey, '0');
    return Promise.resolve();
  }

  bump(versionKeys: readonly string[]): Promise<void> {
    if (this.failBumps) return Promise.reject(new Error('bump down'));
    for (const key of versionKeys) {
      this.values.set(key, String(Number(this.values.get(key) ?? '0') + 1));
    }
    return Promise.resolve();
  }
}

const SPEC: CacheSpec = { name: 'test-cache', ttlMs: 60_000 };

function setup() {
  const backend = new MemoryBackend();
  return { backend, cache: new CacheService(backend) };
}

function counts(cache: CacheService): Record<string, number> {
  return Object.fromEntries(
    cache.metrics().map((row) => [`${row.cache}:${row.result}`, row.count]),
  );
}

/** A load that resolves when told to. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

describe('CacheService.get', () => {
  it('loads on a miss and serves the stored value on the next read', async () => {
    const { cache } = setup();
    const load = vi.fn().mockResolvedValue({ n: 1 });

    expect(await cache.get(SPEC, 'u1', '', load)).toEqual({ n: 1 });
    expect(await cache.get(SPEC, 'u1', '', load)).toEqual({ n: 1 });

    expect(load).toHaveBeenCalledTimes(1);
    expect(counts(cache)).toMatchObject({ 'test-cache:miss': 1, 'test-cache:hit': 1 });
  });

  it('keeps scopes apart', async () => {
    const { cache } = setup();

    await cache.get(SPEC, 'u1', '', () => Promise.resolve('one'));

    expect(await cache.get(SPEC, 'u2', '', () => Promise.resolve('two'))).toBe('two');
  });

  it('misses after an invalidation and loads the new value', async () => {
    const { cache } = setup();
    let value = 1;
    const load = () => Promise.resolve(value);

    await cache.get(SPEC, 'u1', '', load);
    value = 2;
    await cache.invalidate(SPEC, ['u1']);

    expect(await cache.get(SPEC, 'u1', '', load)).toBe(2);
  });

  it('never serves a value loaded before an invalidation that landed during the load', async () => {
    // The race delete-on-write loses: read old → write commits and
    // invalidates → the old load is stored. The version makes it inert.
    const { cache } = setup();
    const slow = deferred<number>();

    const reading = cache.get(SPEC, 'u1', '', () => slow.promise);
    await Promise.resolve();
    await cache.invalidate(SPEC, ['u1']); // the writer, after its commit
    slow.resolve(1); // the pre-commit value
    expect(await reading).toBe(1);

    expect(await cache.get(SPEC, 'u1', '', () => Promise.resolve(2))).toBe(2);
  });

  it('shares one load between concurrent misses', async () => {
    const { cache } = setup();
    const slow = deferred<number>();
    const load = vi.fn(() => slow.promise);

    const all = Promise.all([
      cache.get(SPEC, 'u1', '', load),
      cache.get(SPEC, 'u1', '', load),
      cache.get(SPEC, 'u1', '', load),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    slow.resolve(7);

    expect(await all).toEqual([7, 7, 7]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(counts(cache)['test-cache:coalesced']).toBe(2);
  });

  it('does not let a caller that has seen a newer version join an older load', async () => {
    const { cache } = setup();
    const slow = deferred<number>();
    const fresh = vi.fn().mockResolvedValue(2);

    const old = cache.get(SPEC, 'u1', '', () => slow.promise);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await cache.invalidate(SPEC, ['u1']);

    expect(await cache.get(SPEC, 'u1', '', fresh)).toBe(2);
    expect(fresh).toHaveBeenCalledTimes(1);

    slow.resolve(1);
    expect(await old).toBe(1);
  });

  it('answers from the database when the store cannot be read', async () => {
    const { backend, cache } = setup();
    backend.failReads = true;

    expect(await cache.get(SPEC, 'u1', '', () => Promise.resolve('db'))).toBe('db');
    expect(counts(cache)['test-cache:error']).toBe(1);
  });

  it('still answers when the store cannot be written', async () => {
    const { backend, cache } = setup();
    backend.failWrites = true;

    expect(await cache.get(SPEC, 'u1', '', () => Promise.resolve('db'))).toBe('db');
    expect(counts(cache)['test-cache:error']).toBe(1);
  });

  it('treats a corrupt or foreign value as a miss', async () => {
    const { backend, cache } = setup();
    backend.values.set('medora:cache:test-cache:e:u1:', 'not json');

    expect(await cache.get(SPEC, 'u1', '', () => Promise.resolve('db'))).toBe('db');
  });

  it('propagates a load failure and does not cache it', async () => {
    const { cache } = setup();

    await expect(
      cache.get(SPEC, 'u1', '', () => Promise.reject(new Error('db down'))),
    ).rejects.toThrow('db down');
    expect(await cache.get(SPEC, 'u1', '', () => Promise.resolve('ok'))).toBe('ok');
  });
});

describe('CacheService.invalidate', () => {
  it('never throws, and counts a failed bump', async () => {
    const { backend, cache } = setup();
    backend.failBumps = true;

    await expect(cache.invalidate(SPEC, ['u1'])).resolves.toBeUndefined();
    expect(counts(cache)['test-cache:invalidation_error']).toBe(1);
  });

  it('does nothing for no scopes', async () => {
    const { backend, cache } = setup();
    const bump = vi.spyOn(backend, 'bump');

    await cache.invalidate(SPEC, []);

    expect(bump).not.toHaveBeenCalled();
  });
});

describe('CacheService.getMany', () => {
  it('loads only what missed, then serves everything', async () => {
    const { cache } = setup();
    const loader = vi.fn((keys: readonly string[]) =>
      Promise.resolve(new Map(keys.map((key) => [key, `id-${key}`]))),
    );

    expect([...(await cache.getMany(SPEC, 'all', ['A', 'B'], loader)).entries()]).toEqual([
      ['A', 'id-A'],
      ['B', 'id-B'],
    ]);
    expect([...(await cache.getMany(SPEC, 'all', ['A', 'B', 'C'], loader)).keys()].sort()).toEqual([
      'A',
      'B',
      'C',
    ]);

    expect(loader).toHaveBeenNthCalledWith(2, ['C']);
  });

  it('does not cache a key the loader could not resolve', async () => {
    const { cache } = setup();
    const loader = vi.fn(() => Promise.resolve(new Map<string, string>()));

    await cache.getMany(SPEC, 'all', ['NOPE'], loader);
    await cache.getMany(SPEC, 'all', ['NOPE'], loader);

    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('loads everything from the database when the store is down', async () => {
    const { backend, cache } = setup();
    backend.failReads = true;
    const loader = vi.fn((keys: readonly string[]) =>
      Promise.resolve(new Map(keys.map((key) => [key, key]))),
    );

    expect((await cache.getMany(SPEC, 'all', ['A'], loader)).get('A')).toBe('A');
    expect(loader).toHaveBeenCalledWith(['A']);
  });
});

describe('CacheService.coalesce', () => {
  it('shares one run between concurrent callers with the same key', async () => {
    const { cache } = setup();
    const slow = deferred<string>();
    const run = vi.fn(() => slow.promise);

    const both = Promise.all([
      cache.coalesce('dash', 'u1', run),
      cache.coalesce('dash', 'u1', run),
    ]);
    slow.resolve('composite');

    expect(await both).toEqual(['composite', 'composite']);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('never shares between different keys, and keeps nothing once settled', async () => {
    const { cache } = setup();
    const run = vi.fn((label: string) => Promise.resolve(label));

    await Promise.all([
      cache.coalesce('dash', 'u1', () => run('u1')),
      cache.coalesce('dash', 'u2', () => run('u2')),
    ]);
    await cache.coalesce('dash', 'u1', () => run('u1 again'));

    expect(run).toHaveBeenCalledTimes(3);
  });

  it('clears a failed run so the next caller runs again', async () => {
    const { cache } = setup();

    await expect(
      cache.coalesce('dash', 'u1', () => Promise.reject(new Error('x'))),
    ).rejects.toThrow('x');
    expect(await cache.coalesce('dash', 'u1', () => Promise.resolve('ok'))).toBe('ok');
  });
});

describe('CacheService.metrics', () => {
  it('labels by cache name and outcome only — never a scope or a key', async () => {
    const { cache } = setup();

    await cache.get(SPEC, 'user-uuid-123', 'secret-key', () => Promise.resolve(1));

    const exposed = JSON.stringify(cache.metrics());
    expect(exposed).not.toContain('user-uuid-123');
    expect(exposed).not.toContain('secret-key');
  });
});
