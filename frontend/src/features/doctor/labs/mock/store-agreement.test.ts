import { beforeEach, describe, expect, it } from 'vitest';

import { patientLabStudies } from '@/features/shared-domain/lab-studies';

import { assessReviewability } from '../model/review';

import { __resetLabsStore, mockLabService } from './mock-lab-service';

/**
 * The property the D-05 store move exists for: a review written on the Labs
 * screen is visible on that patient's profile.
 *
 * Before D-05 the review lived in a `Map` private to this adapter while the
 * profile rendered its own invented study cards, so the two could never
 * agree — and after a naive fix that shared only the *seed*, they still
 * would not have: the profile would project the unreviewed original forever.
 * This test fails if the store is ever split back in two.
 *
 * It drives the real write path — `assessReviewability` is the only producer
 * of a `ReviewableTest` — rather than poking the store directly, so it also
 * covers the adapter honouring that contract.
 */

beforeEach(() => {
  __resetLabsStore();
});

async function firstReviewableTest() {
  const tests = await mockLabService.listLabTests();
  // A released, unreviewed result with no critical analyte: reviewable
  // without an acknowledgment note, which keeps this test about visibility
  // rather than about D-11's critical rules (covered in review.test.ts).
  return tests.find(
    (test) => test.results.length > 0 && test.review === null && !test.hasCriticalResult,
  );
}

describe('lab review visibility across features', () => {
  it('shows a review taken on the Labs screen in the patient profile projection', async () => {
    const test = await firstReviewableTest();
    expect(test).toBeDefined();
    if (!test) return;

    const before = patientLabStudies(test.patient.id).find((study) => study.labId === test.id);
    expect(before?.reviewed).toBe(false);

    const { reviewable } = assessReviewability({
      test,
      reviewedBy: 'Dr. Amelia Chen',
      acknowledgedCriticalIds: [],
      note: '',
    });
    expect(reviewable).not.toBeNull();
    if (!reviewable) return;

    await mockLabService.markReviewed(reviewable);

    const after = patientLabStudies(test.patient.id).find((study) => study.labId === test.id);
    expect(after?.reviewed).toBe(true);
  });

  it('leaves every other order untouched', async () => {
    const test = await firstReviewableTest();
    if (!test) return;

    const others = patientLabStudies(test.patient.id).filter((study) => study.labId !== test.id);
    const reviewedBefore = others.filter((study) => study.reviewed).map((study) => study.labId);

    const { reviewable } = assessReviewability({
      test,
      reviewedBy: 'Dr. Amelia Chen',
      acknowledgedCriticalIds: [],
      note: '',
    });
    if (!reviewable) return;
    await mockLabService.markReviewed(reviewable);

    const reviewedAfter = patientLabStudies(test.patient.id)
      .filter((study) => study.reviewed && study.labId !== test.id)
      .map((study) => study.labId);

    expect(reviewedAfter).toEqual(reviewedBefore);
  });

  it('resets between suites, so a review does not leak into the next test', async () => {
    const test = await firstReviewableTest();
    if (!test) return;

    const study = patientLabStudies(test.patient.id).find((entry) => entry.labId === test.id);
    expect(study?.reviewed).toBe(false);
  });
});
