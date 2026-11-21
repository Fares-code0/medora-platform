import { afterEach, describe, expect, it } from 'vitest';

import { mockDashboardService } from './doctor/dashboard/mock/mock-dashboard-service';
import { mockLabService } from './doctor/labs/mock/mock-lab-service';
import {
  assessReviewability,
  criticalResults,
  criticalUnreviewedCount,
  isCriticalUnreviewed,
} from './doctor/labs/model/review';
import { __resetLabStudies } from './shared-domain/lab-studies';

/**
 * The demo's Row-0 banner and the Labs screen describe one fact — a critical
 * result nobody has reviewed — so they must agree, and a review on the Labs
 * screen must clear the banner. Neither feature imports the other (§3.4);
 * they meet in the shared lab store, which is why this test sits above both.
 */

afterEach(() => {
  __resetLabStudies();
});

async function bannerHrefs(): Promise<string[]> {
  const answer = await mockDashboardService.getCriticalAlerts();
  if (!answer.served) throw new Error('the demo always serves the banner');
  return answer.alerts.map((alert) => alert.href);
}

describe('critical alerts ↔ labs (demo)', () => {
  it('lists exactly the results the Labs page counts as critical and unreviewed', async () => {
    const tests = await mockLabService.listLabTests();
    const hrefs = await bannerHrefs();

    expect(hrefs.length).toBeGreaterThan(0);
    expect(hrefs).toHaveLength(criticalUnreviewedCount(tests));
    expect([...hrefs].sort()).toEqual(
      tests
        .filter(isCriticalUnreviewed)
        .map((test) => `/doctor/labs/${test.id}`)
        .sort(),
    );
  });

  it('drops a result once it is reviewed on the Labs screen', async () => {
    const tests = await mockLabService.listLabTests();
    const target = tests.find(isCriticalUnreviewed);
    if (target === undefined) throw new Error('demo corpus has no critical unreviewed result');
    expect(await bannerHrefs()).toContain(`/doctor/labs/${target.id}`);

    const { reviewable } = assessReviewability({
      test: target,
      reviewedBy: 'Dr. Amelia Chen',
      acknowledgedCriticalIds: criticalResults(target).map((result) => result.id),
      note: 'Repeat sample drawn; patient called in.',
    });
    if (reviewable === null) throw new Error('the review should be assessable');
    await mockLabService.markReviewed(reviewable);

    expect(await bannerHrefs()).not.toContain(`/doctor/labs/${target.id}`);
  });
});
