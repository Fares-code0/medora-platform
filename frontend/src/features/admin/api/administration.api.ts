/**
 * The administrator's view of the clinic-operations store.
 *
 * The store itself **moved to `shared-domain/clinic-operations/store.ts`**
 * (D-27b): the doctor's own-clinic board reads the same mutable collections
 * the administrator edits, and §3.4 forbids `features/doctor/` importing
 * `features/admin/`. Everything there is re-exported here so this module's
 * ~30 existing importers are unchanged.
 *
 * One method is composed here rather than moved, because it is genuinely
 * admin-specific: the **audit feed**. shared-domain may not import a role
 * feature (§3.3), and the taxonomy that classifies an audit row lives in
 * `features/admin/logs/logs.ts`. So the store exposes the rows
 * (`getAuditRows`) and this layer projects them.
 */

import { clinicOperationsApi } from '@/features/shared-domain/clinic-operations/store';
import type { AuditEvent } from '@/features/shared-domain/clinic-operations/types';

import { fromLegacyAudit, projectAuditFeed } from '../logs/logs';

export * from '@/features/shared-domain/clinic-operations/store';

/**
 * Seeded platform events plus every logged PHI reveal, newest first — as a
 * projection of ADM-07's log rather than a second store beside it.
 *
 * The rows are assembled by the store rather than read from `logsApi`: that
 * module imports *this* one, so calling it would close a cycle. What comes
 * from ADM-07 is the taxonomy — `fromLegacyAudit` classifies each row and
 * `projectAuditFeed` keeps the ones the summary feed shows — so the feed and
 * the log can no longer disagree about what an event *is*. `logs.ts` is safe
 * to import: it is pure and imports no service.
 */
async function getAuditEvents(): Promise<readonly AuditEvent[]> {
  const rows = await clinicOperationsApi.getAuditRows();
  return projectAuditFeed(fromLegacyAudit(rows))
    .slice()
    .sort((a, b) => b.at.localeCompare(a.at));
}

/**
 * `Object.assign`, not a spread: the administrator and the doctor must share
 * **one** service object. A copy would give each side its own `phiAccess`
 * and its own CRUD closures, and a test that stubs a method on one would
 * silently not affect the other — which is exactly the class of divergence
 * moving the store into shared-domain was meant to prevent.
 */
export const administrationApi = Object.assign(clinicOperationsApi, { getAuditEvents });
