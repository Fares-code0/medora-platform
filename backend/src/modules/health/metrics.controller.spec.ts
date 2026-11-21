import type { Request, Response } from 'express';
import { describe, expect, it } from 'vitest';

import { AppException } from '../../common/errors/app.exception';
import type { ConfigService } from '../../config';
import type { CacheService } from '../../shared/cache';
import type { JobMetricsService } from '../../shared/jobs';
import { MetricsRegistry } from '../../shared/metrics';

import { MetricsController } from './metrics.controller';

/**
 * The scrape endpoint's gate (M38.1). The token-set path runs over HTTP in
 * `test/metrics.e2e-spec.ts`; the unset path is here because one e2e
 * application boots with one environment.
 */
describe('MetricsController', () => {
  it('answers 404 — the route does not exist — while METRICS_TOKEN is unset', () => {
    const controller = new MetricsController(
      { metricsToken: undefined } as ConfigService,
      new MetricsRegistry(),
      { all: () => [] } as unknown as JobMetricsService,
      { metrics: () => [] } as unknown as CacheService,
    );

    let thrown: unknown;
    try {
      controller.metrics({ headers: {} } as Request, {} as Response);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AppException);
    expect((thrown as AppException).getStatus()).toBe(404);
  });
});
