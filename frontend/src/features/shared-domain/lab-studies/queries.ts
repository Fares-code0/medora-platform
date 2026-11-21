import { useQuery } from '@tanstack/react-query';

import { createKeyFactory } from '@/api/query-keys';
import { selectService } from '@/api/seam';

import { fetchPatientLabStudies } from './http-patient-studies';
import { patientLabStudies, type PatientLabStudiesResult } from './patient-studies';

/**
 * The query layer the patient profile reads lab studies through (D-05).
 *
 * Its own key prefix, separate from the labs feature's `labKeys`, because the
 * two answer different questions and are filtered differently. They read one
 * store, so they cannot disagree about a value — but a review written on the
 * Labs screen still has to *invalidate* this prefix for the profile to see it,
 * which `useLabReviewMutations` does explicitly.
 */

export const labStudyKeys = createKeyFactory('lab-studies');

/**
 * Where the studies come from (FE-10.7): the session store the Labs screen
 * writes, or `GET /patients/{id}/labs`.
 */
const listPatientStudies = selectService<(patientId: string) => Promise<PatientLabStudiesResult>>({
  mock: (patientId) => Promise.resolve({ studies: patientLabStudies(patientId), truncated: false }),
  http: fetchPatientLabStudies,
});

export function usePatientLabStudiesQuery(patientId: string) {
  return useQuery<PatientLabStudiesResult>({
    queryKey: labStudyKeys.detail(patientId),
    queryFn: () => listPatientStudies(patientId),
    staleTime: 30_000,
    enabled: patientId !== '',
  });
}
