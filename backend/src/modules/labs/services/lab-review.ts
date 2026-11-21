/**
 * The review discipline (RM M14.5 — API §8.7, UX §2.6).
 *
 * > "Mark reviewed. **Critical results: individual review only**
 * > (`bulk:false`); bulk allowed only when all flags normal; write
 * > failure must surface (no optimistic success)."
 *
 * The property this module exists to guarantee is one sentence:
 * **a critical result cannot be marked reviewed by accident.**
 *
 * The tempting implementation is a `if (bulk && hasCritical) throw`
 * somewhere in the service. That is one refactor away from being
 * reordered below the write. So this borrows the shape
 * `safety-screen.ts` established on the pharmacy side and
 * `features/doctor/labs/model/review.ts` established on the frontend:
 * `assessReviewability` is the **only** producer of `ReviewableOrder`,
 * that type carries a module-private symbol, and the service's write
 * demands one. A critical analyte with no acknowledgment, an
 * acknowledgment with no note, an order with nothing released, an order
 * already reviewed, and every bulk request that reaches a non-normal row
 * all arrive at the same place: there is no value to hand to the
 * repository, and none can be forged — not in TypeScript, because the
 * symbol cannot be named outside this module, and not at runtime,
 * because `assertReviewable` compares against it.
 *
 * ## Bulk is the same rule from the other side
 *
 * `partitionForBulkReview` hands back the orders that may go through in
 * one action and, **separately, the ones that may not and why**. It
 * never silently drops the refused ones: a bulk review that quietly
 * skips the critical results is worse than one that refuses them,
 * because the doctor believes their queue is clear. RM M14.5's verify
 * step asks for a 422 on a bulk request containing a critical row, and
 * the refusal names every row it refused.
 *
 * **"Bulk allowed only for Normal" means normal, not non-critical.** A
 * merely `high` potassium is refused from the bulk path too. The point
 * of the restriction is that a result a doctor should have *looked at*
 * never gets cleared by a checkbox in a header row, and `high` is a
 * result to look at. The frontend's `partitionForBulkReview` reads
 * `results.some((r) => r.flag !== 'normal')` — the same test, and this
 * is the transcription.
 */

import type { LabResultFlag } from '../../../generated/prisma/enums';

import { isAbnormalFlag, isCriticalFlag } from './result-grading';

/* ── State ──────────────────────────────────────────────────────── */

/**
 * `not-required` is not "reviewed": an order still in the lab has
 * produced nothing to review. Keeping it as its own state is what lets
 * the §8.10 summary's count mean "results waiting on you" rather than
 * "rows that are not green". Transcribed from `LabReviewState`.
 */
export type LabReviewState = 'not-required' | 'unreviewed' | 'reviewed';

/** The minimum an order must expose to be assessed. */
export interface ReviewCandidate {
  /** `LAB-…`, so a refusal can name the row it refused. */
  readonly reference: string;
  readonly reviewedAt: Date | null;
  readonly results: readonly { readonly id: string; readonly flag: LabResultFlag }[];
}

export function reviewStateOf(order: ReviewCandidate): LabReviewState {
  if (order.results.length === 0) return 'not-required';

  return order.reviewedAt === null ? 'unreviewed' : 'reviewed';
}

export function criticalResultsOf(
  order: ReviewCandidate,
): readonly { readonly id: string; readonly flag: LabResultFlag }[] {
  return order.results.filter((result) => isCriticalFlag(result.flag));
}

/** Unreviewed **and** carrying a critical value — the §8.10 chip's predicate. */
export function isCriticalUnreviewed(order: ReviewCandidate): boolean {
  return reviewStateOf(order) === 'unreviewed' && criticalResultsOf(order).length > 0;
}

/* ── Reviewability — the unforgeable part ───────────────────────── */

const REVIEWABLE: unique symbol = Symbol('medora.labs.reviewable');

export interface ReviewAcknowledgment {
  /**
   * Every critical result id on the order. Fewer is refused, not
   * truncated: acknowledging two of three critical values and having the
   * third cleared anyway is the accident this guards against.
   */
  readonly acknowledgedResultIds: readonly string[];
  /** Required when a critical value is acknowledged; `''` otherwise. */
  readonly note: string;
}

export interface ReviewableOrder {
  readonly [REVIEWABLE]: true;
  readonly reference: string;
  readonly acknowledgment: ReviewAcknowledgment;
  /** True when the order carried a critical value at assessment time. */
  readonly hadCritical: boolean;
}

export type ReviewBlockedReason =
  | 'no-results'
  | 'already-reviewed'
  | 'unacknowledged-critical'
  | 'missing-note'
  | 'bulk-not-normal';

/**
 * Wording a client can show verbatim. Transcribed from the frontend's
 * `REVIEW_BLOCKED_META` and `BULK_REFUSAL_META`, with the bulk reason
 * added because the server refuses the whole request where the client
 * only greys a row.
 */
export const REVIEW_BLOCKED_META: Record<ReviewBlockedReason, string> = {
  'no-results': 'This order has no released results, so there is nothing to review.',
  'already-reviewed': 'This result has already been marked reviewed.',
  'unacknowledged-critical': 'Acknowledge every critical value before marking this reviewed.',
  'missing-note': 'A critical value needs a short note saying what was done about it.',
  'bulk-not-normal':
    'Has values outside the reference range — review it on its own, not in a bulk action.',
};

export interface ReviewabilityInput {
  readonly order: ReviewCandidate;
  /** Critical result ids the reviewer positively ticked. */
  readonly acknowledgedResultIds: readonly string[];
  readonly note: string;
  /**
   * Whether this assessment is part of a bulk action.
   *
   * `bulk: true` narrows the rule rather than relaxing it — see
   * `bulk-not-normal`. It is a parameter rather than a separate function
   * so that both paths produce the *same* `ReviewableOrder` through the
   * *same* producer; two producers is how the bulk one ends up missing a
   * check the individual one has.
   */
  readonly bulk: boolean;
}

export type ReviewabilityResult =
  | { readonly reviewable: ReviewableOrder; readonly blockedBy: null }
  | { readonly reviewable: null; readonly blockedBy: ReviewBlockedReason };

/**
 * The only producer of `ReviewableOrder`.
 *
 * Every path that is not a released, unreviewed order with every
 * critical value acknowledged and explained returns null — and null is
 * not something the write accepts.
 */
export function assessReviewability(input: ReviewabilityInput): ReviewabilityResult {
  const { order, acknowledgedResultIds, note, bulk } = input;

  if (order.results.length === 0) return { reviewable: null, blockedBy: 'no-results' };
  if (order.reviewedAt !== null) return { reviewable: null, blockedBy: 'already-reviewed' };

  const critical = criticalResultsOf(order);

  if (bulk) {
    // "Bulk allowed only for Normal" — anything abnormal, not merely
    // critical. Checked before the acknowledgment branch so a bulk
    // request carrying acknowledgments cannot buy its way past it.
    if (order.results.some((result) => isAbnormalFlag(result.flag))) {
      return { reviewable: null, blockedBy: 'bulk-not-normal' };
    }

    return {
      reviewable: {
        [REVIEWABLE]: true,
        reference: order.reference,
        acknowledgment: { acknowledgedResultIds: [], note: '' },
        hadCritical: false,
      },
      blockedBy: null,
    };
  }

  if (critical.length > 0) {
    const everyOneTicked = critical.every((result) =>
      acknowledgedResultIds.includes(result.id),
    );
    if (!everyOneTicked) return { reviewable: null, blockedBy: 'unacknowledged-critical' };
    if (note.trim() === '') return { reviewable: null, blockedBy: 'missing-note' };
  }

  return {
    reviewable: {
      [REVIEWABLE]: true,
      reference: order.reference,
      acknowledgment: {
        // Normalised to the order's own critical ids, so an
        // acknowledgment can never record a tick against something that
        // is not on this result — a client sending ids from the row
        // above would otherwise have them stored verbatim.
        acknowledgedResultIds: critical.map((result) => result.id),
        note: critical.length > 0 ? note.trim() : '',
      },
      hadCritical: critical.length > 0,
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
export function assertReviewable(value: ReviewableOrder): void {
  const candidate = value as unknown as Record<symbol, unknown> | null;

  if (typeof candidate !== 'object' || candidate === null || candidate[REVIEWABLE] !== true) {
    throw new NotReviewableError();
  }
}

/* ── Bulk review ────────────────────────────────────────────────── */

export interface BulkRefusal {
  readonly reference: string;
  readonly reason: ReviewBlockedReason;
}

export interface BulkReviewPartition {
  readonly eligible: readonly ReviewableOrder[];
  readonly refused: readonly BulkRefusal[];
}

/**
 * Splits a bulk request into what may go through and what may not.
 *
 * Both halves are returned. The service turns a non-empty `refused` into
 * a 422 that names every refused reference — it does **not** review the
 * eligible half and report partial success, because a doctor who asked
 * to clear eight results and had six cleared has no way to see which
 * two are still waiting unless the response says so, and the safe
 * reading of a 2xx is "all of it worked".
 */
export function partitionForBulkReview(
  orders: readonly ReviewCandidate[],
): BulkReviewPartition {
  const eligible: ReviewableOrder[] = [];
  const refused: BulkRefusal[] = [];

  for (const order of orders) {
    const outcome = assessReviewability({
      order,
      acknowledgedResultIds: [],
      note: '',
      bulk: true,
    });

    if (outcome.reviewable === null) {
      refused.push({ reference: order.reference, reason: outcome.blockedBy });
    } else {
      eligible.push(outcome.reviewable);
    }
  }

  return { eligible, refused };
}
