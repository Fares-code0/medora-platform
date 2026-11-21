import { useMutation, useQueryClient } from '@tanstack/react-query';

import { createKeyFactory } from '@/api/query-keys';

import { dataErrorReportService } from './service';
import type { FileDataErrorInput } from './store';
import type { DataErrorReport } from './types';

/**
 * The write path both features share. One key prefix, one invalidation, so
 * the doctor's report and the administrator's queue count cannot disagree
 * about what is outstanding.
 *
 * Pessimistic, like `useAttachLabReportMutation` and for the same reason: a
 * profile that says "reported" before the write lands is a doctor believing
 * an administrator has been told something they have not.
 */

export const dataErrorReportKeys = createKeyFactory('data-error-reports');

export function useFileDataErrorReportMutation() {
  const queryClient = useQueryClient();

  return useMutation<DataErrorReport, Error, FileDataErrorInput>({
    mutationFn: (input) => dataErrorReportService.file(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: dataErrorReportKeys.all });
      // The administrator's account document folds these into each account's
      // open work, so it has to be re-read or the ADM-01 queue keeps
      // yesterday's number. The prefix is named as a literal rather than
      // imported: `shared-domain` may not import a feature (§3.3), and
      // reaching into `admin/patients/api` for its key factory is exactly the
      // coupling this layer exists to prevent.
      void queryClient.invalidateQueries({ queryKey: ['admin', 'patients'] });
    },
  });
}
