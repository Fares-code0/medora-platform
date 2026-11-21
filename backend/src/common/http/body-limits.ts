import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * The largest request body the API parses (RM M37.1 "JSON limits", MG
 * §11.7, AST-G2).
 *
 * **100 kB is the value that has always applied** — it is Express's
 * body-parser default, which Nest used implicitly because nothing set
 * one. Writing it down changes no accepted request; what changes is that
 * the limit is now a decision in the code rather than a library default
 * that a dependency upgrade could move.
 *
 * Files never travel through this path: uploads are multipart (API §17.1)
 * and are bounded per kind by the files module.
 */
export const BODY_LIMIT = '100kb';

/**
 * Registers the JSON and URL-encoded parsers with the explicit limit.
 *
 * Called from `main.ts` **and** from the e2e harness, so the suite
 * exercises the configuration that ships rather than a copy of it. Must
 * run before `init()`/`listen()`: Nest registers its own default parsers
 * at init only for the types not already registered, so these take their
 * place instead of stacking behind them.
 *
 * `extended: true` is what Nest's default URL-encoded parser uses; it is
 * kept so nesting behaves exactly as before.
 *
 * An oversized body is refused by the parser before any guard or handler
 * runs, and answers 413 `payload_too_large` in the API §0.3 envelope
 * (`AllExceptionsFilter`).
 */
export function applyBodyLimits(app: NestExpressApplication): void {
  app.useBodyParser('json', { limit: BODY_LIMIT });
  app.useBodyParser('urlencoded', { limit: BODY_LIMIT, extended: true });
}
