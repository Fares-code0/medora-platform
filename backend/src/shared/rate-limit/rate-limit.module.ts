import { Logger, Module, type OnModuleInit } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { ConfigService } from '../../config';

import { RateLimitGuard } from './rate-limit.guard';
import { RATE_LIMITER, type RateLimiter } from './rate-limit.types';
import { RedisRateLimiter } from './redis-rate-limiter';

/** Bound while the limit is off: counts nothing and opens no connection. */
const DISABLED: RateLimiter = { hit: () => Promise.resolve(null) };

/**
 * The per-client rate limit (M37.2). See `rate-limit.guard.ts`.
 */
@Module({
  providers: [
    {
      provide: RATE_LIMITER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): RateLimiter =>
        config.rateLimit.enabled ? new RedisRateLimiter(config.redisUrl) : DISABLED,
    },
    { provide: APP_GUARD, useClass: RateLimitGuard },
  ],
  exports: [RATE_LIMITER],
})
export class RateLimitKernelModule implements OnModuleInit {
  private readonly logger = new Logger('RateLimit');

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const { enabled, max, windowSeconds } = this.config.rateLimit;

    if (!enabled) {
      this.logger.log(
        'RATE_LIMIT_ENABLED is off — the public credential routes are limited per account only.',
      );
      return;
    }

    this.logger.log(
      `Credential routes limited to ${String(max)} requests per ${String(windowSeconds)} s per client address.`,
    );

    // Stated at boot rather than refused: with no proxy in front, trusting
    // none is correct. Behind one it is the misconfiguration that throttles
    // everyone together, and the operator is the one who knows which.
    if (this.config.trustProxy === false) {
      this.logger.warn(
        'TRUST_PROXY is unset: the limit keys on the TCP peer. Behind a load balancer every client shares its address — set TRUST_PROXY (docs/RATE_LIMITING.md).',
      );
    }
  }
}
