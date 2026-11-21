/**
 * The administrator's query hooks for clinic operations.
 *
 * The hooks themselves **moved to `shared-domain/clinic-operations/queries.ts`**
 * (D-27b) so the doctor's own-clinic board can read the same query keys — see
 * `administration.api.ts` for why. Re-exported here so this module's existing
 * importers are unchanged.
 *
 * `useAuditEvents` stays behind for the same reason `getAuditEvents` does:
 * the feed is a projection through ADM-07's taxonomy, which is admin code.
 */

import { useQuery } from '@tanstack/react-query';

import { administrationKeys } from '@/features/shared-domain/clinic-operations/queries';

import { administrationApi } from './administration.api';

export * from '@/features/shared-domain/clinic-operations/queries';

export function useAuditEvents() {
  return useQuery({
    queryKey: administrationKeys.auditEvents(),
    queryFn: administrationApi.getAuditEvents,
    staleTime: 60_000,
  });
}
