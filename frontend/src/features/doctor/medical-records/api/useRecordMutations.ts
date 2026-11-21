import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { isApiError } from '@/types/api';

import type { CompleteRecordDraft, MedicalRecordDraft } from '../model/authoring';
import type { SignableNote } from '../model/record-lifecycle';
import type {
  AmendRecordInput,
  ReportRecordIssueInput,
  SetRecordStatusInput,
  UpdateRecordInput,
} from '../model/record-service';
import type { MedicalRecord } from '../model/types';
import { recordService } from '../service';

import { medicalRecordKeys, recordDraftKeys } from './useMedicalRecordsQuery';

/**
 * A 409 on a record write means the record is not what this screen shows:
 * `stale_write` ("the record changed while this request was in flight;
 * reload and try again") or `note_already_signed`. The server asks for a
 * reload, so do it: re-read the record and the lists, and the retry the
 * message invites starts from what is there now rather than failing again.
 */
function refreshOnConflict(queryClient: QueryClient, error: Error, recordId: string): void {
  if (!isApiError(error) || error.kind !== 'conflict') return;
  void queryClient.invalidateQueries({ queryKey: medicalRecordKeys.detail(recordId) });
  void queryClient.invalidateQueries({ queryKey: medicalRecordKeys.lists() });
}

/**
 * The authoring writes (D-21) — the module's first mutations.
 *
 * **Every one of them is pessimistic**, and for the reason the pharmacy's
 * `sign` and the labs' `markReviewed` are: each of these is a claim about a
 * clinical record. A note that shows as signed before the write lands is a
 * doctor believing they have attested to something. DP-05's optimistic
 * updates belong on reversible state a user is looking at; none of this is
 * that.
 *
 * `useSignNoteMutation` takes `SignableNote`, whose only producer is
 * `assessNoteSignability`, so it is unreachable without an existing, unsigned,
 * non-empty note of the signer's own.
 */

export function useSaveRecordDraftMutation() {
  const queryClient = useQueryClient();
  return useMutation<MedicalRecordDraft, Error, MedicalRecordDraft>({
    mutationFn: (draft) => recordService.saveDraft(draft),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: recordDraftKeys.all });
    },
  });
}

export function useDiscardRecordDraftMutation() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (draftId) => recordService.discardDraft(draftId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: recordDraftKeys.all });
    },
  });
}

/** Creates the record. Its first note arrives unsigned — signing is separate. */
export function useCreateRecordMutation() {
  const queryClient = useQueryClient();
  return useMutation<
    MedicalRecord,
    Error,
    { readonly draft: CompleteRecordDraft; readonly authoredBy: string }
  >({
    mutationFn: ({ draft, authoredBy }) => recordService.createRecord(draft, authoredBy),
    onSuccess: (created) => {
      queryClient.setQueryData(medicalRecordKeys.detail(created.id), created);
      void queryClient.invalidateQueries({ queryKey: medicalRecordKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: recordDraftKeys.all });
    },
  });
}

export function useSignNoteMutation() {
  const queryClient = useQueryClient();
  return useMutation<MedicalRecord, Error, SignableNote>({
    mutationFn: (signable) => recordService.signNote(signable),
    onSuccess: (updated) => {
      queryClient.setQueryData(medicalRecordKeys.detail(updated.id), updated);
      void queryClient.invalidateQueries({ queryKey: medicalRecordKeys.lists() });
    },
    onError: (error, signable) => refreshOnConflict(queryClient, error, signable.recordId),
  });
}

/** Appends an addendum — the only way to change what a record says. */
export function useAmendRecordMutation() {
  const queryClient = useQueryClient();
  return useMutation<MedicalRecord, Error, AmendRecordInput>({
    mutationFn: (input) => recordService.amendRecord(input),
    onSuccess: (updated) => {
      queryClient.setQueryData(medicalRecordKeys.detail(updated.id), updated);
      void queryClient.invalidateQueries({ queryKey: medicalRecordKeys.lists() });
    },
    onError: (error, input) => refreshOnConflict(queryClient, error, input.recordId),
  });
}

export function useSetRecordStatusMutation() {
  const queryClient = useQueryClient();
  return useMutation<MedicalRecord, Error, SetRecordStatusInput>({
    mutationFn: (input) => recordService.setStatus(input),
    onSuccess: (updated) => {
      queryClient.setQueryData(medicalRecordKeys.detail(updated.id), updated);
      void queryClient.invalidateQueries({ queryKey: medicalRecordKeys.lists() });
    },
    onError: (error, input) => refreshOnConflict(queryClient, error, input.recordId),
  });
}

/**
 * Edits a draft record's fields (DEC-004) — pessimistic, like every write in
 * this module. The detail is replaced with the server's answer and the
 * version history refetched, so the change and its trail appear together.
 */
export function useUpdateRecordMutation() {
  const queryClient = useQueryClient();
  return useMutation<MedicalRecord, Error, UpdateRecordInput>({
    mutationFn: (input) => recordService.updateRecord(input),
    onSuccess: async (updated) => {
      queryClient.setQueryData(medicalRecordKeys.detail(updated.id), updated);
      void queryClient.invalidateQueries({ queryKey: medicalRecordKeys.lists() });
      await queryClient.invalidateQueries({
        queryKey: [...medicalRecordKeys.detail(updated.id), 'versions'],
      });
    },
    onError: (error, input) => refreshOnConflict(queryClient, error, input.recordId),
  });
}

/**
 * Reports a data issue on a record (API §6.9). Nothing on the record changes,
 * so there is nothing to invalidate; the mutation only says whether the
 * report was kept.
 */
export function useReportRecordIssueMutation() {
  return useMutation<void, Error, ReportRecordIssueInput>({
    mutationFn: (input) => recordService.reportIssue(input),
  });
}
