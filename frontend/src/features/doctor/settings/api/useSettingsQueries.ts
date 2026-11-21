import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createKeyFactory } from '@/api/query-keys';
import { useAuth } from '@/app/providers';

import type {
  ChangePasswordInput,
  SubmitVerificationDocumentInput,
  ToggleIntegrationInput,
} from '../model/settings-service';
import type {
  AccountSettings,
  PrivacySettings,
  SecuritySettings,
  SettingsDocument,
  WorkflowPreferences,
} from '../model/types';
import { settingsService } from '../service';

/**
 * Settings data layer — TanStack Query over the settings seam. The account
 * document is namespaced per user, so every key includes the user id and
 * every mutation threads it through. Mutations return the full patched
 * document and write it straight into the cache so the UI (completion
 * widget, activity log, security posture) updates without a refetch.
 */

export const settingsKeys = createKeyFactory('doctor-settings');

function useUserId(): string {
  const { user } = useAuth();
  return user?.id ?? 'anonymous';
}

export function useSettingsQuery() {
  const userId = useUserId();
  return useQuery({
    queryKey: settingsKeys.detail(userId),
    queryFn: () => settingsService.fetchSettings(userId),
    staleTime: 30_000,
  });
}

/**
 * Shared mutation wiring: run the service call, then seed the returned
 * document into the cache. `onSuccess` only touches the cache (safe under
 * StrictMode — no navigation gated on it).
 */
function useDocumentMutation<TInput>(
  mutationFn: (userId: string, input: TInput) => Promise<SettingsDocument>,
) {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TInput) => mutationFn(userId, input),
    onSuccess: (document) => {
      queryClient.setQueryData(settingsKeys.detail(userId), document);
    },
  });
}

/** Records the "Profile updated" activity entry; the profile itself is saved
 * through the DoctorProfileProvider (single source of truth). */
export function useRecordProfileUpdateMutation() {
  return useDocumentMutation<void>((userId) => settingsService.recordProfileUpdate(userId));
}

export function useSaveAccountMutation() {
  return useDocumentMutation(
    (userId, account: Pick<AccountSettings, 'email' | 'username' | 'phone'>) =>
      settingsService.saveAccount(userId, account),
  );
}

export function useChangePasswordMutation() {
  return useDocumentMutation((userId, input: ChangePasswordInput) =>
    settingsService.changePassword(userId, input),
  );
}

export function useUpdateSecurityMutation() {
  return useDocumentMutation((userId, patch: Partial<Pick<SecuritySettings, 'twoFactorEnabled'>>) =>
    settingsService.updateSecurity(userId, patch),
  );
}

export function useRevokeSessionMutation() {
  return useDocumentMutation((userId, sessionId: string) =>
    settingsService.revokeSession(userId, sessionId),
  );
}

export function useRevokeOtherSessionsMutation() {
  return useDocumentMutation<void>((userId) => settingsService.revokeOtherSessions(userId));
}

export function useRemoveTrustedDeviceMutation() {
  return useDocumentMutation((userId, deviceId: string) =>
    settingsService.removeTrustedDevice(userId, deviceId),
  );
}

export function useUpdatePrivacyMutation() {
  return useDocumentMutation((userId, privacy: PrivacySettings) =>
    settingsService.updatePrivacy(userId, privacy),
  );
}

export function useSaveWorkflowMutation() {
  return useDocumentMutation((userId, workflow: WorkflowPreferences) =>
    settingsService.saveWorkflow(userId, workflow),
  );
}

export function useToggleIntegrationMutation() {
  return useDocumentMutation((userId, input: ToggleIntegrationInput) =>
    settingsService.toggleIntegration(userId, input),
  );
}

/* ── Two-factor enrolment (FE-10.9) ────────────────────────────── */

/**
 * Mints a new enrolment secret once the current password checks out (owner
 * decision D2). Not a document write: nothing is on yet.
 */
export function useBeginTwoFactorSetupMutation() {
  const userId = useUserId();
  return useMutation({
    mutationFn: (password: string) => settingsService.beginTwoFactorSetup(userId, password),
  });
}

export function useEnableTwoFactorMutation() {
  return useDocumentMutation((userId, code: string) =>
    settingsService.enableTwoFactor(userId, code),
  );
}

export function useDisableTwoFactorMutation() {
  return useDocumentMutation((userId, password: string) =>
    settingsService.disableTwoFactor(userId, password),
  );
}

/**
 * Replacing the authenticator (owner decision Q7 / R4). Step 1 changes
 * nothing on the server, so it is not a document write.
 */
export function useBeginTwoFactorReenrollMutation() {
  const userId = useUserId();
  return useMutation({
    mutationFn: (input: { password: string; code: string }) =>
      settingsService.beginTwoFactorReenrollment(userId, input),
  });
}

/**
 * Step 2 replaces the factor and the recovery codes, and the server writes
 * an activity entry: the document is re-read so the count and the log agree
 * with it, rather than patched with a guess.
 */
export function useConfirmTwoFactorReenrollMutation() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { enrolmentToken: string; code: string }) =>
      settingsService.confirmTwoFactorReenrollment(userId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: settingsKeys.detail(userId) }),
  });
}

/* ── Verification documents (NEW-46) ───────────────────────────── */

function verificationKey(userId: string) {
  return settingsKeys.list({ userId, scope: 'verification-documents' });
}

export function useVerificationDocumentsQuery() {
  const userId = useUserId();
  return useQuery({
    queryKey: verificationKey(userId),
    queryFn: () => settingsService.listVerificationDocuments(userId),
    staleTime: 30_000,
  });
}

/**
 * Uploads and files one document. Not a document write: the list is re-read
 * rather than patched, so it shows the server's row and order, and the
 * settings document is too, because the server records the submission in
 * the activity log.
 */
export function useSubmitVerificationDocumentMutation() {
  const userId = useUserId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SubmitVerificationDocumentInput) =>
      settingsService.submitVerificationDocument(userId, input),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: verificationKey(userId) }),
        queryClient.invalidateQueries({ queryKey: settingsKeys.detail(userId) }),
      ]),
  });
}
