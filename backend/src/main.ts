import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { applyBodyLimits } from './common/http/body-limits';
import { applyCachePolicy } from './common/http/cache-policy';
import { applyCompression } from './common/http/compression';
import { applyCors, applySecurityHeaders } from './common/http/security-headers';
import { applyTrustProxy } from './common/http/trust-proxy';
import { ConfigService } from './config';
import { EnvValidationError, loadDotenvFile, loadEnv } from './config/env';
import { DOMAIN_MODULES } from './modules';
import { applyHttpMetrics } from './shared/metrics';

/**
 * The global route prefix. Per **ADR-011** the API is served at
 * `/api/v1`, which is also what the refresh cookie's `Path=/api/v1/auth`
 * scoping requires — a mismatch here means the browser never sends the
 * refresh token and silent refresh silently stops working.
 */
const GLOBAL_PREFIX = 'api/v1';

async function bootstrap(): Promise<void> {
  // Validate the environment *before* the container exists (RM M3.1).
  // Doing it inside a provider would report a missing variable as a Nest
  // DI failure — a stack trace that never names the variable.
  validateEnvironmentOrExit();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));
  app.setGlobalPrefix(GLOBAL_PREFIX);

  const config = app.get(ConfigService);

  // First, so every response carries the header policy — a CORS preflight
  // and a 413 from the body parser included (RM M37.1).
  // Before anything reads `req.ip`: audit rows, login events, the rate limit.
  applyTrustProxy(app, config.trustProxy);

  applySecurityHeaders(app);

  // `Cache-Control: no-store` unless a route says otherwise (RM M32.3,
  // `common/http/cache-policy.ts`).
  applyCachePolicy(app);

  // Before the body parsers, so a 413 or 415 they answer is counted too.
  applyHttpMetrics(app);

  // After the metrics, before every route (RM M32.3, `common/http/compression.ts`).
  applyCompression(app);

  // The cookie-based refresh flow requires credentialed CORS with exact
  // origins — a wildcard is invalid with `credentials: true`.
  applyCors(app, config.corsOrigins);

  // After CORS, which is where Nest's implicit parsers sat: they were
  // registered at init, behind `enableCors`. Registering them first would
  // refuse an oversized cross-origin body before the CORS headers were
  // set, and the browser would report an opaque CORS failure instead of
  // the 413 the client can read (AST-G2).
  applyBodyLimits(app);

  // Containers and orchestrators need SIGTERM to drain in-flight work
  // rather than dropping it; queue consumers at M30 depend on this.
  app.enableShutdownHooks();

  await app.listen(config.port);

  const logger = app.get(Logger);
  logger.log(`Medora API listening on :${String(config.port)}/${GLOBAL_PREFIX} [${config.appEnv}]`);

  // RM M2.1 asks the startup log to list the registered modules. Nest
  // logs each module's *providers* at debug level, which says nothing
  // about a module that has none — and at M2 none of them do. This line
  // is the one that would go quiet if a module stopped being registered.
  logger.log(
    `Domain modules registered (${String(DOMAIN_MODULES.length)}): ` +
      DOMAIN_MODULES.map((module) => module.name).join(', '),
  );
}

/**
 * Fail-fast (RM M3.1).
 *
 * `console.error` and not the pino logger: the logger's own level comes
 * from the environment being validated, so at this point there is no
 * configured logger to use. Exit code 1 is what makes a container
 * orchestrator report a crash loop rather than a silently degraded
 * service.
 */
function validateEnvironmentOrExit(): void {
  try {
    // Read `.env` first, then validate whatever the process now has.
    // This is the only place the file is read (see `loadDotenvFile`).
    loadDotenvFile();
    loadEnv();
  } catch (error) {
    if (error instanceof EnvValidationError) {
      console.error(error.message);
      process.exit(1);
    }
    throw error;
  }
}

void bootstrap();
