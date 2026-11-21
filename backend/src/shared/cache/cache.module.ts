import { Module } from '@nestjs/common';

import { ConfigService } from '../../config';

import { CacheService } from './cache.service';
import { CACHE_BACKEND, type CacheBackend } from './cache.types';
import { RedisCacheBackend } from './redis-cache.backend';

/**
 * The cache kernel (RM M31.1): Redis on `REDIS_URL` under `medora:cache:`.
 * Registered inside `SharedKernelModule`, so every module can inject
 * `CacheService` without importing this.
 */
@Module({
  providers: [
    {
      provide: CACHE_BACKEND,
      inject: [ConfigService],
      useFactory: (config: ConfigService): CacheBackend => new RedisCacheBackend(config.redisUrl),
    },
    CacheService,
  ],
  exports: [CacheService],
})
export class CacheKernelModule {}
