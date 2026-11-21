/**
 * `PERMISSION_CACHE` on Redis (RM M7.1 — "Redis-cached, invalidated on
 * change"; AF-25).
 *
 * ## Why this replaces the in-memory map
 *
 * `InMemoryPermissionCache` is per-process. With more than one instance,
 * an invalidation — a matrix save (API §15.3), an override (API §15.5) —
 * reaches only the instance that handled it, and the others keep
 * authorizing from the old effective set until the TTL runs out. That is
 * a revocation that does not take. One shared store makes every
 * invalidation visible to every instance at once, which is also what the
 * Multi-Hospital checklist's A3 ("immediate invalidation of … permission
 * caches (all instances)", OD-12) will need.
 *
 * ## Failing is a miss, never a denial — and never a hang
 *
 * The port's contract (`PermissionCache`) is that any method may fail and
 * the resolver treats a failure as a miss. This adapter keeps the second
 * half of that promise too: a failure must be *prompt*. The cache is read
 * on every `@Can` route, and ioredis by default queues commands while it
 * is disconnected and retries them indefinitely — so a Redis outage would
 * have stalled every authorized request instead of falling back to
 * Postgres. Hence:
 *
 * - `enableOfflineQueue: false` — while disconnected, a command fails at
 *   once instead of waiting for a reconnect;
 * - `commandTimeout` — a connected-but-unresponsive server fails the
 *   command after a bound, rather than holding the request open;
 * - `maxRetriesPerRequest: 0` — no per-command retry loop on top of the
 *   reconnect loop.
 *
 * ## What a cached entry is trusted to be
 *
 * The value comes back from a network store, so it is checked before it
 * is used: anything other than a JSON array of strings is treated as a
 * miss and read through. A corrupt entry can therefore cost a database
 * read, never an authorization decision.
 */
import type { OnModuleDestroy } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { Redis } from 'ioredis';

import type { Permission, PermissionCache } from './authz.types';
import { PERMISSION_CACHE_TTL_MS } from './in-memory-permission-cache';

/**
 * Namespaces the keys away from BullMQ's (`bull:*`, M30.1), which shares
 * the same `REDIS_URL`. `clear()` deletes by this prefix and nothing else.
 */
export const PERMISSION_CACHE_KEY_PREFIX = 'medora:authz:permissions:';

/**
 * The longest a cache command may hold a request (ms). A local Redis
 * answers in well under a millisecond; anything near this bound is an
 * incident, and reading through to Postgres is the better answer.
 */
export const PERMISSION_CACHE_COMMAND_TIMEOUT_MS = 250;

/** Keys deleted per `DEL`/`SCAN` round trip in the bulk invalidations. */
const BATCH = 500;

export class RedisPermissionCache implements PermissionCache, OnModuleDestroy {
  private readonly logger = new Logger(RedisPermissionCache.name);
  private readonly client: Redis;
  /**
   * ioredis emits `error` on every failed reconnect attempt. Logged once
   * per outage — when the connection goes from ready to failing — so an
   * unreachable Redis is one line, not one line per backoff step.
   */
  private reportedOutage = false;

  constructor(
    redisUrl: string,
    private readonly ttlMs: number = PERMISSION_CACHE_TTL_MS,
  ) {
    this.client = new Redis(redisUrl, {
      enableOfflineQueue: false,
      commandTimeout: PERMISSION_CACHE_COMMAND_TIMEOUT_MS,
      maxRetriesPerRequest: 0,
      connectionName: 'medora-permission-cache',
    });
    this.client.on('ready', () => {
      this.reportedOutage = false;
    });
    this.client.on('error', (error: Error) => {
      if (this.reportedOutage) return;
      this.reportedOutage = true;
      this.logger.warn(
        { authz: 'cache-unavailable' },
        `Permission cache unreachable; authorizing from the database until it returns (${error.message})`,
      );
    });
  }

  async get(userId: string): Promise<readonly Permission[] | undefined> {
    const raw = await this.client.get(keyFor(userId));
    if (raw === null) return undefined;
    return parseEntry(raw);
  }

  async set(userId: string, permissions: readonly Permission[]): Promise<void> {
    await this.client.set(keyFor(userId), JSON.stringify(permissions), 'PX', this.ttlMs);
  }

  async forget(userId: string): Promise<void> {
    await this.client.del(keyFor(userId));
  }

  async forgetMany(userIds: readonly string[]): Promise<void> {
    for (let start = 0; start < userIds.length; start += BATCH) {
      const keys = userIds.slice(start, start + BATCH).map(keyFor);
      if (keys.length > 0) await this.client.del(...keys);
    }
  }

  /**
   * Deletes every permission entry, and only those.
   *
   * `SCAN`, not `KEYS`: `KEYS` blocks the server for the length of the
   * keyspace, and the same server carries the job queue. `FLUSHDB` is out
   * for the same reason — it would delete BullMQ's state with ours.
   */
  async clear(): Promise<void> {
    let cursor = '0';
    do {
      const [next, keys] = await this.client.scan(
        cursor,
        'MATCH',
        `${PERMISSION_CACHE_KEY_PREFIX}*`,
        'COUNT',
        BATCH,
      );
      cursor = next;
      if (keys.length > 0) await this.client.del(...keys);
    } while (cursor !== '0');
  }

  /**
   * Resolves once the connection is ready.
   *
   * Nothing in the request path waits on this — with the offline queue
   * off, a command issued before the connection is up simply fails and
   * the resolver reads through, which is the right answer for the first
   * requests after boot. It exists so a test can assert cache behaviour
   * rather than connection timing.
   */
  ready(): Promise<void> {
    if (this.client.status === 'ready') return Promise.resolve();
    return new Promise((resolve) => this.client.once('ready', () => resolve()));
  }

  /** Releases the connection, or Nest's shutdown (and every e2e teardown) would hang on it. */
  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      // Already closed or never connected: nothing left to release.
      this.client.disconnect();
    }
  }
}

function keyFor(userId: string): string {
  return `${PERMISSION_CACHE_KEY_PREFIX}${userId}`;
}

/** A stored entry, or `undefined` when it is not the shape `set` writes. */
function parseEntry(raw: string): readonly Permission[] | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!Array.isArray(value)) return undefined;
  if (!value.every((entry): entry is string => typeof entry === 'string')) return undefined;
  return value as readonly Permission[];
}
