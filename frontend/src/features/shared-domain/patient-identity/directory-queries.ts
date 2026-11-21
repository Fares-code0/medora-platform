import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createKeyFactory } from '@/api/query-keys';
import { selectService } from '@/api/seam';

import type { NewPatientInput, PatientDirectoryService } from './directory';
import { httpPatientDirectory } from './http-directory';
import { mockPatientDirectory } from './mock-directory';

/**
 * The patient directory's selection point and query layer (FE-10.2).
 *
 * The key prefix stays `doctor-patients`, which the patients feature has
 * always used, so every existing invalidation keeps reaching it.
 */

export const patientDirectory: PatientDirectoryService = selectService({
  mock: mockPatientDirectory,
  http: httpPatientDirectory,
});

export const patientKeys = createKeyFactory('doctor-patients');

export interface PatientDirectoryQueryOptions {
  /**
   * The global search index (D-26) spans several datasets and must not
   * fetch any until the field is used. Defaults to true.
   */
  readonly enabled?: boolean;
  /** Filters by chronic condition on the service — see `PatientListQuery`. */
  readonly condition?: string | null;
}

export function usePatientDirectoryQuery(options?: PatientDirectoryQueryOptions) {
  const condition = options?.condition ?? null;
  return useQuery({
    queryKey: patientKeys.list({ condition }),
    queryFn: () => patientDirectory.listPatients({ condition }),
    staleTime: 30_000,
    enabled: options?.enabled ?? true,
  });
}

export function useCreatePatientMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ input, doctor }: { input: NewPatientInput; doctor: string }) =>
      patientDirectory.createPatient(input, doctor),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: patientKeys.all });
    },
  });
}
