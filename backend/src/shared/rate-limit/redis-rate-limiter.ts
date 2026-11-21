import { Logger, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

import type { RateLimitHit, RateLimiter } from './rate-limit.types';

export const RATE_LIMIT_KEY_PREFIX = 'medora:ratelimit:';

/** A limiter that adds latency to every login is worse than no limiter. */
export const RATE_LIMIT_COMMAND_TIMEOUT_MS = 250;

/**
 * A fixed window per key, in Redis (M37.2).
 *
 * `INCR` then `EXPIRE … NX` in one `MULTI`: the first request of a window
 * creates the key and starts its clock, later ones only count, and the
 * window can never be extended by traffic — a client hammering the route
 * is not kept locked out for longer than one window after it stops.
 *
 * Configured like `RedisPermissionCache`, and for the same reason: no
 * offline queue and no retries, so an unreachable Redis answers at once
 * instead of holding the request. An outage resolves `null`; the guard
 * lets the request through (see `rate-limit.guard.ts`).
 */
export class RedisRateLimiter implements RateLimiter, OnModuleDestroy {
  private readonly logger = new Logger(RedisRateLimiter.name);
  private readonly client: Redis;
  private reportedOutage = false;

  constructor(redisUrl: string) {
    this.client = new Redis(redisUrl, {
      enableOfflineQueue: false,
      commandTimeout: RATE_LIMIT_COMMAND_TIMEOUT_MS,
      maxRetriesPerRequest: 0,
      connectionName: 'medora-rate-limit',
    });
    this.client.on('ready', () => {
      this.reportedOutage = false;
    });
    this.client.on('error', (error: Error) => {
      this.reportOutage(error);
    });
  }

  async hit(key: string, windowSeconds: number): Promise<RateLimitHit | null> {
    const redisKey = `${RATE_LIMIT_KEY_PREFIX}${key}`;

    try {
      const results = await this.client
        .multi()
        .incr(redisKey)
        .expire(redisKey, windowSeconds, 'NX')
        .ttl(redisKey)
        .exec();

      const count = results?.[0]?.[1];
      const ttl = results?.[2]?.[1];
      if (typeof count !== 'number' || typeof ttl !== 'number') return null;

      return { count, resetSeconds: ttl > 0 ? ttl : windowSeconds };
    } catch (error) {
      this.reportOutage(error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  }

  /** Resolves once the connection is ready (no offline queue: see the header). */
  ready(): Promise<void> {
    if (this.client.status === 'ready') return Promise.resolve();
    return new Promise((resolve) => this.client.once('ready', () => resolve()));
  }

  /** Releases the connection, or Nest's shutdown would hang on it. */
  async onModuleDestroy(): Promise<void> {
    try {
      await this.client.quit();
    } catch {
      // Already closed or never connected: nothing left to release.
      this.client.disconnect();
    }
  }

  private reportOutage(error: Error): void {
    if (this.reportedOutage) return;
    this.reportedOutage = true;
    this.logger.warn(
      { rateLimit: 'counter-unavailable' },
      `Rate-limit counter unreachable; requests are not being limited until it returns (${error.message})`,
    );
  }
}
