/**
 * Doctors management — TanStack Query hooks (ADM-02 / ADM-03, FE-10.10).
 *
 * The roster is one query; an opened profile is a second, because the live
 * API serves the credential documents and contact details on the detail
 * only (API §3.5). In the demo build both read the same store, so a
 * verification completed on the profile is already true when the
 * administrator navigates back to the queue.
 *
 * A write resolves to the patched demo document — seeded straight into the
 * cache, the StrictMode-safe pattern used across the app — or to `null`
 * from the live adapter, which means "ask the server again": the roster,
 * every open profile and the pending-verification badge are invalidated
 * together, so none of them can keep showing a decision the server has
 * since moved past.
 */

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';

import { inTab } from '../doctors';
import type { AdministrativeFields, DoctorRecord } from '../doctors.types';

import type { ChecklistTickInput, RequestDocumentsInput } from './doctors-service';
import type {
  AccountInput,
  DoctorsDocument,
  DocumentDecisionInput,
  InviteInput,
  VerificationInput,
} from './doctors.api';
import { doctorsKeys } from './keys';
import { doctorsService } from './service';

const STALE_MS = 30_000;

export { doctorsKeys };

/** What this build's doctors service can do — the screens offer only that. */
export const doctorsCapabilities = doctorsService.capabilities;

export function useDoctorsDocument() {
  return useQuery({
    queryKey: doctorsKeys.document(),
    queryFn: () => doctorsService.list(),
    staleTime: STALE_MS,
  });
}

/** One doctor's full administrative file; `data` is `null` for an unknown id. */
export function useDoctorDetail(doctorId: string) {
  return useQuery({
    queryKey: doctorsKeys.detail(doctorId),
    queryFn: () => doctorsService.detail(doctorId),
    staleTime: STALE_MS,
    enabled: doctorId.length > 0,
  });
}

/** Applies a write's answer: seed from a demo document, or re-read the server. */
function settle(queryClient: QueryClient, result: DoctorsDocument | null): void {
  if (result === null) {
    void queryClient.invalidateQueries({ queryKey: doctorsKeys.all });
    return;
  }
  queryClient.setQueryData(doctorsKeys.document(), result);
  for (const doctor of result.doctors) {
    if (queryClient.getQueryData(doctorsKeys.detail(doctor.id)) !== undefined) {
      queryClient.setQueryData(doctorsKeys.detail(doctor.id), doctor);
    }
  }
  queryClient.setQueryData(
    doctorsKeys.pending(),
    result.doctors.filter((doctor) => inTab(doctor, 'pending')).length,
  );
}

/** A tick shows at once on the open profile, whichever store keeps it. */
function tickLocally(queryClient: QueryClient, input: ChecklistTickInput): void {
  queryClient.setQueryData<DoctorRecord | null>(doctorsKeys.detail(input.doctorId), (doctor) =>
    doctor === undefined || doctor === null
      ? doctor
      : {
          ...doctor,
          documents: doctor.documents.map((entry) =>
            entry.id === input.documentId
              ? { ...entry, checklist: { ...entry.checklist, [input.field]: input.value } }
              : entry,
          ),
        },
  );
}

export function useDoctorsMutations() {
  const queryClient = useQueryClient();
  const onSuccess = (result: DoctorsDocument | null) => settle(queryClient, result);

  const setCheck = useMutation({
    mutationFn: (input: ChecklistTickInput) => doctorsService.setCheck(input),
    onMutate: (input) => tickLocally(queryClient, input),
    // A live tick is session memory the adapter already holds, and the
    // detail cache was patched above — re-reading the server for it would
    // only cost a round trip per box.
    onSuccess: (result) => {
      if (result !== null) settle(queryClient, result);
    },
  });

  const approveDocument = useMutation({
    mutationFn: (input: DocumentDecisionInput) => doctorsService.approveDocument(input),
    onSuccess,
  });

  const rejectDocument = useMutation({
    mutationFn: (input: DocumentDecisionInput) => doctorsService.rejectDocument(input),
    onSuccess,
  });

  const completeVerification = useMutation({
    mutationFn: (input: VerificationInput) => doctorsService.completeVerification(input),
    onSuccess,
  });

  const requestDocuments = useMutation({
    mutationFn: (input: RequestDocumentsInput) => doctorsService.requestDocuments(input),
    onSuccess,
  });

  const rejectApplication = useMutation({
    mutationFn: (input: VerificationInput) => doctorsService.rejectApplication(input),
    onSuccess,
  });

  const returnToReview = useMutation({
    mutationFn: (input: VerificationInput) => doctorsService.returnToReview(input),
    onSuccess,
  });

  const suspend = useMutation({
    mutationFn: (input: AccountInput) => doctorsService.suspend(input),
    onSuccess,
  });

  const reactivate = useMutation({
    mutationFn: (input: AccountInput) => doctorsService.reactivate(input),
    onSuccess,
  });

  const resetAccess = useMutation({
    mutationFn: (input: AccountInput) => doctorsService.resetAccess(input),
    onSuccess,
  });

  const updateAdministrative = useMutation({
    mutationFn: (input: { doctorId: string; actor: string; fields: AdministrativeFields }) =>
      doctorsService.updateAdministrative(input),
    onSuccess,
  });

  const invite = useMutation({
    mutationFn: (input: InviteInput) => doctorsService.invite(input),
    onSuccess,
  });

  return {
    setCheck,
    approveDocument,
    rejectDocument,
    completeVerification,
    requestDocuments,
    rejectApplication,
    returnToReview,
    suspend,
    reactivate,
    resetAccess,
    updateAdministrative,
    invite,
  };
}
