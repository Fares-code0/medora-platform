import { AsyncLocalStorage } from 'node:async_hooks';

import { Injectable, type NestMiddleware } from '@nestjs/common';

/**
 * Per-request memo for Phase 22 lookups (Node's own AsyncLocalStorage; no
 * dependency).
 *
 * Why it exists: the hospital context was resolved eagerly by a global
 * interceptor on every authenticated request, and again by the patient-scope
 * shadow on every `canReach` — duplicate round trips on the hottest paths
 * (PHASE22_BACKEND_HANDOFF.md, corrections 1–3). With this store a lookup
 * runs only when something reads it, and at most once per request.
 *
 * Isolation rules:
 * - one fresh store per HTTP request, created by the middleware below; it is
 *   discarded with the request, so nothing outlives it;
 * - outside a request (jobs, scripts, unit tests) there is no store and every
 *   call simply runs the lookup — nothing is cached;
 * - a rejected lookup is evicted, so a failure is never served from the memo.
 *
 * Callers key entries by everything the value depends on (user id, role,
 * patient id), so two principals can never share an entry even if they ever
 * ran in one store.
 */
const storage = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

export function runInRequestScope<T>(work: () => T): T {
  return storage.run(new Map(), work);
}

export function memoizeInRequest<T>(key: string, lookup: () => Promise<T>): Promise<T> {
  const store = storage.getStore();
  if (store === undefined) return lookup();

  const cached = store.get(key) as Promise<T> | undefined;
  if (cached !== undefined) return cached;

  const pending = lookup();
  store.set(key, pending);
  pending.catch(() => {
    if (store.get(key) === pending) store.delete(key);
  });
  return pending;
}

/** Opens the per-request store before guards, interceptors and handlers run. */
@Injectable()
export class RequestScopeMiddleware implements NestMiddleware {
  use(_request: unknown, _response: unknown, next: () => void): void {
    runInRequestScope(next);
  }
}
