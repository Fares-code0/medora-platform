import {
  TEST_CATALOGUE,
  __resetLabStudies,
  getLabTest as readStoredTest,
  listLabTests as readStoredTests,
  putLabTest as writeStoredTest,
} from '@/features/shared-domain/lab-studies';

import {
  assertAnnotatable,
  toStoredAnnotation,
  type AnnotatableNote,
} from '../model/annotation';
import { LAB_NOT_FOUND, type LabService } from '../model/lab-service';
import {
  assertOrderable,
  toOrderedTests,
  type OrderableLabRequest,
} from '../model/ordering';
import { assertReviewable, toStoredReview, type ReviewableTest } from '../model/review';
import { trendsFromTests } from '../model/trends';
import type { LabTest, LabTimelineEvent } from '../model/types';

/**
 * The laboratory mock adapter — the write rules over a session-lifetime
 * store, so a review genuinely mutates state for the session and every
 * consumer refreshes through query invalidation (the pharmacy module's
 * pattern). The store itself lives in `shared-domain/lab-studies` (D-05):
 * the patient profile lists the same orders, so a Map private to this file
 * would let the two screens disagree about what has been reviewed.
 *
 * **Honesty rules this adapter keeps.**
 *
 * 1. Nothing here is transmitted anywhere. A review lands in an in-memory Map
 *    that dies with the tab (see that module), and the timeline event it writes says so in
 *    words — the UI reads that wording from the event rather than inventing a
 *    "filed to the LIS" line of its own.
 * 2. `markReviewed` re-checks the private symbol at runtime. The type already
 *    makes an unacknowledged critical review unrepresentable; this refuses a
 *    cast as well.
 * 3. That store is in memory rather than `localStorage`:
 *    `services/preferences.ts` is the app's only sanctioned storage boundary
 *    and it is for UI preferences, never PHI.
 */

const MOCK_LATENCY_MS = 400;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Test-only reset so suites do not leak reviews into each other. The store
 * itself moved to `shared-domain/lab-studies` in D-05 — the patient profile
 * reads the same orders, and a private Map here would have let the two
 * screens disagree about what has been reviewed.
 */
export function __resetLabsStore(): void {
  __resetLabStudies();
}

function applyReview(current: LabTest, reviewable: ReviewableTest, now: Date): LabTest {
  const review = toStoredReview(reviewable, now);
  const acknowledged = review.acknowledgedCriticalIds?.length ?? 0;

  const event: LabTimelineEvent = {
    id: `${current.id}-tl-reviewed-${review.reviewedAt}`,
    kind: 'verified',
    at: review.reviewedAt,
    actor: review.reviewedBy,
    detail:
      acknowledged > 0
        ? `Result reviewed by the ordering clinician; ${String(acknowledged)} critical value${
            acknowledged === 1 ? '' : 's'
          } acknowledged. Note: ${review.note} Recorded in this demo session only — no laboratory system is connected.`
        : 'Result reviewed by the ordering clinician. Recorded in this demo session only — no laboratory system is connected.',
  };

  return {
    ...current,
    review,
    updatedAt: review.reviewedAt,
    timeline: [...current.timeline, event],
  };
}

export const mockLabService: LabService = {
  capabilities: { annotations: true, transmits: false },

  async listCatalogue() {
    await delay(MOCK_LATENCY_MS / 4);
    return TEST_CATALOGUE;
  },

  async listLabTests() {
    await delay(MOCK_LATENCY_MS);
    return readStoredTests();
  },

  async getLabTest(labId) {
    await delay(MOCK_LATENCY_MS);
    const test = readStoredTest(labId);
    if (!test) throw new Error(LAB_NOT_FOUND);
    return test;
  },

  async getTrends(patientId, analytes) {
    await delay(MOCK_LATENCY_MS / 2);
    return trendsFromTests(readStoredTests(), patientId, analytes);
  },

  async markReviewed(reviewable) {
    // Belt and braces: the type already makes an unacknowledged critical
    // review unrepresentable, and this refuses a cast at runtime.
    assertReviewable(reviewable);
    await delay(MOCK_LATENCY_MS);

    const current = readStoredTest(reviewable.labId);
    if (!current) throw new Error(LAB_NOT_FOUND);
    /*
     * Re-checked here and not only in `assessReviewability`: the assessment
     * ran against the copy the UI held, and another tab — or a bulk action
     * overlapping a single one — may have reviewed it since. A second review
     * would overwrite the first reviewer's attribution.
     */
    if (current.review !== null) return current;

    const next = applyReview(current, reviewable, new Date());
    writeStoredTest(next);
    return next;
  },

  async annotate(note: AnnotatableNote) {
    // Same belt-and-braces as markReviewed: the type already makes an empty
    // note unrepresentable, and this refuses a cast at runtime.
    assertAnnotatable(note);
    await delay(MOCK_LATENCY_MS);

    const current = readStoredTest(note.labId);
    if (!current) throw new Error(LAB_NOT_FOUND);

    const next: LabTest = {
      ...current,
      annotations: [...current.annotations, toStoredAnnotation(note, new Date())],
      // The order itself did not change state; only the record around it grew.
      updatedAt: new Date().toISOString(),
    };
    writeStoredTest(next);
    return next;
  },

  async orderLabs(request: OrderableLabRequest) {
    assertOrderable(request);
    await delay(MOCK_LATENCY_MS);

    const created = toOrderedTests(request, new Date());
    for (const test of created) writeStoredTest(test);
    return created;
  },

  async markManyReviewed(reviewables) {
    for (const reviewable of reviewables) assertReviewable(reviewable);
    await delay(MOCK_LATENCY_MS);

    const now = new Date();
    const updated: LabTest[] = [];
    for (const reviewable of reviewables) {
      const current = readStoredTest(reviewable.labId);
      if (!current) throw new Error(LAB_NOT_FOUND);
      if (current.review !== null) {
        updated.push(current);
        continue;
      }
      const next = applyReview(current, reviewable, now);
      writeStoredTest(next);
      updated.push(next);
    }
    return updated;
  },
};
