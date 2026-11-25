import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { isApiError } from '@/types/api';

import {
  PATIENT_NOT_FOUND,
  type ChartNoteInput,
  type EmergencyContactInput,
  type NoteAuthor,
  type NewAlertInput,
  type NewAllergyInput,
  type NewHistoryEventInput,
} from '../model/profile-service';
import type {
  AllergyRecord,
  ClinicalAlert,
  ClinicalNote,
  EmergencyContact,
  MedicalHistoryEvent,
  ProfileTab,
  VitalSigns,
} from '../model/profile-types';
import type { NewVitalsInput } from '../model/vitals';
import { patientProfileService } from '../service';

import { patientKeys } from './usePatientsQuery';

/**
 * Patient profile queries, through the profile port (FE-10.2): the mock
 * chart generator or the API, by the seam's flag. A chart that does not
 * exist — or is outside the doctor's care scope, which the server reports
 * identically — rejects with PATIENT_NOT_FOUND, which the page maps to its
 * not-found state and which is not retried.
 */

export { PATIENT_NOT_FOUND };

/**
 * The global rule first (configs/query-client.ts): only a network failure is
 * retried, so a 403 or 500 is not re-sent twice behind a spinner. A chart
 * that does not exist is never retried either.
 */
function retryUnlessNotFound(failureCount: number, error: Error): boolean {
  if (isApiError(error) && error.kind !== 'network') return false;
  return error.message === PATIENT_NOT_FOUND ? false : failureCount < 2;
}

export function usePatientProfileQuery(patientId: string) {
  return useQuery({
    queryKey: patientKeys.detail(patientId),
    queryFn: () => patientProfileService.getProfile(patientId),
    staleTime: 30_000,
    retry: retryUnlessNotFound,
  });
}

/**
 * One tab's record, fetched when `enabled` — the page enables a tab's query
 * only while that tab is open, so a tab nobody opened is never read (and
 * never audited as read). Once loaded it stays cached, which is what lets
 * the tab strip show its count after a visit. Keyed under the chart's
 * detail key, so invalidating the chart invalidates its tabs.
 */
export function usePatientTabQuery<T extends ProfileTab>(
  patientId: string,
  tab: T,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [...patientKeys.detail(patientId), 'tab', tab] as const,
    queryFn: () => patientProfileService.getTab(patientId, tab),
    staleTime: 30_000,
    enabled: enabled && patientId !== '',
    retry: retryUnlessNotFound,
  });
}

/**
 * Records an allergy — **pessimistic**: an allergy that appears on the chart
 * before the server has it is one the prescription safety screen may not be
 * screening against yet. On success the whole `doctor-patients` family is
 * invalidated, not only this chart, because the directory the prescribing
 * flow picks its patient (and their allergies) from lives under the same key.
 */
export function useAddAllergyMutation(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation<AllergyRecord, Error, NewAllergyInput>({
    mutationFn: (input) => patientProfileService.addAllergy(patientId, input),
    // Returned, not fired and forgotten: the mutation stays pending until the
    // chart has refetched, so "recorded" is never announced over a table
    // that still reads "No known allergies".
    onSuccess: () => queryClient.invalidateQueries({ queryKey: patientKeys.all }),
  });
}

/**
 * Records vital signs — pessimistic, and settles only once the chart has
 * refetched, so "recorded" is never announced over the previous reading.
 */
export function useRecordVitalsMutation(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation<VitalSigns, Error, NewVitalsInput>({
    mutationFn: (input) => patientProfileService.recordVitals(patientId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: patientKeys.detail(patientId) }),
  });
}

/**
 * Raises a clinical alert — pessimistic, and settles only once the chart has
 * refetched, so the banner is on the Overview when "raised" is announced.
 */
export function useAddAlertMutation(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation<ClinicalAlert, Error, NewAlertInput>({
    mutationFn: (input) => patientProfileService.addAlert(patientId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: patientKeys.detail(patientId) }),
  });
}

/**
 * Adds a medical-history event — pessimistic. The chart's detail key covers
 * its tabs, so the History tab refetches with it.
 */
export function useAddHistoryEventMutation(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation<MedicalHistoryEvent, Error, NewHistoryEventInput>({
    mutationFn: (input) => patientProfileService.addHistoryEvent(patientId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: patientKeys.detail(patientId) }),
  });
}

/**
 * Chart notes (DEC-001) — all pessimistic, each settling once the chart (and
 * its Notes tab, under the same key) has refetched.
 */
export function useAddNoteMutation(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation<ClinicalNote, Error, { input: ChartNoteInput; author: NoteAuthor }>({
    mutationFn: ({ input, author }) => patientProfileService.addNote(patientId, input, author),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: patientKeys.detail(patientId) }),
  });
}

export function useUpdateNoteMutation(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation<
    ClinicalNote,
    Error,
    { noteId: string; input: ChartNoteInput; actor: NoteAuthor }
  >({
    mutationFn: ({ noteId, input, actor }) =>
      patientProfileService.updateNote(patientId, noteId, input, actor),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: patientKeys.detail(patientId) }),
  });
}

export function useSignChartNoteMutation(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation<ClinicalNote, Error, { noteId: string; actor: NoteAuthor }>({
    mutationFn: ({ noteId, actor }) => patientProfileService.signNote(patientId, noteId, actor),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: patientKeys.detail(patientId) }),
  });
}

/** What a retraction names and why (BR-DEC-003). */
interface Retraction {
  readonly id: string;
  readonly reason: string;
}

/** Removes an emergency contact — pessimistic; settles once the chart has refetched. */
export function useRemoveEmergencyContactMutation(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, Retraction>({
    mutationFn: ({ id, reason }) =>
      patientProfileService.removeEmergencyContact(patientId, id, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: patientKeys.detail(patientId) }),
  });
}

/** Resolves a clinical alert — pessimistic; the banner leaves only after the refetch. */
export function useResolveAlertMutation(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, Retraction>({
    mutationFn: ({ id, reason }) => patientProfileService.resolveAlert(patientId, id, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: patientKeys.detail(patientId) }),
  });
}

/**
 * Removes a history event with its mandatory reason — pessimistic; the event
 * leaves the timeline only once the History tab has refetched without it.
 */
export function useRemoveHistoryEventMutation(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation<void, Error, Retraction>({
    mutationFn: ({ id, reason }) => patientProfileService.removeHistoryEvent(patientId, id, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: patientKeys.detail(patientId) }),
  });
}

/**
 * Adds an emergency contact, or replaces one's details when `contactId` is
 * given. Pessimistic: settles once the chart has refetched, so a changed
 * primary shows on the summary card when the save is announced.
 */
export function useSaveEmergencyContactMutation(patientId: string) {
  const queryClient = useQueryClient();
  return useMutation<
    EmergencyContact,
    Error,
    { readonly contactId: string | null; readonly input: EmergencyContactInput }
  >({
    mutationFn: ({ contactId, input }) =>
      contactId === null
        ? patientProfileService.addEmergencyContact(patientId, input)
        : patientProfileService.updateEmergencyContact(patientId, contactId, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: patientKeys.detail(patientId) }),
  });
}
