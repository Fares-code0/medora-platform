import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

/**
 * The response-header policy (RM M37.1 "Helmet headers verified", MG §11.7).
 *
 * Helmet's defaults, with two changes that follow from this being a JSON
 * API rather than a site:
 *
 * - **`Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`.**
 *   Nothing this server returns is a document that loads scripts, styles or
 *   images, so nothing is allowed. Helmet's default policy is written for
 *   HTML pages and would allow `'self'` sources a JSON body never uses.
 * - **`X-Frame-Options: DENY`** rather than `SAMEORIGIN`, matching
 *   `frame-ancestors 'none'` for clients that read only the older header.
 *
 * Everything else is Helmet's default and deliberately kept:
 * `Strict-Transport-Security` (one year, subdomains — browsers ignore it
 * over plain HTTP, so local development is unaffected),
 * `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`,
 * `Cross-Origin-Opener-Policy: same-origin`,
 * `Cross-Origin-Resource-Policy: same-origin` (a `no-cors` read of an API
 * response from another site is refused; the SPA's credentialed CORS
 * `fetch` is governed by CORS and unaffected), and no `X-Powered-By`.
 *
 * Downloads are presigned object-store URLs on another host (M25.2), so no
 * response from this server needs to be embeddable or readable `no-cors`.
 *
 * Called from `main.ts` **and** from the e2e harness, as `applyBodyLimits`
 * is, so `http-hardening.e2e-spec.ts` asserts the headers that ship.
 */
export function applySecurityHeaders(app: NestExpressApplication): void {
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      frameguard: { action: 'deny' },
    }),
  );
}

/**
 * Credentialed CORS with exact origins (RM M37.1, ADR-011).
 *
 * The refresh cookie is `httpOnly` and cross-origin, so the browser sends it
 * only on credentialed requests, and `credentials: true` is invalid with a
 * wildcard origin. The list is `CORS_ORIGINS`, which the env schema already
 * refuses to accept as `*` and refuses to let contain `localhost` in
 * production. An origin not on it receives no `Access-Control-Allow-Origin`
 * at all, so the browser refuses to expose the response.
 */
export function applyCors(app: NestExpressApplication, origins: readonly string[]): void {
  app.enableCors({
    origin: [...origins],
    credentials: true,
  });
}
