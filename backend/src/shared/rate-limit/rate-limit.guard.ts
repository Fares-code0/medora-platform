import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AppException } from '../../common/errors/app.exception';
import { ConfigService } from '../../config';

import { RATE_LIMIT_BUCKET } from './rate-limit.decorator';
import { RATE_LIMITER, type RateLimitBucket, type RateLimiter } from './rate-limit.types';

/**
 * Enforces `@RateLimited(bucket)` (M37.2). A global guard that is a no-op
 * on every route without the decorator, and on every route while
 * `RATE_LIMIT_ENABLED` is off.
 *
 * ## Keyed on `req.ip`, which is only as true as `TRUST_PROXY`
 *
 * Express derives `req.ip` from `X-Forwarded-For` only for the hops
 * `TRUST_PROXY` names (`config/trust-proxy.ts`); by default it is the TCP
 * peer, so a client cannot choose its own key by sending a header. Behind
 * a proxy that is not trusted, every client *is* the proxy — which is why
 * the limit ships disabled until the deployment's proxy is verified
 * (`docs/RATE_LIMITING.md`).
 *
 * ## An unavailable counter lets the request through
 *
 * Failing closed would turn a Redis outage into a sign-in outage for
 * everyone. The controls that protect a single account — the login
 * lockout, the OTP attempt cap, the mail cooldowns — are in PostgreSQL and
 * do not depend on this counter. The outage is logged once.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const bucket = this.reflector.getAllAndOverride<RateLimitBucket | undefined>(
      RATE_LIMIT_BUCKET,
      [context.getHandler(), context.getClass()],
    );
    if (bucket === undefined) return true;

    const { enabled, max, windowSeconds } = this.config.rateLimit;
    if (!enabled) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const client = request.ip ?? 'unknown';

    const hit = await this.limiter.hit(`${bucket}:${client}`, windowSeconds);
    if (hit === null || hit.count <= max) return true;

    throw AppException.rateLimited(hit.resetSeconds, 'Too many requests. Try again shortly.');
  }
}
