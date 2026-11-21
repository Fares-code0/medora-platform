import { Injectable, Module, type OnModuleInit } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';

import { DatabaseModule } from '../database';
import { DEFAULT_RETRY, everyHours, JobRegistry } from '../jobs';

import { IdempotencyInterceptor } from './idempotency.interceptor';
import { IdempotencyStore } from './idempotency.store';

/**
 * Deletes `idempotency_records` past their 24 h window.
 *
 * Hourly, because the window is a day and a row an hour past it is
 * harmless — an expired row is already ignored and overwritten on reuse
 * (`IdempotencyStore.claim`). The sweep exists so the table, which holds
 * stored clinical responses, does not keep them a moment longer than the
 * retry window ADR-014 states.
 */
@Injectable()
export class IdempotencyJobs implements OnModuleInit {
  constructor(
    private readonly registry: JobRegistry,
    private readonly store: IdempotencyStore,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      name: 'idempotency.expiry-sweep',
      summary: 'Deletes stored Idempotency-Key responses past their 24 h window (ADR-014).',
      schedule: everyHours(1),
      retry: DEFAULT_RETRY,
      timeoutMs: 5 * 60_000,
      handler: async ({ now }) => ({ deleted: await this.store.purgeExpired(now) }),
    });
  }
}

/**
 * The idempotency kernel (ADR-014): one global interceptor that acts only
 * on routes marked `@Idempotent()`, its durable store, and the sweep.
 * Registered inside `SharedKernelModule`, like the rate-limit guard.
 */
@Module({
  imports: [DatabaseModule],
  providers: [
    IdempotencyStore,
    IdempotencyJobs,
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
  exports: [IdempotencyStore],
})
export class IdempotencyKernelModule {}
