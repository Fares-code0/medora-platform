import { Logger, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

import type { CacheBackend } from './cache.types';

/**
 * The longest a cache command may hold a request (ms) — the permission
 * cache's bound, for its reason: a local Redis answers in well under a
 * millisecond, and past this the database is the better answer.
 */
export const CACHE_COMMAND_TIMEOUT_MS = 250;

/**
 * Redis, on `REDIS_URL`, on a connection of its own (`medora-cache`).
 *
 * No offline queue and no retries per request: while Redis is unreachable
 * every command fails at once, the kernel counts an `error` and the
 * database answers — a request never waits for a reconnect.
 */
export class RedisCacheBackend implements CacheBackend, OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheBackend.name);
  private readonly client: Redis;
  /** One log line per outage, not one per reconnect attempt. */
  private reportedOutage = false;

  constructor(redisUrl: string) {
    this.client = new Redis(redisUrl, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      commandTimeout: CACHE_COMMAND_TIMEOUT_MS,
      connectionName: 'medora-cache',
    });
    this.client.on('ready', () => {
      this.reportedOutage = false;
    });
    this.client.on('error', (error: Error) => {
      if (this.reportedOutage) return;
      this.reportedOutage = true;
      this.logger.warn(
        { cache: 'unavailable' },
        `Cache unreachable; reading from the database until it returns (${error.message})`,
      );
    });
  }

  mget(keys: readonly string[]): Promise<(string | null)[]> {
    return this.client.mget(...keys);
  }

  async write(input: {
    readonly entryKey: string;
    readonly value: string;
    readonly ttlMs: number;
    readonly versionKey: string;
    readonly versionTtlMs: number;
  }): Promise<void> {
    const results = await this.client
      .multi()
      .set(input.entryKey, input.value, 'PX', input.ttlMs)
      // Creates the scope's version at "0" if it is absent, and in every
      // case extends it past the entry just written.
      .set(input.versionKey, '0', 'PX', input.versionTtlMs, 'NX')
      .pexpire(input.versionKey, input.versionTtlMs)
      .exec();

    failOnError(results);
  }

  async bump(versionKeys: readonly string[], versionTtlMs: number): Promise<void> {
    if (versionKeys.length === 0) return;

    const transaction = this.client.multi();
    for (const key of versionKeys) {
      transaction.incr(key).pexpire(key, versionTtlMs);
    }

    failOnError(await transaction.exec());
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }
}

/** `MULTI` reports per-command errors in its results rather than rejecting. */
function failOnError(results: [Error | null, unknown][] | null): void {
  if (results === null) throw new Error('Cache transaction was discarded');

  for (const [error] of results) {
    if (error !== null) throw error;
  }
}
