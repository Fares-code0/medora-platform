/**
 * Users, roles and staff invitations — TanStack Query hooks (FE-10.10).
 *
 * Every write resolves to the server's own answer — the updated account,
 * the matrix as saved — and that answer is what reaches the cache. The
 * Users panel in particular must never show a role the platform refused,
 * which an optimistic copy would do after a 409.
 *
 * In the demo build the users and the matrix are fields of the settings
 * document, so a write here also refreshes that document's query.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { adminSettingsKeys } from '../api/useAdminSettingsQueries';
import type { PermissionMatrix } from '../permissions';

import type { AccessUserQuery, CreateRoleInput, StaffInvitationInput } from './access-service';
import { accessService } from './service';

const STALE_MS = 30_000;

export const accessKeys = {
  all: ['admin', 'access'] as const,
  users: (query: AccessUserQuery) => [...accessKeys.all, 'users', query] as const,
  usersAll: () => [...accessKeys.all, 'users'] as const,
  matrix: () => [...accessKeys.all, 'matrix'] as const,
  roleCounts: () => [...accessKeys.all, 'role-counts'] as const,
  roles: () => [...accessKeys.all, 'roles'] as const,
  matrixPreview: (matrix: PermissionMatrix) =>
    [...accessKeys.all, 'matrix-preview', matrix] as const,
} as const;

/** What this build's access service can do. */
export const accessCapabilities = accessService.capabilities;

export function useAccessUsers(query: AccessUserQuery) {
  return useQuery({
    queryKey: accessKeys.users(query),
    queryFn: () => accessService.listUsers(query),
    staleTime: STALE_MS,
    placeholderData: (previous) => previous,
  });
}

export function usePermissionMatrix() {
  return useQuery({
    queryKey: accessKeys.matrix(),
    queryFn: () => accessService.getMatrix(),
    staleTime: STALE_MS,
  });
}

export function useRoleCounts() {
  return useQuery({
    queryKey: accessKeys.roleCounts(),
    queryFn: () => accessService.roleCounts(),
    staleTime: STALE_MS,
  });
}

/**
 * The server's dry run of a proposed matrix (API §15.3), asked for only while
 * the review dialog is open. Never cached past it: the answer is about the
 * stored matrix and the accounts as they are now, and both move.
 */
export function useMatrixPreview(matrix: PermissionMatrix, enabled: boolean) {
  return useQuery({
    queryKey: accessKeys.matrixPreview(matrix),
    queryFn: () => accessService.previewMatrix(matrix),
    enabled,
    staleTime: 0,
    gcTime: 0,
  });
}

export function useUpdateAccessUserMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; changes: { role?: string; active?: boolean } }) =>
      accessService.updateUser(input.id, input.changes),
    onSettled: () => {
      // The row, the per-role counts behind the matrix's "accounts affected",
      // and — in the demo — the settings document all moved, or may have.
      void queryClient.invalidateQueries({ queryKey: accessKeys.usersAll() });
      void queryClient.invalidateQueries({ queryKey: accessKeys.roleCounts() });
      void queryClient.invalidateQueries({ queryKey: adminSettingsKeys.all });
    },
  });
}

export function useSavePermissionsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { matrix: PermissionMatrix; baseRevision: number; actor: string }) =>
      accessService.saveMatrix(input),
    onSuccess: (state) => {
      queryClient.setQueryData(accessKeys.matrix(), state);
      void queryClient.invalidateQueries({ queryKey: adminSettingsKeys.all });
    },
  });
}

export function useResetPermissionsMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (actor: string) => accessService.resetMatrix(actor),
    onSuccess: (state) => {
      queryClient.setQueryData(accessKeys.matrix(), state);
      void queryClient.invalidateQueries({ queryKey: adminSettingsKeys.all });
    },
  });
}

export function useInviteStaffMutation() {
  return useMutation({
    mutationFn: (input: StaffInvitationInput) => accessService.invite(input),
  });
}

/** Every role, platform and custom (API §15.1) — labels and member counts. */
export function useAccessRoles() {
  return useQuery({
    queryKey: accessKeys.roles(),
    queryFn: () => accessService.listRoles(),
    staleTime: STALE_MS,
  });
}

/**
 * A custom role (API §15.4). Pessimistic: it settles once the role list has
 * been re-read, so the dialog never announces a role the list does not show.
 */
export function useCreateRoleMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRoleInput) => accessService.createRole(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: accessKeys.roles() }),
  });
}
