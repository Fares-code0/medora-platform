import { beforeEach, describe, expect, it } from 'vitest';

import {
  __resetDataErrorReports,
  fileDataErrorReport,
  resolveDataErrorReport,
} from '@/features/shared-domain/data-error-reports';
import { MOCK_PATIENTS } from '@/features/shared-domain/patient-identity';

import { patientsApi } from './api/patients.api';

/**
 * D-07's actual claim: "flag data error → **routed to admin**".
 *
 * The row was blocked on "no admin queue to route it to". That stopped
 * being true when Phase C shipped ADM-01's action queue, and this side
 * already had the vocabulary — `SupportFlagKind` includes
 * `'data-correction'`, seeded on a couple of accounts with nothing
 * producing one.
 *
 * The test lives here rather than beside the store because the dependency
 * runs one way: admin may read `shared-domain`, `shared-domain` may not
 * read admin (§3.3, enforced by `import/no-restricted-paths`). It asserts
 * arrival, not the button — what this replaced was a `mailto:`, which would
 * have passed any test of the button.
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
  window.localStorage.clear();
});

describe('the route to the administrator', () => {
  it('arrives as open work on that patient’s admin account', async () => {
    const before = await patientsApi.list();
    const accountBefore = before.patients.find((p) => p.id === PATIENT?.id);
    const flagsBefore = accountBefore?.flags.length ?? 0;

    await fileDataErrorReport(base);

    const after = await patientsApi.list();
    const account = after.patients.find((p) => p.id === PATIENT?.id);

    expect(account?.flags).toHaveLength(flagsBefore + 1);
    const added = account?.flags.find((flag) => flag.id.startsWith('DER-'));
    expect(added?.kind).toBe('data-correction');
    // The doctor's own words reach the administrator, with the field named
    // first so they know what to correct before reading the prose.
    expect(added?.summary).toContain('Date of birth');
    expect(added?.summary).toContain('1962-03-14');
    expect(added?.summary).toContain('Dr. Amelia Chen');
  });

  it('leaves the queue alone once the report is resolved', async () => {
    const report = await fileDataErrorReport(base);
    resolveDataErrorReport(report.id);

    const document = await patientsApi.list();
    const account = document.patients.find((p) => p.id === PATIENT?.id);

    expect(account?.flags.some((flag) => flag.id === report.id)).toBe(false);
  });
});
