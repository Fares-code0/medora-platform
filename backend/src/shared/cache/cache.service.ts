/**
 * The cache kernel (RM M31.1) — one Redis-backed read-through cache with
 * versioned invalidation, in-process single-flight and per-cache counters.
 *
 * ## Consistency: versions, not deletes
 *
 * Delete-on-write has a race that serves stale data until the TTL: a
 * reader misses, loads the **old** value, a writer commits and deletes
 * the key, and the reader then stores the old value it loaded. Here every
 * scope (one user's badge; the whole reference set) has a **version key**,
 * and an entry is stored as `{ v, d }`:
 *
 *  - a reader fetches the entry *and* the version in one `MGET`, and an
 *    entry is a hit only when its `v` equals the current version;
 *  - on a miss the reader loads and stores under the version it **read
 *    before loading**;
 *  - a writer bumps the version (`INCR`) **after its transaction commits**.
 *
 * A load that began before a commit stores under the old version, which
 * the bump has already left behind, so no reader accepts it. A load that
 * began after the bump was observed began after the commit, so it sees
 * the new rows. Correct by construction, not by timing.
 *
 * The version key is kept alive at least twice as long as any entry
 * written under it (`write` extends it every time), so it never expires
 * while an entry that could match a recreated version still exists.
 *
 * ## Single-flight, without sharing a stale load
 *
 * Concurrent misses for one entry share one load — the stampede
 * protection. The flight is keyed by entry **and observed version**: a
 * caller that has seen a newer version (because it has just written)
 * never joins a load that started before that write.
 *
 * ## A cache that fails is a cache that misses
 *
 * Every store call is caught. A failed read loads from the database; a
 * failed write is dropped; neither reaches the caller. A failed **bump**
 * is the one case that can serve stale data, so it is counted
 * (`invalidation_error`), logged, and bounded by the cache's TTL.
 *
 * ## What the counters and logs carry
 *
 * Cache names and outcomes. Never a key, a scope (a user id) or a value:
 * `/metrics` is for operators, and a badge count is a person's inbox.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';

import { entryKey, versionKey, versionTtlMs } from './cache.specs';
import {
  CACHE_BACKEND,
  type CacheBackend,
  type CacheCounter,
  type CacheResult,
  type CacheSpec,
} from './cache.types';

interface StoredEntry {
  readonly v: string;
  readonly d: unknown;
}

/** The version of a scope nobody has written or bumped yet. */
const INITIAL_VERSION = '0';

@Injectable()
export class CacheService {
  private readonly logger = new Logger(CacheService.name);
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly counters = new Map<string, number>();

  constructor(@Inject(CACHE_BACKEND) private readonly backend: CacheBackend) {}

  /** Read-through for one entry. `load` runs only on a miss. */
  async get<T>(spec: CacheSpec, scope: string, key: string, load: () => Promise<T>): Promise<T> {
    const entry = entryKey(spec, scope, key);
    const version = versionKey(spec, scope);

    let current: string;
    try {
      const [raw, stored] = await this.backend.mget([entry, version]);
      current = stored ?? INITIAL_VERSION;

      const hit = parse(raw ?? null);
      if (hit !== null && hit.v === current) {
        this.count(spec.name, 'hit');
        return hit.d as T;
      }
    } catch {
      this.count(spec.name, 'error');
      return load();
    }

    const flight = `${entry}@${current}`;
    const pending = this.inFlight.get(flight);
    if (pending !== undefined) {
      this.count(spec.name, 'coalesced');
      return pending as Promise<T>;
    }

    this.count(spec.name, 'miss');
    const loading = this.loadAndStore(spec, entry, version, current, load).finally(() => {
      this.inFlight.delete(flight);
    });
    this.inFlight.set(flight, loading);

    return loading;
  }

  /**
   * Read-through for several entries of one scope in one round trip;
   * `loadMissing` is called once, with the keys that missed, and returns
   * what it found (a key it cannot resolve is simply absent).
   */
  async getMany<T>(
    spec: CacheSpec,
    scope: string,
    keys: readonly string[],
    loadMissing: (keys: readonly string[]) => Promise<ReadonlyMap<string, T>>,
  ): Promise<Map<string, T>> {
    const unique = [...new Set(keys)];
    const found = new Map<string, T>();
    if (unique.length === 0) return found;

    const version = versionKey(spec, scope);
    let current: string | null = null;
    let missing = unique;

    try {
      const [stored, ...raws] = await this.backend.mget([
        version,
        ...unique.map((key) => entryKey(spec, scope, key)),
      ]);
      current = stored ?? INITIAL_VERSION;

      missing = [];
      unique.forEach((key, index) => {
        const hit = parse(raws[index] ?? null);
        if (hit !== null && hit.v === current) {
          found.set(key, hit.d as T);
          this.count(spec.name, 'hit');
        } else {
          missing.push(key);
          this.count(spec.name, 'miss');
        }
      });
    } catch {
      this.count(spec.name, 'error');
    }

    if (missing.length === 0) return found;

    const loaded = await loadMissing(missing);
    for (const [key, value] of loaded) {
      found.set(key, value);
      if (current !== null) {
        await this.store(spec, entryKey(spec, scope, key), version, current, value);
      }
    }

    return found;
  }

  /**
   * Leaves every entry of these scopes behind. Call **after** the write
   * that changes them has committed. Never throws.
   */
  async invalidate(spec: CacheSpec, scopes: readonly string[]): Promise<void> {
    const unique = [...new Set(scopes)];
    if (unique.length === 0) return;

    try {
      await this.backend.bump(
        unique.map((scope) => versionKey(spec, scope)),
        versionTtlMs(spec),
      );
    } catch (error) {
      this.count(spec.name, 'invalidation_error');
      this.logger.warn(
        { err: error, cache: spec.name, scopes: unique.length },
        `Cache invalidation failed; ${spec.name} entries may be served for up to ${String(spec.ttlMs / 1000)} s`,
      );
    }
  }

  /**
   * Single-flight without storage: concurrent calls with the same key
   * share one run, and the result is not kept once it settles.
   *
   * For a composite whose inputs are written by too many modules to
   * invalidate (the doctor dashboard): the stampede is absorbed, and no
   * answer outlives the request that computed it. **The key is the
   * caller's authorization scope** — callers are coalesced only with
   * callers who would have computed the identical answer.
   */
  coalesce<T>(name: string, key: string, run: () => Promise<T>): Promise<T> {
    const flight = `${name}:${key}`;
    const pending = this.inFlight.get(flight);
    if (pending !== undefined) {
      this.count(name, 'coalesced');
      return pending as Promise<T>;
    }

    this.count(name, 'miss');
    const running = run().finally(() => {
      this.inFlight.delete(flight);
    });
    this.inFlight.set(flight, running);

    return running;
  }

  /** Counter rows for `/metrics`, sorted for a stable exposition. */
  metrics(): readonly CacheCounter[] {
    return [...this.counters.entries()]
      .map(([label, count]) => {
        const [cache = '', result = 'miss'] = label.split('|');
        return { cache, result: result as CacheResult, count };
      })
      .sort((a, b) => (a.cache + a.result < b.cache + b.result ? -1 : 1));
  }

  private async loadAndStore<T>(
    spec: CacheSpec,
    entry: string,
    version: string,
    observed: string,
    load: () => Promise<T>,
  ): Promise<T> {
    const value = await load();
    await this.store(spec, entry, version, observed, value);
    return value;
  }

  private async store(
    spec: CacheSpec,
    entry: string,
    version: string,
    observed: string,
    value: unknown,
  ): Promise<void> {
    try {
      await this.backend.write({
        entryKey: entry,
        value: JSON.stringify({ v: observed, d: value } satisfies StoredEntry),
        ttlMs: spec.ttlMs,
        versionKey: version,
        versionTtlMs: versionTtlMs(spec),
      });
    } catch {
      this.count(spec.name, 'error');
    }
  }

  private count(cache: string, result: CacheResult): void {
    const label = `${cache}|${result}`;
    this.counters.set(label, (this.counters.get(label) ?? 0) + 1);
  }
}

/** An entry, or `null` for anything that is not one (absent, corrupt, foreign). */
function parse(raw: string | null): StoredEntry | null {
  if (raw === null) return null;

  try {
    const value: unknown = JSON.parse(raw);
    if (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as { v?: unknown }).v === 'string' &&
      'd' in value
    ) {
      return value as StoredEntry;
    }
  } catch {
    // A value this kernel did not write is a miss, not an error.
  }

  return null;
}
