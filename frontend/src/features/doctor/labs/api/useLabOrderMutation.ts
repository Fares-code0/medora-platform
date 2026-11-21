import { useMutation, useQueryClient } from '@tanstack/react-query';

import { labStudyKeys } from '@/features/shared-domain/lab-studies';

import type { OrderableLabRequest } from '../model/ordering';
import type { LabTest } from '../model/types';
import { labService } from '../service';

import { labKeys } from './useLabTestsQuery';

/**
 * Placing an order (DX-23).
 *
 * Pessimistic, like every other write in this module. An order that appears
 * in the worklist before the write lands tells a doctor the lab has been
 * asked for something it has not.
 *
 * Invalidates the shared `labStudyKeys` as well, so the new order shows on
 * the patient's profile tab without a reload — the D-05 store means both
 * screens read it, but only an invalidation makes them look again.
 */
export function useOrderLabsMutation() {
  const queryClient = useQueryClient();

  return useMutation<readonly LabTest[], Error, OrderableLabRequest>({
    mutationFn: (request) => labService.orderLabs(request),
    onSuccess: (created) => {
      for (const test of created) queryClient.setQueryData(labKeys.detail(test.id), test);
      void queryClient.invalidateQueries({ queryKey: labKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: labStudyKeys.all });
    },
  });
}
