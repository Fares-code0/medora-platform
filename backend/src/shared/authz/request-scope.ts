import { AsyncLocalStorage } from 'node:async_hooks';

import { Injectable, type NestMiddleware } from '@nestjs/common';

import { runInTenantScope } from '../database';

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
 *
 * ## Background work never inherits a request's store (audit F5, #24)
 *
 * AsyncLocalStorage follows the async call graph, so a timer, a
 * fire-and-forget promise or an inline job started *during* a request would
 * otherwise carry that request's store for its whole life — and with it
 * whatever the store holds then (today the Phase 22 memo; later, a tenant
 * context). The rules:
 *
 * - **Request-bound work** (guards, handlers, and the detached patient-scope
 *   shadow, which observes the very request that started it) may read the
 *   store.
 * - **Independent background work** — every background job run (both
 *   drivers, every retry) — starts under `runOutsideRequestScope`, so it sees
 *   no store and every lookup runs fresh for the principal it names.
 * - A job that ever needs a hospital must be given an explicit, validated
 *   hospital id and actor in its payload and resolve them itself. There is no
 *   ambient fallback: with no store, nothing is cached and nothing is
 *   implied, and no code path reads "no context" as "every hospital".
 */
const storage = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

export function runInRequestScope<T>(work: () => T): T {
  return storage.run(new Map(), work);
}

/**
 * Runs `work` with no request store, even when called from inside a request.
 *
 * For work that outlives, or is independent of, the request that started it.
 * Promises, timers and callbacks created inside `work` inherit the empty
 * context, so retries and re-armed timers stay outside any request too.
 */
export function runOutsideRequestScope<T>(work: () => T): T {
  return storage.exit(work);
}

/** Whether the caller is running inside a request store. For assertions and diagnostics. */
export function inRequestScope(): boolean {
  return storage.getStore() !== undefined;
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
    // Also opens the request's tenant-context store (§2.15), filled by the
    // authorization guard once the caller is resolved.
    runInRequestScope(() => runInTenantScope(next));
  }
}
