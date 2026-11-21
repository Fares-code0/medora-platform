import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';

import { AllExceptionsFilter } from './common/http/all-exceptions.filter';
import { ResponseInterceptor } from './common/http/response.interceptor';
import { buildLoggerOptions, type LoggerOptionsInput } from './common/logging/logger.config';
import { CorrelationMiddleware } from './common/logging/correlation.middleware';
import { RejectNulPipe } from './common/validation/reject-nul.pipe';
import { ConfigModule } from './config';
import { loadEnv } from './config/env';
import { DOMAIN_MODULES } from './modules';
import { HealthModule } from './modules/health/health.module';
import { SharedKernelModule } from './shared';

/**
 * The logger's inputs, resolved from the validated environment (M3.1).
 *
 * Deliberately behind `forRootAsync` below rather than called inline in
 * the decorator. A `@Module({...})` decorator is evaluated when this
 * file is *imported*, which happens before `main.ts` runs a line of
 * `bootstrap()` — so an inline call here would parse the environment
 * before the fail-fast guard could catch it, and a missing variable
 * would surface as a raw stack trace instead of the readable message
 * that is the entire point of M3.1.
 */
function loggerInput(): LoggerOptionsInput {
  const env = loadEnv();
  return { appEnv: env.APP_ENV, logLevel: env.LOG_LEVEL };
}

/**
 * Root module.
 *
 * The envelope interceptor and exception filter are registered globally
 * here rather than in `main.ts` so they participate in DI — the filter
 * logs through Nest's logger, and later milestones will inject the audit
 * service into request-scoped concerns.
 *
 * The nineteen domain modules are spread from `modules/index.ts` rather
 * than listed here (RM M2.1), so the registry and this file cannot drift
 * apart. `ConfigModule` and the shared kernel are registered before them
 * because both are `@Global` — every module resolves their tokens
 * without importing anything.
 */
@Module({
  imports: [
    LoggerModule.forRootAsync({ useFactory: () => buildLoggerOptions(loggerInput()) }),
    ConfigModule,
    SharedKernelModule,
    HealthModule,
    ...DOMAIN_MODULES,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Before every route's own validation: PostgreSQL cannot store NUL,
    // and Zod accepts it. See the pipe.
    { provide: APP_PIPE, useClass: RejectNulPipe },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // First in the chain: everything downstream, including the logger,
    // reads the correlation id this assigns.
    consumer.apply(CorrelationMiddleware).forRoutes('*');
  }
}
