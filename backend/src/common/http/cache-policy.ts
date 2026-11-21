import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
  UseInterceptors,
} from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import { type Observable, tap } from 'rxjs';

/**
 * The HTTP cache policy (RM M32.3, M37.2 finding "no API response sets
 * `Cache-Control`"; `docs/PERFORMANCE.md` §9).
 *
 * ## `no-store` unless a route says otherwise
 *
 * Every response leaves with `Cache-Control: no-store`, so neither a
 * browser nor anything between the client and the API keeps a copy (ASVS
 * 8.2.1). It is the default rather than a list of PHI routes because a
 * default is what a new route gets without anybody remembering: a route
 * added next month that returns a chart is safe on the day it ships.
 *
 * What this costs is browser revalidation. A response that is never stored
 * is never revalidated, so its ETag earns nothing for that client. No
 * client relies on it: neither the web client nor the patient app sends
 * `If-None-Match` or handles a 304 itself. And the hottest poll, the badge
 * (~50 bytes), is smaller than the 304 that would replace it.
 *
 * ## The exceptions: reference data that contains no person
 *
 * {@link RevalidatePrivately} marks a route `private, no-cache`. The
 * browser may keep the response, must revalidate it before every use
 * (ETag → bodiless 304), and no shared cache may keep it. Only for bodies
 * that are the same for every caller and name no patient and no user:
 *
 * - `GET /meta/enums` — the database's enum vocabularies;
 * - `GET /medications`, `GET /medications/{id}/monograph` — the formulary;
 * - `GET /lab-tests/catalogue` — the lab catalogue.
 *
 * `private`, not `public`, because they are still behind authentication: a
 * shared cache must not answer an unauthenticated request from a copy made
 * for an authenticated one.
 *
 * ## What sets its own
 *
 * The CSV exports (`no-store`, `common/http/csv-export.ts`), the audit export
 * and the metrics scrape already set theirs. The AI token stream sets `no-cache,
 * no-transform` (`ai-message.controller.ts`). A handler's header is applied
 * after this middleware, so it wins.
 */
export const NO_STORE = 'no-store';
export const REVALIDATE_PRIVATELY = 'private, no-cache';

/**
 * Sets {@link REVALIDATE_PRIVATELY} once the handler has produced its value,
 * so only a successful response carries it. Not Nest's `@Header`: that one
 * is applied whether or not the handler throws, and a 404 from a reference
 * route would then have been revalidate-only too.
 */
@Injectable()
export class RevalidatePrivatelyInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const response = context.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      tap(() => {
        response.setHeader('Cache-Control', REVALIDATE_PRIVATELY);
      }),
    );
  }
}

/** Marks a PHI-free reference route as revalidate-only (see above). */
export const RevalidatePrivately = (): MethodDecorator & ClassDecorator =>
  UseInterceptors(RevalidatePrivatelyInterceptor);

/** First in the chain, so a 401, a 404 and a 413 carry it too. */
export function applyCachePolicy(app: NestExpressApplication): void {
  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader('Cache-Control', NO_STORE);
    next();
  });
}
