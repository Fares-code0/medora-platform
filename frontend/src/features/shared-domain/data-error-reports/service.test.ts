import { beforeEach, describe, expect, it } from 'vitest';

import { isNotConnected } from '@/api/http';

import {
  mockDataErrorReportService,
  unconnectedDataErrorReportService,
} from './service';
import { __resetDataErrorReports, listDataErrorReports } from './store';

/**
 * The live side of D-07. A live build has no patient-level report route and
 * its admin patients area is not connected, so a report filed into the demo
 * store would be announced as "in the administrators' queue" and read by
 * nobody. The unconnected adapter must say it is unavailable, refuse, and
 * leave nothing behind that a later screen could mistake for a filed report.
 */

const input = {
  patientId: 'PT-1001',
  patientName: 'Khaled Nassar',
  patientMrn: 'MRN-100001',
  field: 'date-of-birth' as const,
  description: 'DOB is 1962-03-14 per the ID, not 1963-03-14.',
  reportedBy: 'Dr. Amelia Chen',
};

beforeEach(() => {
  __resetDataErrorReports();
});

describe('data-error reporting seam', () => {
  it('mock mode files into the store the admin area reads', async () => {
    expect(mockDataErrorReportService.available).toBe(true);

    const report = await mockDataErrorReportService.file(input);

    expect(listDataErrorReports()).toEqual([report]);
  });

  it('live mode is unavailable and refuses without writing anything', async () => {
    expect(unconnectedDataErrorReportService.available).toBe(false);

    const failure: unknown = await unconnectedDataErrorReportService.file(input).catch(
      (error: unknown) => error,
    );

    expect(isNotConnected(failure)).toBe(true);
    expect(listDataErrorReports()).toEqual([]);
  });
});
