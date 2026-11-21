import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import { AppException } from '../../common/errors/app.exception';
import type { ConfigService } from '../../config';

import { RATE_LIMIT_BUCKET } from './rate-limit.decorator';
import { RateLimitGuard } from './rate-limit.guard';
import type { RateLimitHit, RateLimiter } from './rate-limit.types';

/**
 * `RateLimitGuard` (M37.2), with the counter faked. The counter itself is
 * `redis-rate-limiter.spec.ts`; the routes are `rate-limit.e2e-spec.ts`.
 */
function guardWith(options: {
  enabled: boolean;
  bucket: string | undefined;
  answer: RateLimitHit | null;
}): { guard: RateLimitGuard; keys: string[] } {
  const keys: string[] = [];
  const limiter: RateLimiter = {
    hit: (key) => {
      keys.push(key);
      return Promise.resolve(options.answer);
    },
  };
  const config = {
    rateLimit: { enabled: options.enabled, max: 3, windowSeconds: 60 },
  } as ConfigService;
  const reflector = new Reflector();
  reflector.getAllAndOverride = ((key: string) =>
    key === RATE_LIMIT_BUCKET ? options.bucket : undefined) as Reflector['getAllAndOverride'];

  return { guard: new RateLimitGuard(reflector, config, limiter), keys };
}

const context = {
  getHandler: () => () => undefined,
  getClass: () => class {},
  switchToHttp: () => ({ getRequest: () => ({ ip: '203.0.113.7' }) }),
} as unknown as ExecutionContext;

describe('RateLimitGuard', () => {
  it('ignores a route with no bucket', async () => {
    const { guard, keys } = guardWith({ enabled: true, bucket: undefined, answer: null });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(keys).toEqual([]);
  });

  it('counts nothing while the limit is disabled', async () => {
    const { guard, keys } = guardWith({ enabled: false, bucket: 'auth', answer: null });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(keys).toEqual([]);
  });

  it('keys the count on bucket and client address', async () => {
    const { guard, keys } = guardWith({
      enabled: true,
      bucket: 'auth',
      answer: { count: 3, resetSeconds: 10 },
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(keys).toEqual(['auth:203.0.113.7']);
  });

  it('refuses past the limit with a 429 that says when to retry', async () => {
    const { guard } = guardWith({
      enabled: true,
      bucket: 'auth',
      answer: { count: 4, resetSeconds: 42 },
    });

    const refusal = await guard.canActivate(context).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(AppException);
    expect((refusal as AppException).getStatus()).toBe(429);
    expect((refusal as AppException).retryAfterSeconds).toBe(42);
  });

  it('lets the request through when the counter is unavailable', async () => {
    const { guard } = guardWith({ enabled: true, bucket: 'auth', answer: null });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
