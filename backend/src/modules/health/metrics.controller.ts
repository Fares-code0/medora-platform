import { timingSafeEqual } from 'node:crypto';

import { Controller, Get, Header, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';

import { Public } from '../../common/auth/public.decorator';
import { AppException } from '../../common/errors/app.exception';
import { ConfigService } from '../../config';
import { JobMetricsService } from '../../shared/jobs';
import { CacheService } from '../../shared/cache';
import { MetricsRegistry, renderCacheMetrics, renderJobMetrics } from '../../shared/metrics';

/**
 * `GET /api/v1/metrics` — this instance's metrics in the Prometheus text
 * format (RM M38.1). What a monitoring backend would scrape; no backend is
 * configured (`docs/EXTERNAL_INTEGRATIONS.md`).
 *
 * `@Public()` because a scraper holds no user session — and therefore
 * guarded by its own token instead: `METRICS_TOKEN`, compared in constant
 * time. **Unset, the route answers 404**, the same answer as a route that
 * does not exist, so a deployment that has not configured monitoring
 * exposes nothing. A wrong token is 401.
 *
 * Written through `@Res()` because the body is the exposition format, not
 * the `{ data }` envelope — a scraper cannot unwrap one.
 */
@Public()
@Controller()
export class MetricsController {
  constructor(
    private readonly config: ConfigService,
    private readonly registry: MetricsRegistry,
    private readonly jobs: JobMetricsService,
    private readonly cache: CacheService,
  ) {}

  @Get('metrics')
  @Header('Cache-Control', 'no-store')
  metrics(@Req() request: Request, @Res() response: Response): void {
    const expected = this.config.metricsToken;
    if (expected === undefined) throw AppException.notFound();

    if (!matches(bearerOf(request), expected)) throw AppException.unauthorized();

    response
      .status(200)
      .setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      .send(
        this.registry.render() +
          renderJobMetrics(this.jobs.all()) +
          renderCacheMetrics(this.cache.metrics()),
      );
  }
}

function bearerOf(request: Request): string {
  const header = request.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
}

function matches(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  // `timingSafeEqual` throws on a length mismatch, which would be its own
  // oracle; a different length is simply not the token.
  return a.length === b.length && timingSafeEqual(a, b);
}
