import { describe, expect, it } from 'vitest';

import { adapterImportOffenders } from '@/test/seam-rules';

import { reportsService } from './service';

/**
 * The reports seam (DP-04). The feature's surface was complete — KPI row,
 * analytics grid, insights, the saved-reports rail, scheduled reports, the
 * export dialog — but the query layer imported all twelve functions straight
 * out of `mock/mock-reports-service`, and `ScheduledReportsPanel` reached in
 * for `ScheduleInput` on top of that. Both are the defect
 * `docs/handoff/auth-seam.md` §1 rule 3 names.
 *
 * A type alone does not keep that closed, so the rule is asserted over the
 * source tree.
 */

describe('the reports seam', () => {
  it('is the only route to the adapter — nothing downstream imports the mock', () => {
    expect(adapterImportOffenders(__dirname, 'mock/mock-reports-service')).toStrictEqual([]);
  });

  it('exposes the whole port, so a real adapter has a complete contract to meet', () => {
    expect(Object.keys(reportsService).sort()).toStrictEqual([
      'capabilities',
      'createSavedReport',
      'createSchedule',
      'deleteSavedReport',
      'deleteSchedule',
      'duplicateSavedReport',
      'fetchAnalytics',
      'fetchReportsDocument',
      'renameSavedReport',
      'runExport',
      'toggleFavorite',
      'toggleScheduleStatus',
      'touchSavedReport',
    ]);
  });

  it('answers a document mutation with the whole document, so the cache is written not refetched', async () => {
    const document = await reportsService.toggleFavorite('seam-test-user', 'no-such-report');

    // The shape, not the contents: a mutation that answered only the row it
    // touched would let the rail render a report that had just been deleted.
    expect(Array.isArray(document.saved)).toBe(true);
    expect(Array.isArray(document.scheduled)).toBe(true);
  });
});
