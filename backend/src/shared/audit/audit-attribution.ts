/**
 * The reader's attribution for mandatory disclosure events (multi-hospital
 * §2.13; audit F-02, F-04).
 *
 * `PhiReadAuditInterceptor` resolves, once per PHI read, the hospital the
 * reader acts at — from the server's own staffing records, never from the
 * request — and runs the handler inside this store. `MandatoryAuditWriter`
 * fills an event's `hospitalId` and `sessionId` from it when the call site
 * left them unset, so a handler-written disclosure (`patient.view`,
 * `file.download`, the exports) is attributed exactly as the interceptor's
 * own `phi.read` is. A call site that names a hospital (a grant's target, a
 * request's hospital) keeps it; the ledger's append policy then validates
 * that attribution against the request's tenant context.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface AuditAttribution {
  readonly hospitalId: string | null;
  readonly sessionId?: string | undefined;
}

const storage = new AsyncLocalStorage<AuditAttribution>();

export function runWithAuditAttribution<T>(attribution: AuditAttribution, work: () => T): T {
  return storage.run(attribution, work);
}

export function currentAuditAttribution(): AuditAttribution | undefined {
  return storage.getStore();
}
