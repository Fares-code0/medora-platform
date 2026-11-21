/**
 * Patients management — TanStack Query hooks (ADM-04).
 *
 * One query for the whole document. The list and the profile read the same
 * cache entry, so a revocation made on the profile is already true when the
 * administrator navigates back to the list — no refetch, no stale count.
 *
 * Mutations resolve to the full patched document and seed the cache with
 * `setQueryData`, the StrictMode-safe pattern used across the app.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  patientsApi,
  type AccountInput,
  type DenyRequestInput,
  type PatientsDocument,
  type ReasonedAccountInput,
  type RequestDecisionInput,
  type RevokeInput,
} from './patients.api';

const STALE_MS = 30_000;

export const patientsKeys = {
  all: ['admin', 'patients'] as const,
  document: () => [...patientsKeys.all, 'document'] as const,
} as const;

export function usePatientsDocument() {
  return useQuery({
    queryKey: patientsKeys.document(),
    queryFn: patientsApi.list,
    staleTime: STALE_MS,
  });
}

export function usePatientsMutations() {
  const queryClient = useQueryClient();
  const seed = (next: PatientsDocument) => {
    queryClient.setQueryData(patientsKeys.document(), next);
  };

  const unlock = useMutation({
    mutationFn: (input: AccountInput) => patientsApi.unlock(input),
    onSuccess: seed,
  });

  const resetCredentials = useMutation({
    mutationFn: (input: AccountInput) => patientsApi.resetCredentials(input),
    onSuccess: seed,
  });

  const deactivate = useMutation({
    mutationFn: (input: ReasonedAccountInput) => patientsApi.deactivate(input),
    onSuccess: seed,
  });

  const reactivate = useMutation({
    mutationFn: (input: AccountInput) => patientsApi.reactivate(input),
    onSuccess: seed,
  });

  const revokeAccess = useMutation({
    mutationFn: (input: RevokeInput) => patientsApi.revokeAccess(input),
    onSuccess: seed,
  });

  const approveRequest = useMutation({
    mutationFn: (input: RequestDecisionInput) => patientsApi.approveRequest(input),
    onSuccess: seed,
  });

  const denyRequest = useMutation({
    mutationFn: (input: DenyRequestInput) => patientsApi.denyRequest(input),
    onSuccess: seed,
  });

  return {
    unlock,
    resetCredentials,
    deactivate,
    reactivate,
    revokeAccess,
    approveRequest,
    denyRequest,
  };
}
