/**
 * Public API — `Idempotency-Key` (ADR-014, API §0.5).
 *
 * Modules mark a route with `@Idempotent()`; the global interceptor and
 * the durable store do the rest. Nothing else here is for modules.
 */
export { Idempotent } from './idempotent.decorator';
export { IdempotencyKernelModule } from './idempotency.module';
export { IDEMPOTENCY_TTL_MS, IdempotencyStore } from './idempotency.store';
export { fingerprintOf, REPLAYED_HEADER } from './idempotency.interceptor';
