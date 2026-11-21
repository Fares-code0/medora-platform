import type { NestExpressApplication } from '@nestjs/platform-express';

/**
 * Applies `TRUST_PROXY` to Express (M37.2).
 *
 * Structural rather than importing the config type, because `common/` is
 * the bottom layer and imports nothing of ours. The value comes from
 * `ConfigService.trustProxy`, which has already refused `true`
 * (`config/trust-proxy.ts`).
 *
 * Registered in `main.ts` and by the e2e harness, like the header policy,
 * so the suites exercise what ships.
 */
export function applyTrustProxy(
  app: NestExpressApplication,
  setting: false | number | readonly string[],
): void {
  app.set('trust proxy', typeof setting === 'object' ? [...setting] : setting);
}
