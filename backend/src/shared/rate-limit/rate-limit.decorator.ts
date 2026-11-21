import { SetMetadata } from '@nestjs/common';

import type { RateLimitBucket } from './rate-limit.types';

export const RATE_LIMIT_BUCKET = 'medora:rate-limit-bucket';

/**
 * Counts this route against `bucket`, per client address (M37.2).
 *
 * Routes that share a bucket share one counter: a client guessing
 * passwords on `/auth/login` and codes on `/auth/otp/verify` spends one
 * allowance, not two. Enforced by `RateLimitGuard` only while
 * `RATE_LIMIT_ENABLED` is on.
 */
export const RateLimited = (bucket: RateLimitBucket): MethodDecorator & ClassDecorator =>
  SetMetadata(RATE_LIMIT_BUCKET, bucket);
