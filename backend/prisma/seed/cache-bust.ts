import { Redis } from 'ioredis';

import {
  REFERENCE_DATA,
  REFERENCE_SCOPE,
  versionKey,
  versionTtlMs,
} from '../../src/shared/cache/cache.specs';

/** How long the seed waits for Redis before calling the bump failed (ms). */
const CONNECT_TIMEOUT_MS = 5_000;

export type ReferenceBust = 'invalidated' | 'skipped';

/**
 * Invalidates every reference-data cache entry (RM M31.1).
 *
 * The formulary, the lab catalogue and the ICD-10 codes are written by the
 * seed and by nothing else, so this is their invalidation: one `INCR` of the
 * reference scope's version, after the seed's writes have committed, leaves
 * every cached entry behind on every API instance at once.
 *
 * - `REDIS_URL` unset → `skipped`, and the caller says so: the entries then
 *   expire within the cache's TTL.
 * - `REDIS_URL` set but the bump fails → **throws**. The database holds the
 *   new content and the caches hold the old; that is a seed that did not
 *   finish, and its exit code must say so.
 */
export async function invalidateReferenceCache(
  redisUrl: string | undefined = process.env['REDIS_URL'],
): Promise<ReferenceBust> {
  if (redisUrl === undefined || redisUrl.length === 0) return 'skipped';

  const client = new Redis(redisUrl, {
    connectTimeout: CONNECT_TIMEOUT_MS,
    maxRetriesPerRequest: 1,
    connectionName: 'medora-seed',
    lazyConnect: true,
  });
  // The failure is reported once, by `connect()`'s rejection; without a
  // listener ioredis would also print every reconnect attempt.
  client.on('error', () => undefined);

  try {
    await client.connect();
    const key = versionKey(REFERENCE_DATA, REFERENCE_SCOPE);
    await client.multi().incr(key).pexpire(key, versionTtlMs(REFERENCE_DATA)).exec();
    return 'invalidated';
  } finally {
    client.disconnect();
  }
}

/** The line each seed prints after it, so the outcome is in the log. */
export function describeBust(outcome: ReferenceBust): string {
  return outcome === 'invalidated'
    ? 'Reference-data caches invalidated.'
    : `REDIS_URL is not set: reference-data caches were not invalidated and expire within ${String(REFERENCE_DATA.ttlMs / 60_000)} min.`;
}
