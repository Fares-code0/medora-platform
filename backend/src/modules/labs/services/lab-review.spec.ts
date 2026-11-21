import { describe, expect, it } from 'vitest';

import type { LabResultFlag } from '../../../generated/prisma/enums';

import {
  assessReviewability,
  assertReviewable,
  criticalResultsOf,
  isCriticalUnreviewed,
  NotReviewableError,
  partitionForBulkReview,
  REVIEW_BLOCKED_META,
  reviewStateOf,
  type ReviewableOrder,
  type ReviewCandidate,
} from './lab-review';

/**
 * The review discipline (RM M14.5 — API §8.7, UX §2.6).
 *
 * The property under test is one sentence: **a critical result cannot be
 * marked reviewed by accident.** So these assert that *no value is
 * produced* rather than that some flag is false — a boolean can be
 * ignored by a caller, and a value that does not exist cannot be.
 */

function order(
  reference: string,
  flags: readonly LabResultFlag[],
  reviewedAt: Date | null = null,
): ReviewCandidate {
  return {
    reference,
    reviewedAt,
    results: flags.map((flag, index) => ({ id: `${reference}-r${String(index + 1)}`, flag })),
  };
}

const CRITICAL = order('LAB-100001', ['NORMAL', 'CRITICAL_HIGH']);
const NORMAL = order('LAB-100002', ['NORMAL', 'NORMAL']);
const HIGH = order('LAB-100003', ['NORMAL', 'HIGH']);

describe('reviewStateOf', () => {
  it('calls an order with nothing released not-required, not unreviewed', () => {
    // An order still in the analyser is in nobody's inbox. Folding it
    // into `unreviewed` would make the §8.10 count mean "rows that are
    // not green" rather than "results waiting on you".
    expect(reviewStateOf(order('LAB-100004', []))).toBe('not-required');
  });

  it('calls a released, unattributed order unreviewed', () => {
    expect(reviewStateOf(NORMAL)).toBe('unreviewed');
  });

  it('calls an attributed order reviewed', () => {
    expect(reviewStateOf(order('LAB-100005', ['NORMAL'], new Date()))).toBe('reviewed');
  });
});

describe('isCriticalUnreviewed — the §8.10 chip predicate', () => {
  it('is true only for an unreviewed order carrying a critical value', () => {
    expect(isCriticalUnreviewed(CRITICAL)).toBe(true);
    expect(isCriticalUnreviewed(NORMAL)).toBe(false);
    expect(isCriticalUnreviewed(HIGH)).toBe(false);
    expect(
      isCriticalUnreviewed(order('LAB-100006', ['CRITICAL_LOW'], new Date())),
    ).toBe(false);
  });

  it('names every critical result on the order, not just the first', () => {
    const many = order('LAB-100007', ['CRITICAL_LOW', 'NORMAL', 'CRITICAL_HIGH']);
    expect(criticalResultsOf(many).map((result) => result.id)).toEqual([
      'LAB-100007-r1',
      'LAB-100007-r3',
    ]);
  });
});

describe('assessReviewability — individual', () => {
  const individually = (
    candidate: ReviewCandidate,
    acknowledgedResultIds: readonly string[] = [],
    note = '',
  ) => assessReviewability({ order: candidate, acknowledgedResultIds, note, bulk: false });

  it('produces a reviewable order for a released, unreviewed normal result', () => {
    const outcome = individually(NORMAL);
    expect(outcome.blockedBy).toBeNull();
    expect(outcome.reviewable).not.toBeNull();
  });

  it('produces NOTHING for an order with no released results', () => {
    const outcome = individually(order('LAB-100008', []));
    expect(outcome.reviewable).toBeNull();
    expect(outcome.blockedBy).toBe('no-results');
  });

  it('produces NOTHING for an order already reviewed', () => {
    const outcome = individually(order('LAB-100009', ['NORMAL'], new Date()));
    expect(outcome.reviewable).toBeNull();
    expect(outcome.blockedBy).toBe('already-reviewed');
  });

  it('produces NOTHING when a critical value is not acknowledged', () => {
    const outcome = individually(CRITICAL, [], 'Called the ward.');
    expect(outcome.reviewable).toBeNull();
    expect(outcome.blockedBy).toBe('unacknowledged-critical');
  });

  it('refuses a partial acknowledgment rather than truncating it', () => {
    // Acknowledging two of three and having the third cleared anyway is
    // the exact accident this exists to prevent.
    const many = order('LAB-100010', ['CRITICAL_LOW', 'CRITICAL_HIGH']);
    const outcome = individually(many, ['LAB-100010-r1'], 'Called the ward.');
    expect(outcome.reviewable).toBeNull();
    expect(outcome.blockedBy).toBe('unacknowledged-critical');
  });

  it('refuses a tick with no reason — that is not an acknowledgment', () => {
    const outcome = individually(CRITICAL, ['LAB-100001-r2'], '   ');
    expect(outcome.reviewable).toBeNull();
    expect(outcome.blockedBy).toBe('missing-note');
  });

  it('accepts a fully acknowledged critical result with a note', () => {
    const outcome = individually(CRITICAL, ['LAB-100001-r2'], '  Called the ward.  ');
    expect(outcome.blockedBy).toBeNull();
    expect(outcome.reviewable?.hadCritical).toBe(true);
    expect(outcome.reviewable?.acknowledgment.note).toBe('Called the ward.');
  });

  it('normalises the acknowledged ids to the order own critical results', () => {
    // A client sending ids from the row above would otherwise have them
    // stored verbatim, recording a tick against something that is not on
    // this result.
    const outcome = individually(
      CRITICAL,
      ['LAB-100001-r2', 'LAB-999999-r1'],
      'Called the ward.',
    );
    expect(outcome.reviewable?.acknowledgment.acknowledgedResultIds).toEqual([
      'LAB-100001-r2',
    ]);
  });

  it('does not demand a note for an order with no critical value', () => {
    // A merely high result still needs an individual review, but not an
    // acknowledgment: nothing has to be explained about a value the
    // doctor is looking at.
    const outcome = individually(HIGH);
    expect(outcome.blockedBy).toBeNull();
    expect(outcome.reviewable?.hadCritical).toBe(false);
    expect(outcome.reviewable?.acknowledgment.note).toBe('');
  });

  it('names every blocked reason in words', () => {
    for (const message of Object.values(REVIEW_BLOCKED_META)) {
      expect(message.length).toBeGreaterThan(0);
    }
  });
});

describe('assessReviewability — bulk', () => {
  const inBulk = (candidate: ReviewCandidate) =>
    assessReviewability({
      order: candidate,
      acknowledgedResultIds: [],
      note: '',
      bulk: true,
    });

  it('clears an order whose every flag is normal', () => {
    expect(inBulk(NORMAL).reviewable).not.toBeNull();
  });

  it('refuses a merely high result — "bulk allowed only for Normal"', () => {
    // Not "only non-critical". The point of the restriction is that a
    // result a doctor should have looked at never gets cleared by a
    // checkbox in a header row.
    const outcome = inBulk(HIGH);
    expect(outcome.reviewable).toBeNull();
    expect(outcome.blockedBy).toBe('bulk-not-normal');
  });

  it('refuses a critical result', () => {
    expect(inBulk(CRITICAL).reviewable).toBeNull();
  });

  it('cannot be bought past with acknowledgments', () => {
    // The bulk branch is tested before the acknowledgment branch on
    // purpose: a client that ticked every critical id and supplied a
    // note must still be refused, because bulk is not where a critical
    // value gets reviewed.
    const outcome = assessReviewability({
      order: CRITICAL,
      acknowledgedResultIds: ['LAB-100001-r2'],
      note: 'Called the ward.',
      bulk: true,
    });

    expect(outcome.reviewable).toBeNull();
    expect(outcome.blockedBy).toBe('bulk-not-normal');
  });

  it('still refuses an unreleased or already-reviewed order', () => {
    expect(inBulk(order('LAB-100011', [])).blockedBy).toBe('no-results');
    expect(inBulk(order('LAB-100012', ['NORMAL'], new Date())).blockedBy).toBe(
      'already-reviewed',
    );
  });

  it('carries no acknowledgment, because it reached no critical value', () => {
    const outcome = inBulk(NORMAL);
    expect(outcome.reviewable?.hadCritical).toBe(false);
    expect(outcome.reviewable?.acknowledgment.acknowledgedResultIds).toEqual([]);
  });
});

describe('partitionForBulkReview', () => {
  it('splits eligible from refused and never silently drops one', () => {
    // A bulk review that quietly skips the critical results is worse
    // than one that refuses them: the doctor believes the queue is clear.
    const { eligible, refused } = partitionForBulkReview([NORMAL, HIGH, CRITICAL]);

    expect(eligible.map((entry) => entry.reference)).toEqual(['LAB-100002']);
    expect(refused).toEqual([
      { reference: 'LAB-100003', reason: 'bulk-not-normal' },
      { reference: 'LAB-100001', reason: 'bulk-not-normal' },
    ]);
    expect(eligible.length + refused.length).toBe(3);
  });

  it('reports the specific reason per refused order', () => {
    const { refused } = partitionForBulkReview([
      order('LAB-100013', []),
      order('LAB-100014', ['NORMAL'], new Date()),
    ]);

    expect(refused.map((entry) => entry.reason)).toEqual(['no-results', 'already-reviewed']);
  });

  it('returns two empty halves for an empty request', () => {
    expect(partitionForBulkReview([])).toEqual({ eligible: [], refused: [] });
  });
});

describe('assertReviewable — the runtime half of the guarantee', () => {
  it('accepts a value the assessment produced', () => {
    const { reviewable } = assessReviewability({
      order: NORMAL,
      acknowledgedResultIds: [],
      note: '',
      bulk: false,
    });

    expect(() => {
      assertReviewable(reviewable as ReviewableOrder);
    }).not.toThrow();
  });

  it('refuses a forged value at runtime, not merely at compile time', () => {
    // The symbol cannot be named outside the module, so TypeScript
    // already refuses this — and a cast defeats TypeScript. This is what
    // it does not defeat.
    const forged = {
      reference: 'LAB-100001',
      acknowledgment: { acknowledgedResultIds: [], note: '' },
      hadCritical: false,
    } as unknown as ReviewableOrder;

    expect(() => {
      assertReviewable(forged);
    }).toThrow(NotReviewableError);
  });

  it('refuses a non-object and a null', () => {
    expect(() => {
      assertReviewable(null as unknown as ReviewableOrder);
    }).toThrow(NotReviewableError);
    expect(() => {
      assertReviewable('LAB-100001' as unknown as ReviewableOrder);
    }).toThrow(NotReviewableError);
  });
});
