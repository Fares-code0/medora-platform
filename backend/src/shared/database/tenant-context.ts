/**
 * Tenant context for Row-Level Security (multi-hospital §2.15, fix-list
 * item 21; RLS_BACKEND_CONTRACT.md).
 *
 * The context lives in an `AsyncLocalStorage` store opened per request (and
 * per job unit). `TenantContextAdapter` reads it and opens every database
 * transaction — explicit or the implicit one around a single statement —
 * with transaction-local `set_config(…, true)` calls, so a pooled
 * connection never carries one request's tenant into the next.
 *
 * No context means no settings, and the policies fail closed.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * `self`: a signed-in caller with no tenant (an administrator without a
 * scope, a doctor or staff member outside clinical standing). The database
 * treats it as no scope at all — every tenant clause is false — but knows
 * the user, so the rows that are theirs by identity (their own uploads,
 * notifications, conversations) still work.
 */
export type TenantScope = 'hospital' | 'platform' | 'patient' | 'system' | 'self';

export interface TenantContext {
  readonly scope: TenantScope;
  readonly hospitalId?: string | undefined;
  readonly userId?: string | undefined;
  readonly patientId?: string | undefined;
}

interface Store {
  context: TenantContext | undefined;
}

const storage = new AsyncLocalStorage<Store>();

/** Opens an empty, mutable store for one request; the guard fills it. */
export function runInTenantScope<T>(work: () => T): T {
  return storage.run({ context: undefined }, work);
}

/** Runs `work` under `context`, restoring the caller's afterwards. */
export function runWithTenantContext<T>(context: TenantContext, work: () => T): T {
  return storage.run({ context }, work);
}

/**
 * Trusted server-side lookups that establish *who the caller is* (their own
 * employment, affiliation, admin grant, a patient's record for DR-05) run
 * under `system` scope: they precede any tenant context and decide it.
 */
export function runAsSystem<T>(work: () => T): T {
  return runWithTenantContext({ scope: 'system' }, work);
}

/** Sets the current request's context (no-op outside a request store). */
export function setTenantContext(context: TenantContext | undefined): void {
  const store = storage.getStore();
  if (store !== undefined) store.context = context;
}

export function currentTenantContext(): TenantContext | undefined {
  return storage.getStore()?.context;
}

/** The parameters of the one `set_config` statement a transaction opens with. */
export function tenantSettings(context: TenantContext): string[] {
  return [context.scope, context.hospitalId ?? '', context.userId ?? '', context.patientId ?? ''];
}

export const TENANT_SETTINGS_SQL =
  "SELECT set_config('app.scope', $1, true), set_config('app.hospital_id', $2, true), " +
  "set_config('app.user_id', $3, true), set_config('app.patient_id', $4, true)";
