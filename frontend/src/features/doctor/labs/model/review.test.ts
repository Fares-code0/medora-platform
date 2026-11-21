import { describe, expect, it } from 'vitest';

import {
  BULK_REFUSAL_META,
  NotReviewableError,
  assertReviewable,
  assessReviewability,
  criticalResults,
  criticalUnreviewedCount,
  hasReleasedResults,
  inboxTests,
  isCriticalUnreviewed,
  partitionForBulkReview,
  reviewState,
  sortInbox,
  toStoredReview,
  type ReviewableTest,
} from './review';
import type { LabResultFlag, LabResultItem, LabReview, LabTest } from './types';

/**
 * The review rules, and above all the one this module exists for: **a
 * critical result cannot be marked reviewed by accident.**
 *
 * The load-bearing tests here assert *absence of a value* rather than a
 * disabled flag — `assessReviewability` returns `null` and there is nothing
 * to hand the mutation. Asserting on a boolean would be testing the weaker
 * property, which is exactly the design this module rejects.
 */

let sequence = 0;

function result(flag: LabResultFlag, analyte = 'Potassium'): LabResultItem {
  sequence += 1;
  return {
    id: `r-${String(sequence)}`,
    analyte,
    value: '5.0',
    numericValue: 5,
    unit: 'mmol/L',
    referenceRange: { low: 3.5, high: 5.1, text: '3.5–5.1' },
    flag,
  };
}

function test(
  overrides: Partial<LabTest> & { results?: readonly LabResultItem[] } = {},
): LabTest {
  sequence += 1;
  return {
    id: `LAB-${String(sequence)}`,
    patient: {
      id: 'PT-1',
      name: 'Omar Farouk',
      mrn: 'MRN-1',
      age: 40,
      gender: 'male',
      bloodType: 'O+',
      phone: '01000000000',
    },
    testName: 'Basic metabolic panel',
    testCode: 'BMP',
    category: 'Chemistry',
    department: 'General Medicine',
    orderedBy: 'Dr. Amelia Chen',
    clinicalIndication: 'Routine',
    status: 'completed',
    priority: 'routine',
    requestedDate: '2026-08-01T09:00:00.000Z',
    collectedDate: '2026-08-01T10:00:00.000Z',
    completedDate: '2026-08-01T12:00:00.000Z',
    specimen: null,
    results: [],
    interpretation: null,
    hasCriticalResult: false,
    review: null,
    attachments: [],
    annotations: [],
    timeline: [],
    createdAt: '2026-08-01T09:00:00.000Z',
    updatedAt: '2026-08-01T12:00:00.000Z',
    ...overrides,
  };
}

const reviewed: LabReview = {
  reviewedAt: '2026-08-02T09:00:00.000Z',
  reviewedBy: 'Dr. Amelia Chen',
  acknowledgedCriticalIds: [],
  note: '',
};

describe('review state', () => {
  it('an order with nothing released is not "unreviewed" — it is not reviewable', () => {
    const pending = test({ status: 'processing', results: [], completedDate: null });
    expect(hasReleasedResults(pending)).toBe(false);
    expect(reviewState(pending)).toBe('not-required');
    expect(inboxTests([pending])).toEqual([]);
  });

  it('a released, unreviewed result is in the Inbox; a reviewed one is not', () => {
    const open = test({ results: [result('normal')] });
    const done = test({ results: [result('normal')], review: reviewed });
    expect(reviewState(open)).toBe('unreviewed');
    expect(reviewState(done)).toBe('reviewed');
    expect(inboxTests([open, done])).toEqual([open]);
  });

  it('counts only unreviewed criticals — a reviewed critical is not outstanding', () => {
    const open = test({ results: [result('critical-high')] });
    const done = test({ results: [result('critical-low')], review: reviewed });
    expect(isCriticalUnreviewed(open)).toBe(true);
    expect(isCriticalUnreviewed(done)).toBe(false);
    expect(criticalUnreviewedCount([open, done])).toBe(1);
  });
});

describe('Inbox ordering (UX §2.6: critical always sorts to top)', () => {
  it('bands critical, then abnormal, then normal — oldest first inside a band', () => {
    const normalOld = test({ id: 'N-OLD', results: [result('normal')], completedDate: '2026-01-01T00:00:00.000Z' });
    const normalNew = test({ id: 'N-NEW', results: [result('normal')], completedDate: '2026-08-01T00:00:00.000Z' });
    const abnormal = test({ id: 'ABN', results: [result('high')], completedDate: '2026-08-02T00:00:00.000Z' });
    const critical = test({ id: 'CRIT', results: [result('critical-high')], completedDate: '2026-08-03T00:00:00.000Z' });

    expect(sortInbox([normalNew, abnormal, normalOld, critical]).map((t) => t.id)).toEqual([
      'CRIT',
      'ABN',
      'N-OLD',
      'N-NEW',
    ]);
  });
});

describe('assessReviewability — the fail-closed gate', () => {
  const reviewer = 'Dr. Amelia Chen';

  it('signs off a normal result with no ceremony', () => {
    const outcome = assessReviewability({
      test: test({ results: [result('normal')] }),
      reviewedBy: reviewer,
      acknowledgedCriticalIds: [],
      note: '',
    });
    expect(outcome.blockedBy).toBeNull();
    expect(outcome.reviewable).not.toBeNull();
  });

  it('produces NOTHING for a critical result with no acknowledgment', () => {
    const critical = result('critical-high');
    const outcome = assessReviewability({
      test: test({ results: [critical] }),
      reviewedBy: reviewer,
      acknowledgedCriticalIds: [],
      note: 'Patient called.',
    });
    // Not "disabled" — there is no value to submit.
    expect(outcome.reviewable).toBeNull();
    expect(outcome.blockedBy).toBe('unacknowledged-critical');
  });

  it('refuses a partial acknowledgment when several values are critical', () => {
    const first = result('critical-high', 'Potassium');
    const second = result('critical-low', 'Sodium');
    const outcome = assessReviewability({
      test: test({ results: [first, second] }),
      reviewedBy: reviewer,
      acknowledgedCriticalIds: [first.id],
      note: 'Patient called.',
    });
    expect(outcome.reviewable).toBeNull();
    expect(outcome.blockedBy).toBe('unacknowledged-critical');
  });

  it('refuses a ticked acknowledgment with no note — a tick is not an explanation', () => {
    const critical = result('critical-high');
    const outcome = assessReviewability({
      test: test({ results: [critical] }),
      reviewedBy: reviewer,
      acknowledgedCriticalIds: [critical.id],
      note: '   ',
    });
    expect(outcome.reviewable).toBeNull();
    expect(outcome.blockedBy).toBe('missing-note');
  });

  it('accepts a fully acknowledged critical result and records exactly its own ids', () => {
    const critical = result('critical-high');
    const outcome = assessReviewability({
      test: test({ results: [critical, result('normal', 'Sodium')] }),
      reviewedBy: reviewer,
      // A tick against something not on this result is ignored, not stored.
      acknowledgedCriticalIds: [critical.id, 'r-not-on-this-test'],
      note: '  Patient called, repeat sample requested.  ',
    });
    expect(outcome.blockedBy).toBeNull();
    const stored = toStoredReview(outcome.reviewable!, new Date('2026-08-03T08:00:00.000Z'));
    expect(stored.acknowledgedCriticalIds).toEqual([critical.id]);
    expect(stored.note).toBe('Patient called, repeat sample requested.');
    expect(stored.reviewedBy).toBe(reviewer);
  });

  it('refuses an order with nothing released, and one already reviewed', () => {
    expect(
      assessReviewability({
        test: test({ results: [], status: 'processing' }),
        reviewedBy: reviewer,
        acknowledgedCriticalIds: [],
        note: '',
      }).blockedBy,
    ).toBe('no-results');

    expect(
      assessReviewability({
        test: test({ results: [result('normal')], review: reviewed }),
        reviewedBy: reviewer,
        acknowledgedCriticalIds: [],
        note: '',
      }).blockedBy,
    ).toBe('already-reviewed');
  });

  it('refuses an unnamed reviewer — a review with no author is not an audit record', () => {
    expect(
      assessReviewability({
        test: test({ results: [result('normal')] }),
        reviewedBy: '  ',
        acknowledgedCriticalIds: [],
        note: '',
      }).blockedBy,
    ).toBe('no-reviewer');
  });
});

describe('assertReviewable — the runtime half', () => {
  it('refuses a hand-built object that satisfies the type by cast', () => {
    const forged = {
      labId: 'LAB-1',
      reviewedBy: 'Dr. Amelia Chen',
      acknowledgment: { acknowledgedCriticalIds: [], note: '' },
    } as unknown as ReviewableTest;
    expect(() => assertReviewable(forged)).toThrow(NotReviewableError);
  });

  it('accepts the value its own producer made', () => {
    const outcome = assessReviewability({
      test: test({ results: [result('normal')] }),
      reviewedBy: 'Dr. Amelia Chen',
      acknowledgedCriticalIds: [],
      note: '',
    });
    expect(() => {
      assertReviewable(outcome.reviewable!);
    }).not.toThrow();
  });
});

describe('partitionForBulkReview (UX §2.6: bulk allowed only for Normal)', () => {
  it('lets normal results through and refuses everything else, with a reason', () => {
    const normal = test({ id: 'OK', results: [result('normal'), result('normal', 'Sodium')] });
    const high = test({ id: 'HIGH', results: [result('high')] });
    const critical = test({ id: 'CRIT', results: [result('critical-high')] });
    const done = test({ id: 'DONE', results: [result('normal')], review: reviewed });
    const pending = test({ id: 'PENDING', results: [], status: 'processing' });

    const { eligible, refused } = partitionForBulkReview([normal, high, critical, done, pending]);

    expect(eligible.map((t) => t.id)).toEqual(['OK']);
    expect(refused.map((entry) => [entry.test.id, entry.reason])).toEqual([
      ['HIGH', 'not-normal'],
      ['CRIT', 'not-normal'],
      ['DONE', 'already-reviewed'],
      ['PENDING', 'no-results'],
    ]);
  });

  it('never drops a refused result silently — every refusal carries a message', () => {
    const { refused } = partitionForBulkReview([test({ results: [result('critical-high')] })]);
    expect(refused).toHaveLength(1);
    expect(BULK_REFUSAL_META[refused[0]!.reason]).toBeTruthy();
  });

  it('an abnormal-but-not-critical result is refused too — the rule is Normal, not non-critical', () => {
    const { eligible } = partitionForBulkReview([test({ results: [result('low')] })]);
    expect(eligible).toEqual([]);
  });
});

describe('criticalResults', () => {
  it('picks both critical directions and nothing else', () => {
    const t = test({
      results: [result('critical-low'), result('critical-high'), result('high'), result('normal')],
    });
    expect(criticalResults(t).map((r) => r.flag)).toEqual(['critical-low', 'critical-high']);
  });
});
