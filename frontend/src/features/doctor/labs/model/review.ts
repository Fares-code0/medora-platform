import type { StatusKind } from '@/components/patterns';

import { isCriticalFlag, type LabResultItem, type LabReview, type LabTest } from './types';

/**
 * The review loop (D-10 … D-12, UX §2.6) — and the one correctness property
 * it exists to guarantee: **a critical result cannot be marked reviewed by
 * accident.**
 *
 * UX §2.6 states the rule in one line — "Review (mark reviewed — required for
 * critical results; bulk allowed only for Normal)" — and the tempting
 * implementation is a disabled bulk button plus a confirm dialog. Both are
 * cosmetic: a disabled button is one refactor away from enabled, and a
 * dialog is a thing you dismiss with Enter.
 *
 * So this module borrows the pharmacy's shape (`pharmacy/model/safety-check.ts`).
 * `assessReviewability` is the only producer of `ReviewableTest`, that type
 * carries a module-private symbol, and the mark-reviewed mutation demands
 * one. A critical analyte with no acknowledgment, an acknowledgment with no
 * reason, an order with nothing released, and a test already reviewed all
 * reach the same place: there is no value to hand to the service, and no way
 * to forge one — not in TypeScript, because the symbol cannot be named
 * outside this module, and not at runtime, because `assertReviewable`
 * compares against it.
 *
 * The bulk path is the same rule from the other side: `partitionForBulkReview`
 * hands back the tests that may go through in one action and, separately, the
 * ones that may not *and why*. It never silently drops the refused ones —
 * a bulk review that quietly skips the critical results is worse than one
 * that refuses them, because the doctor believes their queue is clear.
 */

/* ── State ──────────────────────────────────────────────────────── */

/**
 * `not-required` is not "reviewed": an order still in the lab has produced
 * nothing to review. Keeping it as its own state is what lets the Inbox
 * count mean "results waiting on you" rather than "rows that are not green".
 */
export type LabReviewState = 'not-required' | 'unreviewed' | 'reviewed';

export const LAB_REVIEW_META: Record<
  LabReviewState,
  { readonly label: string; readonly kind: StatusKind | null }
> = {
  /*
   * Only the state that needs a doctor gets a badge. A column of green
   * "Reviewed" pills is the thing a reader has to look past to find the row
   * that matters, and `reviewed` renders as its own attribution line instead
   * ("Reviewed by … · date"), which carries more and shouts less.
   */
  'not-required': { label: 'No result yet', kind: null },
  unreviewed: { label: 'Awaiting review', kind: 'awaiting' },
  reviewed: { label: 'Reviewed', kind: null },
};

/**
 * Released results exist to be reviewed at all.
 *
 * Released means the order is completed. The laboratory enters values while
 * an order is processing and releases them by completing it (API §8.6; the
 * server's `assertResultable`), so a processing order can already carry
 * values that are still provisional. Counting those as released put them in
 * the review queue and under "Flagged to the ordering team", although the
 * release notification fires only on completion. Both sides document the
 * rule this way ("an order still in the analyser is in nobody's inbox");
 * the server's own check still counts rows, which is recorded as a backend
 * finding in FRONTEND_CHECKLIST §30.
 */
export function hasReleasedResults(test: LabTest): boolean {
  return test.status === 'completed' && test.results.length > 0;
}

/** Values entered on an order the laboratory has not released yet. */
export function hasPreliminaryResults(test: LabTest): boolean {
  return test.status !== 'completed' && test.results.length > 0;
}

export function reviewState(test: LabTest): LabReviewState {
  if (!hasReleasedResults(test)) return 'not-required';
  return test.review === null ? 'unreviewed' : 'reviewed';
}

export function isUnreviewed(test: LabTest): boolean {
  return reviewState(test) === 'unreviewed';
}

/** The analytes that make review mandatory rather than merely expected. */
export function criticalResults(test: LabTest): readonly LabResultItem[] {
  return test.results.filter((result) => isCriticalFlag(result.flag));
}

export function isCriticalUnreviewed(test: LabTest): boolean {
  return isUnreviewed(test) && criticalResults(test).length > 0;
}

/** D-12: the pinned "Critical unreviewed: N" figure. */
export function criticalUnreviewedCount(tests: readonly LabTest[]): number {
  return tests.filter(isCriticalUnreviewed).length;
}

/**
 * D-10: the Inbox is "results needing review", not "everything completed".
 * An order the lab has not resulted yet is not in anyone's inbox.
 */
export function inboxTests(tests: readonly LabTest[]): readonly LabTest[] {
  return tests.filter(isUnreviewed);
}

/**
 * UX §2.6: "Critical rows tint error-subtle and always sort to top of the
 * Inbox." Critical first, then anything else abnormal, then oldest result
 * first inside each band — the result that has been waiting longest is the
 * one most likely to have been forgotten.
 */
export function sortInbox(tests: readonly LabTest[]): readonly LabTest[] {
  const band = (test: LabTest): number => {
    if (criticalResults(test).length > 0) return 0;
    return test.results.some((result) => result.flag !== 'normal') ? 1 : 2;
  };
  const waitingSince = (test: LabTest): string =>
    test.completedDate ?? test.collectedDate ?? test.requestedDate;

  return [...tests].sort(
    (a, b) => band(a) - band(b) || waitingSince(a).localeCompare(waitingSince(b)),
  );
}

/* ── Reviewability — the unforgeable part ───────────────────────── */

const REVIEWABLE: unique symbol = Symbol('medora.labs.reviewable');

export interface ReviewAcknowledgment {
  /** Every critical result id on the test. Fewer is refused, not truncated. */
  readonly acknowledgedCriticalIds: readonly string[];
  /** Required when a critical analyte is acknowledged. */
  readonly note: string;
}

export interface ReviewableTest {
  readonly [REVIEWABLE]: true;
  readonly labId: string;
  readonly reviewedBy: string;
  readonly acknowledgment: ReviewAcknowledgment;
}

export type ReviewBlockedReason =
  | 'no-results'
  | 'already-reviewed'
  | 'unacknowledged-critical'
  | 'missing-note'
  | 'no-reviewer';

export const REVIEW_BLOCKED_META: Record<ReviewBlockedReason, string> = {
  'no-results': 'This order has no released results, so there is nothing to review.',
  'already-reviewed': 'This result has already been marked reviewed.',
  'unacknowledged-critical': 'Acknowledge every critical value before marking this reviewed.',
  'missing-note': 'A critical value needs a short note saying what was done about it.',
  'no-reviewer': 'The reviewing clinician is unknown.',
};

export interface ReviewabilityInput {
  readonly test: LabTest;
  readonly reviewedBy: string;
  /** Critical result ids the doctor positively ticked. */
  readonly acknowledgedCriticalIds: readonly string[];
  readonly note: string;
}

export type ReviewabilityResult =
  | { readonly reviewable: ReviewableTest; readonly blockedBy: null }
  | { readonly reviewable: null; readonly blockedBy: ReviewBlockedReason };

/**
 * The only producer of `ReviewableTest`. Every path that is not a released,
 * unreviewed result with every critical analyte acknowledged returns null —
 * and null is not something the mutation accepts.
 */
export function assessReviewability(input: ReviewabilityInput): ReviewabilityResult {
  const { test, reviewedBy, acknowledgedCriticalIds, note } = input;

  if (!hasReleasedResults(test)) return { reviewable: null, blockedBy: 'no-results' };
  if (test.review !== null) return { reviewable: null, blockedBy: 'already-reviewed' };
  if (reviewedBy.trim() === '') return { reviewable: null, blockedBy: 'no-reviewer' };

  const critical = criticalResults(test);
  if (critical.length > 0) {
    const everyOneTicked = critical.every((result) =>
      acknowledgedCriticalIds.includes(result.id),
    );
    if (!everyOneTicked) return { reviewable: null, blockedBy: 'unacknowledged-critical' };
    if (note.trim() === '') return { reviewable: null, blockedBy: 'missing-note' };
  }

  return {
    reviewable: {
      [REVIEWABLE]: true,
      labId: test.id,
      reviewedBy,
      acknowledgment: {
        // Normalised to the test's own critical ids, so an acknowledgment can
        // never record a tick against something that is not on this result.
        acknowledgedCriticalIds: critical.map((result) => result.id),
        note: note.trim(),
      },
    },
    blockedBy: null,
  };
}

export class NotReviewableError extends Error {
  constructor() {
    super('Refusing to mark reviewed: the value did not come from a completed review check.');
    this.name = 'NotReviewableError';
  }
}

/** The runtime half of the guarantee — a cast does not survive this. */
export function assertReviewable(value: ReviewableTest): void {
  const candidate = value as unknown as Record<symbol, unknown> | null;
  if (typeof candidate !== 'object' || candidate === null || candidate[REVIEWABLE] !== true) {
    throw new NotReviewableError();
  }
}

/** Builds the stored review from a value only this module can have made. */
export function toStoredReview(reviewable: ReviewableTest, now: Date): LabReview {
  assertReviewable(reviewable);
  return {
    reviewedAt: now.toISOString(),
    reviewedBy: reviewable.reviewedBy,
    acknowledgedCriticalIds: reviewable.acknowledgment.acknowledgedCriticalIds,
    note: reviewable.acknowledgment.note,
  };
}

/* ── Bulk review ────────────────────────────────────────────────── */

export type BulkRefusalReason =
  | 'not-normal'
  | 'already-reviewed'
  | 'no-results';

export const BULK_REFUSAL_META: Record<BulkRefusalReason, string> = {
  'not-normal': 'Has values outside the reference range — review it on its own.',
  'already-reviewed': 'Already reviewed.',
  'no-results': 'No released results yet.',
};

export interface BulkRefusal {
  readonly test: LabTest;
  readonly reason: BulkRefusalReason;
}

export interface BulkReviewPartition {
  readonly eligible: readonly LabTest[];
  readonly refused: readonly BulkRefusal[];
}

/**
 * UX §2.6: "bulk allowed only for Normal". Anything abnormal — not merely
 * critical — is refused, because the point of the restriction is that a
 * result a doctor should have *looked at* never gets cleared by a checkbox
 * in a header row.
 */
export function partitionForBulkReview(tests: readonly LabTest[]): BulkReviewPartition {
  const eligible: LabTest[] = [];
  const refused: BulkRefusal[] = [];

  for (const test of tests) {
    if (!hasReleasedResults(test)) {
      refused.push({ test, reason: 'no-results' });
    } else if (test.review !== null) {
      refused.push({ test, reason: 'already-reviewed' });
    } else if (test.results.some((result) => result.flag !== 'normal')) {
      refused.push({ test, reason: 'not-normal' });
    } else {
      eligible.push(test);
    }
  }

  return { eligible, refused };
}
