import { useMutation, useQueryClient } from '@tanstack/react-query';

import { patientKeys } from '@/features/shared-domain/patient-identity';
import { isApiError } from '@/types/api';

import type { PrescriptionDraft } from '../model/authoring';
import type { AddPrescriptionNoteInput, EndPrescriptionInput } from '../model/prescription-service';
import type { SignablePrescription } from '../model/safety-check';
import type { EndAct } from '../model/selectors';
import type { Prescription } from '../model/types';
import { prescriptionService } from '../service';

import { prescriptionDraftKeys, prescriptionKeys } from './usePrescriptionsQuery';

/**
 * Pharmacy writes (D-19) — the module's first mutations.
 *
 * **Every write here is pessimistic.** DP-05 allows optimism where a failure
 * costs only a row reappearing; none of these qualifies.
 * `useSignPrescriptionMutation`: an optimistic row saying "Active" that later
 * rolls back is a prescription the doctor believes they issued.
 * `useEndPrescriptionMutation`: an optimistic row saying "Discontinued" that
 * later rolls back is a therapy the doctor believes they stopped — and may
 * already have told the patient so. Both wait for the server, and no amount
 * of DP-05 tidiness may change that.
 */

export function useSaveDraftMutation() {
  const queryClient = useQueryClient();
  return useMutation<PrescriptionDraft, Error, PrescriptionDraft>({
    mutationFn: (draft) => prescriptionService.saveDraft(draft),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: prescriptionDraftKeys.all });
    },
  });
}

export function useDiscardDraftMutation() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (draftId) => prescriptionService.discardDraft(draftId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: prescriptionDraftKeys.all });
    },
  });
}

/**
 * Sign & send. The input type is `SignablePrescription`, whose only producer
 * is `assessSignability` — so this mutation is unreachable without a
 * completed safety verdict, and the adapter re-checks the private symbol at
 * runtime. Pessimistic by design (see the note above).
 */
export function useSignPrescriptionMutation() {
  const queryClient = useQueryClient();
  return useMutation<Prescription, Error, SignablePrescription>({
    mutationFn: (signable) => prescriptionService.sign(signable),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: prescriptionKeys.all });
      void queryClient.invalidateQueries({ queryKey: prescriptionDraftKeys.all });
      // The pharmacy maintains the patient's medication list, which the chart
      // reads under its own keys (its Medications tab and profile bundle).
      void queryClient.invalidateQueries({ queryKey: patientKeys.details() });
    },
    // Two of signing's 409s mean the prescription has moved on: someone else
    // signed it while this request was in flight, or it is no longer in a
    // signable state. Re-read so the screen stops offering a signature. The
    // others (an allergy conflict, an unacknowledged warning, a check that
    // could not run) are safety refusals the flow itself reports.
    onError: (error) => {
      if (!isApiError(error) || error.kind !== 'conflict') return;
      if (error.code !== 'conflict' && error.code !== 'invalid_status_transition') return;
      void queryClient.invalidateQueries({ queryKey: prescriptionKeys.all });
      void queryClient.invalidateQueries({ queryKey: prescriptionDraftKeys.all });
    },
  });
}

export function useRenewPrescriptionMutation() {
  const queryClient = useQueryClient();
  return useMutation<PrescriptionDraft, Error, string>({
    mutationFn: (prescriptionId) => prescriptionService.renew(prescriptionId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: prescriptionDraftKeys.all });
    },
  });
}

/** Input to `useEndPrescriptionMutation`: the act decides the route (DEC-002). */
export type EndPrescriptionRequest = EndPrescriptionInput & { readonly act: EndAct };

/**
 * Cancel or discontinue with a reason (UX P4, DEC-002) — **pessimistic** (see
 * the note above). Nothing in the cache changes until the server answers:
 * while the request is in flight the row and the detail keep their status,
 * and a refusal leaves them exactly as they were. On success the detail is
 * set from the server's answer; either way every prescription query is
 * refetched, so the list shows what the server holds rather than a guess.
 */
export function useEndPrescriptionMutation() {
  const queryClient = useQueryClient();
  return useMutation<Prescription, Error, EndPrescriptionRequest>({
    mutationFn: ({ act, ...input }) =>
      act === 'cancel' ? prescriptionService.cancel(input) : prescriptionService.discontinue(input),
    onSuccess: (prescription) => {
      queryClient.setQueryData(prescriptionKeys.detail(prescription.id), prescription);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: prescriptionKeys.all });
      void queryClient.invalidateQueries({ queryKey: patientKeys.details() });
    },
  });
}

/**
 * Discards an unsigned server draft (BR-DEC-002) — **pessimistic**, like the
 * rest: the row leaves the list only once the server has discarded it and
 * the list has refetched. Only the lists are refetched: the draft's own
 * detail now answers 404, so it is dropped by the caller once whatever page
 * showed it has moved on (`usePrescriptionLifecycle`), not refetched under it.
 */
export function useDiscardPrescriptionDraftMutation() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, string>({
    mutationFn: (prescriptionId) => prescriptionService.discardPrescriptionDraft(prescriptionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: prescriptionKeys.lists() }),
  });
}

/**
 * A note on a prescription (API §7.10) — **pessimistic**, like the record and
 * lab annotations beside it: a note that appears before the server has kept
 * it is a clinical statement the doctor believes is on file. The answer is
 * the whole document, so the detail cache is set from it rather than patched.
 */
export function useAddPrescriptionNoteMutation() {
  const queryClient = useQueryClient();
  return useMutation<Prescription, Error, AddPrescriptionNoteInput>({
    mutationFn: (input) => prescriptionService.addNote(input),
    onSuccess: (prescription) => {
      queryClient.setQueryData(prescriptionKeys.detail(prescription.id), prescription);
    },
  });
}
