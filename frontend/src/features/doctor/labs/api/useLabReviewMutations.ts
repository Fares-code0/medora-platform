import { useMutation, useQueryClient } from '@tanstack/react-query';

import { labStudyKeys } from '@/features/shared-domain/lab-studies';

import type { ReviewableTest } from '../model/review';
import type { LabTest } from '../model/types';
import { labService } from '../service';

import { labKeys } from './useLabTestsQuery';

/**
 * The review writes (D-11) — the labs module's first mutations.
 *
 * **Both are pessimistic, and that is the whole point.** DP-05 asks for
 * optimistic updates with rollback, and the pharmacy module takes it where it
 * belongs (cancelling a prescription) while refusing it where it does not
 * (signing one). Marking a result reviewed sits on the refusing side, and
 * UX §2.6 says so directly: "a failed 'mark reviewed' rolls back with error
 * toast (a critical result must never *appear* reviewed when the write
 * failed)."
 *
 * Rollback is the weaker guarantee. It restores the row *after* the failure
 * is known — and in the window before that, the Inbox has already dropped the
 * row, the "Critical unreviewed" chip has already counted down, and a doctor
 * scanning for what is left to do has already been told, wrongly, that this
 * one is handled. So nothing is written to the cache until the service
 * answers, and the only invalidation happens on success.
 *
 * The input type is `ReviewableTest`, whose only producer is
 * `assessReviewability`, so neither mutation is reachable without every
 * critical value acknowledged and explained.
 *
 * **Both also invalidate `labStudyKeys` (D-05).** The patient profile lists
 * the same orders through that prefix, off the same store; invalidating only
 * this feature's keys would leave a result reading "Awaiting review" on the
 * patient's profile after the doctor had just reviewed it here.
 */

export function useMarkReviewedMutation() {
  const queryClient = useQueryClient();

  return useMutation<LabTest, Error, ReviewableTest>({
    mutationFn: (reviewable) => labService.markReviewed(reviewable),
    onSuccess: (updated) => {
      // Seed the detail cache with the server's own answer, then invalidate
      // the list so the Inbox, the tab counts and the critical chip all
      // recount from one source rather than each adjusting itself.
      queryClient.setQueryData(labKeys.detail(updated.id), updated);
    },
    // On failure too: a 409 means a colleague reviewed it first, so what the
    // list shows is already out of date, and leaving it there invites a
    // second attempt at a review that has happened.
    onError: (_error, reviewable) => {
      void queryClient.invalidateQueries({ queryKey: labKeys.detail(reviewable.labId) });
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: labKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: labStudyKeys.all });
    },
  });
}

/** The bulk path — one mutation, one write, one invalidation (UX §2.6). */
export function useBulkMarkReviewedMutation() {
  const queryClient = useQueryClient();

  return useMutation<readonly LabTest[], Error, readonly ReviewableTest[]>({
    mutationFn: (reviewables) => labService.markManyReviewed(reviewables),
    onSuccess: (updated) => {
      for (const test of updated) queryClient.setQueryData(labKeys.detail(test.id), test);
    },
    // On failure too. The server's bulk 409 ("N of these were reviewed by
    // someone else") is sent after its transaction committed the rest, so
    // the list holds reviews it no longer shows unless it is re-read.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: labKeys.lists() });
      void queryClient.invalidateQueries({ queryKey: labStudyKeys.all });
    },
  });
}
