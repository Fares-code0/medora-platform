import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Redis } from 'ioredis';

import { ConfigService } from '../../../config';
import type { HealthIndicator, ServiceKey, ServiceStatus } from '../health.types';

/** The longest a health `PING` may take before Redis counts as down (ms). */
export const REDIS_PROBE_TIMEOUT_MS = 1_000;

/**
 * `redis` — the server behind `REDIS_URL` (ADR-016 §4, M31).
 *
 * Always configured: the permission cache (M7.1) and the job queue
 * (M30.1) both run on it, so there is no deployment in which `redis` is
 * legitimately absent. `PING` on a connection of its own, so the answer
 * is about Redis and not about whichever client last saw it — the cache
 * degrades to a database read when Redis is gone, which keeps requests
 * working and would hide the outage from anything that asked it.
 *
 * No offline queue and no retries per request: a `PING` issued while the
 * connection is down fails at once instead of waiting for a reconnect,
 * so a dead Redis is `down` immediately rather than a hung health check.
 */
@Injectable()
export class RedisHealthIndicator implements HealthIndicator, OnModuleDestroy {
  readonly key: ServiceKey = 'redis';

  private readonly logger = new Logger(RedisHealthIndicator.name);
  private readonly client: Redis;
  /** One log line per outage, not one per reconnect attempt. */
  private reportedOutage = false;

  constructor(config: ConfigService) {
    this.client = new Redis(config.redisUrl, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      commandTimeout: REDIS_PROBE_TIMEOUT_MS,
      connectionName: 'medora-health',
    });
    this.client.on('ready', () => {
      this.reportedOutage = false;
    });
    this.client.on('error', (error: Error) => {
      if (this.reportedOutage) return;
      this.reportedOutage = true;
      this.logger.warn({ err: error }, 'Redis unreachable from the health probe');
    });
  }

  async check(): Promise<ServiceStatus> {
    try {
      return (await this.client.ping()) === 'PONG' ? 'up' : 'down';
    } catch {
      // Already logged once by the `error` listener for this outage.
      return 'down';
    }
  }

  onModuleDestroy(): void {
    this.client.disconnect();
  }
}
