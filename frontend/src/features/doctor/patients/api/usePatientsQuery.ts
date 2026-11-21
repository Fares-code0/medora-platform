import {
  usePatientDirectoryQuery,
  type PatientDirectoryQueryOptions,
} from '@/features/shared-domain/patient-identity';

/**
 * The patients list query — the doctor's caseload, read through the shared
 * patient directory (FE-10.2), which selects the mock or HTTP adapter.
 *
 * The list, the key factory and the create mutation moved to
 * `shared-domain/patient-identity` when the authoring flows' patient
 * pickers became consumers too; these names are kept so the feature's
 * callers are unchanged.
 */

export {
  patientKeys,
  useCreatePatientMutation,
  type NewPatientInput,
} from '@/features/shared-domain/patient-identity';

export function usePatientsQuery(options?: PatientDirectoryQueryOptions) {
  return usePatientDirectoryQuery(options);
}
