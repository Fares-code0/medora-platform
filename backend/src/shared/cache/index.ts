/**
 * Public API — the cache kernel (RM M31.1, `docs/CACHING.md`).
 *
 * Modules inject `CacheService` and name a spec from `cache.specs.ts`;
 * they declare no caches of their own.
 */
export { CacheKernelModule } from './cache.module';
export { CacheService } from './cache.service';
export {
  BADGE_COUNTS,
  CACHE_KEY_PREFIX,
  DOCTOR_DASHBOARD,
  paramsKey,
  REFERENCE_DATA,
  REFERENCE_SCOPE,
  versionKey,
  versionTtlMs,
} from './cache.specs';
export {
  CACHE_BACKEND,
  type CacheBackend,
  type CacheCounter,
  type CacheResult,
  type CacheSpec,
} from './cache.types';
export { RedisCacheBackend } from './redis-cache.backend';
