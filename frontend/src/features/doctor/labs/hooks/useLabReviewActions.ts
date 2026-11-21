import { useCallback, useState } from 'react';

import { useDoctorProfile, useToast } from '@/app/providers';
import {
  useAttachLabReportMutation,
  useLabAttachmentsQuery,
  type AttachableReport,
} from '@/features/shared-domain/record-attachments';

import { useAnnotateLabMutation } from '../api/useLabAnnotationMutation';
import {
  useBulkMarkReviewedMutation,
  useMarkReviewedMutation,
} from '../api/useLabReviewMutations';
import type { AnnotatableNote } from '../model/annotation';
import { refusalOf } from '../model/refusal';
import { criticalResults, type ReviewableTest } from '../model/review';
import type { LabTest } from '../model/types';

/**
 * The D-11 / D-13 / D-14 actions in one place, so the list row menu and the
 * result detail page cannot drift apart — the shape `usePrescriptionLifecycle`
 * established for the pharmacy's writes.
 *
 * **Failure keeps the dialog open, and says why.** Every one of these actions
 * is a claim about a clinical record, so none of them closes its dialog on
 * error and none of them shows a success toast the write did not earn. The
 * error message is handed back to the dialog rather than only toasted,
 * because a toast is gone in four seconds and the doctor is still looking at
 * the thing that did not happen.
 */
export function useLabReviewActions() {
  const { toast } = useToast();
  const { profile } = useDoctorProfile();
  const reviewer = profile.fullName || 'Doctor';

  const markReviewed = useMarkReviewedMutation();
  const bulkMarkReviewed = useBulkMarkReviewedMutation();
  const attachReport = useAttachLabReportMutation();
  const annotate = useAnnotateLabMutation();

  const [reviewing, setReviewing] = useState<LabTest | null>(null);
  const [bulkReviewing, setBulkReviewing] = useState<readonly LabTest[] | null>(null);
  const [attaching, setAttaching] = useState<LabTest | null>(null);
  const [annotating, setAnnotating] = useState<LabTest | null>(null);
  const [trending, setTrending] = useState<{
    readonly test: LabTest;
    readonly analyte: string | null;
  } | null>(null);

  const [reviewError, setReviewError] = useState<string | null>(null);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [annotateError, setAnnotateError] = useState<string | null>(null);

  /* Already on this result, so the dialog can refuse a duplicate. */
  const existingAttachments = useLabAttachmentsQuery(attaching?.id ?? '');

  const openReview = useCallback((test: LabTest) => {
    setReviewError(null);
    setReviewing(test);
  }, []);

  const openBulkReview = useCallback((tests: readonly LabTest[]) => {
    setBulkError(null);
    setBulkReviewing(tests);
  }, []);

  const openAttach = useCallback((test: LabTest) => {
    setAttachError(null);
    setAttaching(test);
  }, []);

  const openTrend = useCallback((test: LabTest, analyte: string | null) => {
    setTrending({ test, analyte });
  }, []);

  const confirmReview = useCallback(
    (reviewable: ReviewableTest) => {
      const test = reviewing;
      if (test === null) return;
      markReviewed.mutate(reviewable, {
        onSuccess: (updated) => {
          // What was sent — the server records it but does not echo it back.
          const acknowledged = reviewable.acknowledgment.acknowledgedCriticalIds.length;
          toast({
            variant: 'success',
            title: `${updated.id} marked reviewed`,
            description:
              acknowledged > 0
                ? `${String(acknowledged)} critical value${acknowledged === 1 ? '' : 's'} acknowledged and recorded against ${reviewer}.`
                : `Recorded against ${reviewer} and taken out of the Inbox.`,
          });
          setReviewing(null);
          setReviewError(null);
        },
        onError: (error) => {
          setReviewError(refusalOf(error));
          toast({
            variant: 'error',
            title: 'Could not mark the result reviewed',
            description: `${test.id} is unchanged and still awaiting review.`,
          });
        },
      });
    },
    [markReviewed, reviewing, reviewer, toast],
  );

  const confirmBulkReview = useCallback(
    (reviewables: readonly ReviewableTest[]) => {
      bulkMarkReviewed.mutate(reviewables, {
        onSuccess: (updated) => {
          toast({
            variant: 'success',
            title: `${String(updated.length)} result${updated.length === 1 ? '' : 's'} marked reviewed`,
            description: `Recorded against ${reviewer}. Anything abnormal was left for you to open.`,
          });
          setBulkReviewing(null);
          setBulkError(null);
        },
        onError: (error) => {
          setBulkError(refusalOf(error));
          toast({
            variant: 'error',
            title: 'Nothing was marked reviewed',
            description: 'Every selected result is unchanged.',
          });
        },
      });
    },
    [bulkMarkReviewed, reviewer, toast],
  );

  const confirmAttach = useCallback(
    (attachable: AttachableReport) => {
      attachReport.mutate(attachable, {
        onSuccess: (attachment) => {
          toast({
            variant: 'success',
            title: 'Report attached to the record',
            description: `${attachment.testName} is now on ${attachment.patientName}'s record. It is visible on the record's Attachments section.`,
          });
          setAttaching(null);
          setAttachError(null);
        },
        onError: (error) => {
          setAttachError(refusalOf(error));
          toast({
            variant: 'error',
            title: 'Could not attach the report',
            description: 'The record is unchanged.',
          });
        },
      });
    },
    [attachReport, toast],
  );

  /**
   * Whether a row can offer "Mark reviewed" at all. The dialog re-checks —
   * this only decides whether the menu entry is worth rendering, and a menu
   * entry that opens a dialog which immediately refuses is worse than no
   * entry.
   */
  const canReview = useCallback(
    (test: LabTest) => test.results.length > 0 && test.review === null,
    [],
  );

  const openAnnotate = useCallback((test: LabTest) => {
    setAnnotateError(null);
    setAnnotating(test);
  }, []);

  const confirmAnnotate = useCallback(
    (note: AnnotatableNote) => {
      setAnnotateError(null);
      annotate.mutate(note, {
        onSuccess: () => {
          setAnnotating(null);
          toast({ variant: 'success', title: 'Note added to this result' });
        },
        // Kept on screen beside the note the doctor just wrote, so it is not
        // lost to a toast that vanishes while they are still reading it.
        onError: (error) => setAnnotateError(refusalOf(error)),
      });
    },
    [annotate, toast],
  );

  const canAttach = useCallback((test: LabTest) => test.results.length > 0, []);

  const canTrend = useCallback(
    (test: LabTest) => test.results.some((result) => result.numericValue !== null),
    [],
  );

  return {
    reviewer,
    /* Which dialog is open, and for what. */
    reviewing,
    bulkReviewing,
    attaching,
    annotating,
    trending,
    existingAttachments: existingAttachments.data ?? [],
    /* Whether a write is in flight. */
    reviewSubmitting: markReviewed.isPending,
    bulkSubmitting: bulkMarkReviewed.isPending,
    attachSubmitting: attachReport.isPending,
    annotateSubmitting: annotate.isPending,
    /* The last failure, kept on screen beside the thing that failed. */
    reviewError,
    bulkError,
    attachError,
    annotateError,
    /* Openers. */
    openReview,
    openBulkReview,
    openAttach,
    openAnnotate,
    openTrend,
    /* Closers. A write in flight cannot be dismissed out from under itself. */
    closeReview: useCallback(() => {
      if (!markReviewed.isPending) setReviewing(null);
    }, [markReviewed.isPending]),
    closeBulkReview: useCallback(() => {
      if (!bulkMarkReviewed.isPending) setBulkReviewing(null);
    }, [bulkMarkReviewed.isPending]),
    closeAttach: useCallback(() => {
      if (!attachReport.isPending) setAttaching(null);
    }, [attachReport.isPending]),
    closeAnnotate: useCallback(() => {
      if (!annotate.isPending) setAnnotating(null);
    }, [annotate.isPending]),
    closeTrend: useCallback(() => setTrending(null), []),
    /* Confirmations. */
    confirmReview,
    confirmBulkReview,
    confirmAttach,
    confirmAnnotate,
    /* Row-level affordances. */
    canReview,
    canAttach,
    canTrend,
    criticalCount: useCallback((test: LabTest) => criticalResults(test).length, []),
  } as const;
}
