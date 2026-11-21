import { notConnected } from '@/api/http';
import { selectService } from '@/api/seam';

import { fileDataErrorReport, type FileDataErrorInput } from './store';
import type { DataErrorReport } from './types';

/**
 * The data-error reporting seam (D-07).
 *
 * The store beside this file is a session-memory demo of the route the
 * report should take: the doctor files, the admin patients area folds it
 * into the account's open work. That loop is only real in mock mode,
 * where the admin area reads the same store. A live build has **no
 * patient-level report route** (`backend/src/modules/patients` serves
 * none; API §6.9's `report-issue` is per medical record) and its admin
 * patients area answers "Not connected yet", so filing into the demo
 * store there would toast "it is now in the administrators' queue" over
 * a report no administrator can ever see.
 *
 * So the live side is `available: false` and refuses, and the profile
 * offers no "Flag a data error" at all — the D-04 rule: an action that
 * cannot work is absent rather than greyed or toasted.
 */
export interface DataErrorReportService {
  /** Whether filing reaches anyone in this build. The control is absent when false. */
  readonly available: boolean;
  file(input: FileDataErrorInput): Promise<DataErrorReport>;
}

export const mockDataErrorReportService: DataErrorReportService = {
  available: true,
  file: fileDataErrorReport,
};

export const unconnectedDataErrorReportService: DataErrorReportService = {
  available: false,
  file: () => Promise.reject(notConnected('Data-error reports')),
};

export const dataErrorReportService = selectService({
  mock: mockDataErrorReportService,
  http: unconnectedDataErrorReportService,
});
