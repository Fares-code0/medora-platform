import { useQuery } from '@tanstack/react-query';

import { createKeyFactory } from '@/api/query-keys';
import { isApiError } from '@/types/api';

import type { PrescriptionDraft } from '../model/authoring';
import type { Formulary, MedicationMonograph } from '../model/catalogue';
import { PRESCRIPTION_NOT_FOUND, type MedicationOnRecord } from '../model/prescription-service';
import type { Prescription, PrescriptionSummary } from '../model/types';
import { prescriptionService } from '../service';

/**
 * Pharmacy reads — TanStack Query over the pharmacy port (`service.ts`),
 * not over the mock module. Until D-17 the fetchers reached into
 * `MOCK_PRESCRIPTIONS` directly, which was fine while the module was
 * read-only and wrong the moment it grew a write path: the list has to see
 * what signing and cancelling did, and it can only do that if both sides
 * talk to the same adapter.
 */

export const prescriptionKeys = createKeyFactory('doctor-pharmacy');

/** Drafts are a sibling collection, not a prescription list. */
export const prescriptionDraftKeys = createKeyFactory('doctor-pharmacy-drafts');

export { PRESCRIPTION_NOT_FOUND };

/**
 * `enabled` exists for the global search index (D-26), which spans five
 * feature datasets and must not fetch any of them until someone actually
 * uses the field. Defaults to true, so every existing caller is unchanged.
 */
export function usePrescriptionsQuery(options?: { readonly enabled?: boolean }) {
  return useQuery<readonly PrescriptionSummary[]>({
    queryKey: prescriptionKeys.lists(),
    queryFn: () => prescriptionService.listPrescriptions(),
    staleTime: 30_000,
    enabled: options?.enabled ?? true,
  });
}

export function usePrescriptionQuery(prescriptionId: string) {
  return useQuery<Prescription>({
    queryKey: prescriptionKeys.detail(prescriptionId),
    queryFn: () => prescriptionService.getPrescription(prescriptionId),
    staleTime: 30_000,
    // The global rule first (configs/query-client.ts): only a network failure
    // is retried, so a 403 or 500 is not re-sent twice behind a spinner.
    retry: (failureCount, error) => {
      if (isApiError(error) && error.kind !== 'network') return false;
      return error.message === PRESCRIPTION_NOT_FOUND ? false : failureCount < 2;
    },
  });
}

/** The formulary a prescription may be written from (API §7.1). */
export function useFormularyQuery() {
  return useQuery<Formulary>({
    queryKey: [...prescriptionKeys.all, 'formulary'] as const,
    queryFn: () => prescriptionService.listMedications(),
    staleTime: 5 * 60_000,
  });
}

/**
 * D-18's typeahead: the server's matches for a search, from the second
 * character on. Keyed by the trimmed query, so retyping a term reads the cache.
 */
export function useMedicationSearchQuery(query: string) {
  const term = query.trim();
  return useQuery<Formulary>({
    queryKey: [...prescriptionKeys.all, 'formulary-search', term.toLowerCase()] as const,
    queryFn: () => prescriptionService.searchMedications(term),
    enabled: term.length >= MEDICATION_SEARCH_MIN_LENGTH,
    staleTime: 5 * 60_000,
  });
}

/** One character matches most of a formulary; the search starts at two. */
export const MEDICATION_SEARCH_MIN_LENGTH = 2;

/**
 * One formulary entry's monograph (API §7.2), fetched only once someone asks
 * for it — the drawer is opened per medication, not preloaded for the list.
 * `null` data means the formulary holds none for that entry.
 */
export function useMonographQuery(medicationId: string | null) {
  return useQuery<MedicationMonograph | null>({
    queryKey: [...prescriptionKeys.all, 'monograph', medicationId] as const,
    queryFn: () => prescriptionService.getMonograph(medicationId ?? ''),
    enabled: medicationId !== null,
    staleTime: 30 * 60_000,
  });
}

/**
 * The patient's current medications from every source on their record — what
 * the prescribing strip shows. Not derived from `usePrescriptionsQuery`,
 * which live is only the caller's own prescriptions (API §7.3).
 */
export function useCurrentMedicationsQuery(patientId: string | null) {
  return useQuery<readonly MedicationOnRecord[]>({
    queryKey: [...prescriptionKeys.all, 'current-medications', patientId] as const,
    queryFn: () => prescriptionService.listCurrentMedications(patientId ?? ''),
    enabled: patientId !== null,
    staleTime: 30_000,
  });
}

/** Saved drafts (D-19). They survive navigation for the session. */
export function usePrescriptionDraftsQuery() {
  return useQuery<readonly PrescriptionDraft[]>({
    queryKey: prescriptionDraftKeys.lists(),
    queryFn: () => prescriptionService.listDrafts(),
    staleTime: 0,
  });
}
