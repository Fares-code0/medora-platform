import { beforeEach, describe, expect, it } from 'vitest';

import { MOCK_PATIENTS } from '@/features/shared-domain/patient-identity';

import {
  __resetDataErrorReports,
  fileDataErrorReport,
  listDataErrorReports,
  openReportsForPatient,
  resolveDataErrorReport,
} from './store';

/**
 * D-07, "flag data error → routed to admin" (UX §2.3).
 *
 * The row was blocked on "no admin queue to route it to". That stopped
 * being true when Phase C shipped ADM-01's action queue, and the admin side
 * already had the vocabulary — `SupportFlagKind` includes
 * `'data-correction'`, seeded on a couple of accounts with nothing producing
 * one. So the test that matters is the round trip: a report a doctor files
 * has to arrive as open work on that patient's ADMIN account, because
 * "routed to admin" is otherwise a claim nobody can check. What it replaced
 * — a `mailto:` — would have passed any test of the button.
 */

const PATIENT = MOCK_PATIENTS[0];

const base = {
  patientId: PATIENT?.id ?? '',
  patientName: PATIENT?.name ?? '',
  patientMrn: PATIENT?.mrn ?? '',
  field: 'date-of-birth' as const,
  description: 'DOB is 1962-03-14 per the ID, not 1963-03-14.',
  reportedBy: 'Dr. Amelia Chen',
};

beforeEach(() => {
  __resetDataErrorReports();
});

describe('filing a data-error report', () => {
  it('records who reported what, and opens it', async () => {
    const report = await fileDataErrorReport(base);

    expect(report.id).toMatch(/^DER-/);
    expect(report.status).toBe('open');
    expect(report.reportedBy).toBe('Dr. Amelia Chen');
    expect(report.patientMrn).toBe(PATIENT?.mrn);
    expect(listDataErrorReports()).toHaveLength(1);
  });

  it('refuses a report with no description, storing nothing', async () => {
    // "The record is wrong" with no detail is a ticket closed unread —
    // the same nothing as the mailto this replaced.
    await expect(fileDataErrorReport({ ...base, description: '   ' })).rejects.toThrow(
      'DATA_ERROR_DESCRIPTION_REQUIRED',
    );
    expect(listDataErrorReports()).toEqual([]);
  });

  it('keeps reports to the patient they were filed against', async () => {
    await fileDataErrorReport(base);

    expect(openReportsForPatient(PATIENT?.id ?? '')).toHaveLength(1);
    expect(openReportsForPatient('PT-DOES-NOT-EXIST')).toEqual([]);
  });

  it('drops out of open work once resolved, without losing the row', async () => {
    const report = await fileDataErrorReport(base);
    resolveDataErrorReport(report.id);

    expect(openReportsForPatient(PATIENT?.id ?? '')).toEqual([]);
    // Still on record: an administrator's queue going green must not erase
    // who raised what.
    expect(listDataErrorReports()).toHaveLength(1);
    expect(listDataErrorReports()[0]?.status).toBe('resolved');
  });
});
