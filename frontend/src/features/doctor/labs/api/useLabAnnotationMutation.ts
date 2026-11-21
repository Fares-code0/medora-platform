import { useMutation, useQueryClient } from '@tanstack/react-query';

import { labStudyKeys } from '@/features/shared-domain/lab-studies';

import type { AnnotatableNote } from '../model/annotation';
import type { LabTest } from '../model/types';
import { labService } from '../service';

import { labKeys } from './useLabTestsQuery';

/**
 * Appending a clinician's note to a result (D-15).
 *
 * Pessimistic, like the review beside it, and for a weaker but real reason:
 * an annotation that appears before the write lands is a doctor believing a
 * colleague can see their note. The cost of waiting is one spinner; the cost
 * of being wrong is a note nobody reads.
 *
 * Invalidates the shared `labStudyKeys` too, so the patient profile's Lab
 * results tab counts the same record the Labs screen does.
 */
export function useAnnotateLabMutation() {
  const queryClient = useQueryClient();

  return useMutation<LabTest, Error, AnnotatableNote>({
    mutationFn: (note) => labService.annotate(note),
    onSuccess: (updated) => {
      queryClient.setQueryData(labKeys.detail(updated.id), updated);
      void queryClient.invalidateQueries({ queryKey: labKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: labStudyKeys.all });
    },
  });
}
