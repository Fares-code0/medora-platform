import type { INestApplication } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { MetricsRegistry, UNMATCHED_ROUTE } from './metrics.registry';

/**
 * Records every HTTP request in the registry (M38.1).
 *
 * Express middleware registered **before** the body parsers, not a Nest
 * interceptor: an interceptor never sees a request the router did not
 * match, or one a body parser refused (413, 415), and those are exactly
 * the responses an error-rate panel exists to show. The route is read
 * when the response finishes, because Express matches it after this runs.
 */
export function applyHttpMetrics(app: INestApplication): void {
  const registry = app.get(MetricsRegistry);

  app.use((request: Request, response: Response, next: NextFunction) => {
    const started = process.hrtime.bigint();

    response.on('finish', () => {
      const seconds = Number(process.hrtime.bigint() - started) / 1e9;
      registry.observeHttp(request.method, routeOf(request), response.statusCode, seconds);
    });

    next();
  });
}

/**
 * The matched pattern, never the path the client sent (see `metrics.registry.ts`).
 *
 * A wildcard is not an endpoint: Nest mounts module middleware registered
 * `forRoutes('*')` (the correlation id) as a route layer, so a path no
 * controller serves arrives here with `/api/v1/*` as its route. It is
 * counted as unmatched, which is what it is.
 */
function routeOf(request: Request): string {
  const route: unknown = request.route;
  if (typeof route !== 'object' || route === null || !('path' in route)) return UNMATCHED_ROUTE;
  const path = route.path;
  if (typeof path !== 'string' || path === '*' || path.endsWith('/*')) return UNMATCHED_ROUTE;
  return `${request.baseUrl}${path}`;
}
