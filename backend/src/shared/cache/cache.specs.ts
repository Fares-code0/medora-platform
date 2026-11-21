import { createHash } from 'node:crypto';

import type { CacheSpec } from './cache.types';

/**
 * Every cache the platform keeps, in one place (RM M31.1, `docs/CACHING.md`).
 *
 * A cache added anywhere else would be one `docs/CACHING.md` does not list
 * and an invalidation nobody audited, so modules name these and declare
 * none of their own.
 */

/**
 * `GET /notifications/badge-counts` (RA-M19.1), one scope per recipient.
 *
 * Invalidated by all nine writers of the two counted columns (see
 * `docs/CACHING.md`), so the minute is only the bound on a failed
 * invalidation — short enough that a badge cannot stay wrong past the
 * next few polls, long enough that a polling client is served from Redis.
 */
export const BADGE_COUNTS: CacheSpec = { name: 'badge-counts', ttlMs: 60_000 };

/**
 * Seed-managed reference data: the formulary (medication list and
 * monographs), the lab catalogue and ICD-10 code lookups — one scope, so
 * the seed's single bump invalidates all of it. No API route writes these
 * tables; `db:seed` and `db:seed:production` do, and both bump on exit.
 */
export const REFERENCE_DATA: CacheSpec = { name: 'reference-data', ttlMs: 60 * 60_000 };

/** The single scope every reference entry lives under. */
export const REFERENCE_SCOPE = 'all';

/**
 * `GET /dashboard/doctor` (M27.1): coalesced, never stored. Only the label
 * for its `coalesced` counter — see `CacheService.coalesce`.
 */
export const DOCTOR_DASHBOARD = 'doctor-dashboard';

/** The key prefix the seed's bump and the backend share. */
export const CACHE_KEY_PREFIX = 'medora:cache:';

export function versionKey(spec: CacheSpec, scope: string): string {
  return `${CACHE_KEY_PREFIX}${spec.name}:v:${scope}`;
}

export function entryKey(spec: CacheSpec, scope: string, key: string): string {
  return `${CACHE_KEY_PREFIX}${spec.name}:e:${scope}:${key}`;
}

/** A version key outlives every entry written under it — see the service. */
export function versionTtlMs(spec: CacheSpec): number {
  return spec.ttlMs * 2;
}

/**
 * An entry key for a parameterised read: the namespace and a hash of the
 * parameters as canonical JSON (keys sorted, `undefined` dropped), so two
 * spellings of one query share an entry and a free-text search term never
 * appears in a Redis key or a `MONITOR` trace.
 */
export function paramsKey(namespace: string, params: object): string {
  return `${namespace}:${createHash('sha256').update(canonical(params)).digest('hex').slice(0, 32)}`;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;

  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([name, item]) => `${JSON.stringify(name)}:${canonical(item)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value) ?? 'null';
}
