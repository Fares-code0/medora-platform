/**
 * The cache kernel's contracts (RM M31.1). See `cache.service.ts` for the
 * consistency model and `docs/CACHING.md` for the table of caches.
 */

/** A named cache: its metric label, its key namespace and its TTL. */
export interface CacheSpec {
  /** `[a-z-]+`. The metric label and the key namespace — never data. */
  readonly name: string;
  /**
   * How long an entry may be served (ms). With invalidation on every write
   * this is not a freshness window but the **bound on staleness if an
   * invalidation fails** — the one case the version check cannot catch.
   */
  readonly ttlMs: number;
}

/**
 * The store behind the kernel. Redis in every deployment; a port so the
 * failure handling can be tested against a store that fails.
 *
 * Every method may reject. The kernel never lets a rejection reach a
 * caller: a cache that is down is a cache that misses.
 */
export interface CacheBackend {
  /** Values for the keys, in order; `null` where a key is absent. */
  mget(keys: readonly string[]): Promise<(string | null)[]>;
  /**
   * Stores an entry and keeps its scope's version key alive at least as
   * long — the invariant the version check depends on (see the service).
   */
  write(input: {
    readonly entryKey: string;
    readonly value: string;
    readonly ttlMs: number;
    readonly versionKey: string;
    readonly versionTtlMs: number;
  }): Promise<void>;
  /** Advances each scope's version: every entry under it stops matching. */
  bump(versionKeys: readonly string[], versionTtlMs: number): Promise<void>;
}

export const CACHE_BACKEND = Symbol('CACHE_BACKEND');

/** One counter row for `/metrics`. Labels are cache names and outcomes only. */
export interface CacheCounter {
  readonly cache: string;
  readonly result: CacheResult;
  readonly count: number;
}

/**
 * - `hit` / `miss` — an entry served, or loaded from the database;
 * - `coalesced` — a caller that joined a load already in flight;
 * - `error` — the store failed on a read or write, and the database answered;
 * - `invalidation_error` — a bump failed; staleness is then bounded by the TTL.
 */
export type CacheResult = 'hit' | 'miss' | 'coalesced' | 'error' | 'invalidation_error';
