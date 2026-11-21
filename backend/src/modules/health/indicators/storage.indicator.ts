import { Inject, Injectable, Logger } from '@nestjs/common';

import { FILE_STORAGE, type FileStoragePort } from '../../../shared/files';
import type { HealthIndicator, ServiceKey, ServiceStatus } from '../health.types';

import { CachedProbe } from './cached-probe';

/**
 * `storage` — the object store behind `FILE_STORAGE` (ADR-016 §4, M25).
 *
 * `up` when the bucket answers a `HeadBucket`; `down` when it does not;
 * `unconfigured` when the bound adapter has no `ping` (it cannot say).
 * Cached for `REMOTE_PROBE_TTL_MS`, because it is a signed network call.
 */
@Injectable()
export class StorageHealthIndicator implements HealthIndicator {
  readonly key: ServiceKey = 'storage';

  private readonly logger = new Logger(StorageHealthIndicator.name);
  private readonly cache = new CachedProbe(() => this.probe());

  constructor(@Inject(FILE_STORAGE) private readonly storage: FileStoragePort) {}

  check(): Promise<ServiceStatus> {
    if (this.storage.ping === undefined) return Promise.resolve('unconfigured');

    return this.cache.check();
  }

  private async probe(): Promise<ServiceStatus> {
    try {
      await this.storage.ping?.();
      return 'up';
    } catch (error) {
      // The error's description only (the logger's `err` serialiser): an
      // S3 error carries the request id and the bucket, never an object.
      this.logger.warn({ err: error }, 'Object storage health check failed');
      return 'down';
    }
  }
}
