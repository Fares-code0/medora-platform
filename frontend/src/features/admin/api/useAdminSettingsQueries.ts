/**
 * Admin Platform Settings — TanStack Query layer (Phase 18).
 * One document query; every mutation resolves with the full patched
 * document and seeds the cache via setQueryData (never a mutate-level
 * callback for anything load-bearing — the StrictMode lesson).
 */

import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';

import { notConnected } from '@/api/http';
import { selectService } from '@/api/seam';

import type {
  AdminSettingsDocument,
  AdminSettingsFormKey,
  AdminSettingsFormSlices,
} from '../admin-settings.types';

import { adminSettingsApi, type CreatedApiKey } from './admin-settings.api';

export const adminSettingsKeys = {
  all: ['administration', 'settings'] as const,
  document: () => [...adminSettingsKeys.all, 'document'] as const,
};

/**
 * The platform-settings source, reads and writes alike. It is a demo store
 * with no backend this client may use, so in a live build every operation
 * answers not connected (FE-10.10) — the panels built on it say so instead of
 * showing seeded settings next to a real sign-in. Users, Roles and the audit
 * feed read their own sources and do not ask for it.
 *
 * Writes go through the seam too (RM M40.5). They used to call the demo store
 * directly, so a live build that reached a save would have "saved" into this
 * browser's localStorage and reported success. The server's `/platform-settings`
 * (RM M24) is not wired: it answers any `admin`, and OD-07 reserves platform
 * settings to a Platform Admin role the session cannot yet name.
 */
type PlatformSettingsSource = Pick<
  typeof adminSettingsApi,
  | 'getSettings'
  | 'saveSection'
  | 'resetSection'
  | 'toggleIntegration'
  | 'revokeApiKey'
  | 'createBackup'
  | 'deleteBackup'
  | 'createApiKey'
>;

const refuse = (): Promise<never> => Promise.reject(notConnected('Platform settings'));

export const unconnectedPlatformSettings: PlatformSettingsSource = {
  getSettings: refuse,
  saveSection: refuse,
  resetSection: refuse,
  toggleIntegration: refuse,
  revokeApiKey: refuse,
  createBackup: refuse,
  deleteBackup: refuse,
  createApiKey: refuse,
};

const platformSettings: PlatformSettingsSource = selectService({
  mock: adminSettingsApi,
  http: unconnectedPlatformSettings,
});

const loadSettings = (): Promise<AdminSettingsDocument> => platformSettings.getSettings();

export function useAdminSettings({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: adminSettingsKeys.document(),
    queryFn: loadSettings,
    staleTime: 60_000,
    enabled,
  });
}

function useDocumentMutation<TVariables>(
  mutationFn: (variables: TVariables) => Promise<AdminSettingsDocument>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (document) => {
      queryClient.setQueryData(adminSettingsKeys.document(), document);
    },
  });
}

export function useSaveSectionMutation<K extends AdminSettingsFormKey>(key: K) {
  return useDocumentMutation((value: AdminSettingsFormSlices[K]) =>
    platformSettings.saveSection(key, value),
  );
}

export function useResetSectionMutation<K extends AdminSettingsFormKey>(key: K) {
  return useDocumentMutation((_: void) => platformSettings.resetSection(key));
}

export function useToggleIntegrationMutation() {
  return useDocumentMutation((id: string) => platformSettings.toggleIntegration(id));
}

export function useRevokeApiKeyMutation() {
  return useDocumentMutation((id: string) => platformSettings.revokeApiKey(id));
}

export function useCreateBackupMutation() {
  return useDocumentMutation((_: void) => platformSettings.createBackup());
}

export function useDeleteBackupMutation() {
  return useDocumentMutation((id: string) => platformSettings.deleteBackup(id));
}

export function useCreateApiKeyMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (label: string): Promise<CreatedApiKey> => platformSettings.createApiKey(label),
    onSuccess: (created) => {
      queryClient.setQueryData(adminSettingsKeys.document(), created.document);
    },
  });
}
