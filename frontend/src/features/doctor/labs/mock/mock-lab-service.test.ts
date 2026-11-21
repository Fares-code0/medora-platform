import { beforeEach, describe, expect, it } from 'vitest';

import { LAB_NOT_FOUND } from '../model/lab-service';
import {
  NotReviewableError,
  assessReviewability,
  criticalResults,
  inboxTests,
  type ReviewableTest,
} from '../model/review';

import { __resetLabsStore, mockLabService } from './mock-lab-service';

/**
 * The adapter's own guarantees, independent of any screen: a review is
 * written once, it is attributed, it is refused without the private symbol,
 * and it never claims to have left the browser.
 */

const REVIEWER = 'Dr. Amelia Chen';

async function reviewableFor(labId: string): Promise<ReviewableTest> {
  const test = await mockLabService.getLabTest(labId);
  const critical = criticalResults(test);
  const outcome = assessReviewability({
    test,
    reviewedBy: REVIEWER,
    acknowledgedCriticalIds: critical.map((result) => result.id),
    note: critical.length > 0 ? 'Patient contacted; repeat requested.' : '',
  });
  if (outcome.reviewable === null) {
    throw new Error(`Not reviewable: ${outcome.blockedBy}`);
  }
  return outcome.reviewable;
}

beforeEach(() => {
  __resetLabsStore();
});

describe('reads', () => {
  it('returns the seeded dataset and resolves one order by id', async () => {
    const all = await mockLabService.listLabTests();
    expect(all.length).toBeGreaterThan(0);

    const first = all[0]!;
    await expect(mockLabService.getLabTest(first.id)).resolves.toEqual(first);
  });

  it('rejects an unknown id with the error contract the port declares', async () => {
    await expect(mockLabService.getLabTest('LAB-nope')).rejects.toThrow(LAB_NOT_FOUND);
  });
});

describe('markReviewed', () => {
  it('records the reviewer and takes the result out of the Inbox', async () => {
    const open = inboxTests(await mockLabService.listLabTests())[0]!;
    const updated = await mockLabService.markReviewed(await reviewableFor(open.id));

    expect(updated.review?.reviewedBy).toBe(REVIEWER);
    expect(inboxTests(await mockLabService.listLabTests()).map((t) => t.id)).not.toContain(open.id);
  });

  it('writes a timeline event that says nothing was transmitted', async () => {
    const open = inboxTests(await mockLabService.listLabTests())[0]!;
    const updated = await mockLabService.markReviewed(await reviewableFor(open.id));

    const event = updated.timeline.at(-1);
    expect(event?.actor).toBe(REVIEWER);
    expect(event?.detail).toMatch(/no laboratory system is connected/i);
  });

  it('names the acknowledged criticals in the event when there are any', async () => {
    const critical = inboxTests(await mockLabService.listLabTests()).find(
      (test) => criticalResults(test).length > 0,
    );
    expect(critical).toBeDefined();

    const updated = await mockLabService.markReviewed(await reviewableFor(critical!.id));
    expect(updated.review?.acknowledgedCriticalIds).toHaveLength(
      criticalResults(critical!).length,
    );
    expect(updated.timeline.at(-1)?.detail).toMatch(/critical value/i);
  });

  it('does not overwrite an existing review — the first reviewer keeps the attribution', async () => {
    const open = inboxTests(await mockLabService.listLabTests())[0]!;
    const reviewable = await reviewableFor(open.id);
    const first = await mockLabService.markReviewed(reviewable);

    // A second submission of the same value (another tab, a double click).
    const second = await mockLabService.markReviewed(reviewable);
    expect(second.review?.reviewedAt).toBe(first.review?.reviewedAt);
    expect(second.timeline).toHaveLength(first.timeline.length);
  });

  it('refuses a forged value at runtime and writes nothing', async () => {
    const open = inboxTests(await mockLabService.listLabTests())[0]!;
    const forged = {
      labId: open.id,
      reviewedBy: REVIEWER,
      acknowledgment: { acknowledgedCriticalIds: [], note: '' },
    } as unknown as ReviewableTest;

    await expect(mockLabService.markReviewed(forged)).rejects.toThrow(NotReviewableError);
    await expect(mockLabService.getLabTest(open.id)).resolves.toHaveProperty('review', null);
  });
});

describe('markManyReviewed', () => {
  it('writes every one of them in a single call', async () => {
    const open = inboxTests(await mockLabService.listLabTests()).slice(0, 2);
    const reviewables = await Promise.all(open.map((test) => reviewableFor(test.id)));

    const updated = await mockLabService.markManyReviewed(reviewables);
    expect(updated).toHaveLength(open.length);
    expect(updated.every((test) => test.review !== null)).toBe(true);
  });

  it('validates every value BEFORE writing any — one forged entry writes nothing', async () => {
    const open = inboxTests(await mockLabService.listLabTests()).slice(0, 2);
    const good = await reviewableFor(open[0]!.id);
    const forged = {
      labId: open[1]!.id,
      reviewedBy: REVIEWER,
      acknowledgment: { acknowledgedCriticalIds: [], note: '' },
    } as unknown as ReviewableTest;

    await expect(mockLabService.markManyReviewed([good, forged])).rejects.toThrow(
      NotReviewableError,
    );
    await expect(mockLabService.getLabTest(open[0]!.id)).resolves.toHaveProperty('review', null);
  });
});
