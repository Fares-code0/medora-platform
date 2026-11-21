/**
 * Public API — the per-client rate limit (M37.2).
 *
 * Modules import from `shared/rate-limit`, never from a file inside it.
 */
export { RATE_LIMIT_BUCKET, RateLimited } from './rate-limit.decorator';
export { RateLimitGuard } from './rate-limit.guard';
export { RateLimitKernelModule } from './rate-limit.module';
export {
  RATE_LIMITER,
  type RateLimitBucket,
  type RateLimitHit,
  type RateLimiter,
} from './rate-limit.types';
export { RATE_LIMIT_KEY_PREFIX, RedisRateLimiter } from './redis-rate-limiter';
