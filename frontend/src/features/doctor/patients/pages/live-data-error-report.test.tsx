import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { AppProviders } from '@/app/providers';
import type * as Service from '@/features/shared-domain/data-error-reports/service';
import { MOCK_PATIENTS } from '@/features/shared-domain/patient-identity';


import { PatientProfilePage } from './PatientProfilePage';

/**
 * D-07 with the live capability. A live build has no patient-level report
 * route, so "Flag a data error" would file into a demo store and announce
 * "it is now in the administrators' queue" for a report nobody can read.
 * The entry must be absent, not merely fail on submit.
 */

vi.mock('@/features/shared-domain/data-error-reports/service', async (importOriginal) => {
  const actual: typeof Service = await importOriginal();
  return { ...actual, dataErrorReportService: actual.unconnectedDataErrorReportService };
});

const PATIENT_ID = MOCK_PATIENTS[0]?.id ?? '';

describe('the patient record with no data-error route', () => {
  it('offers no "Flag a data error" action', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={[`/doctor/patients/${PATIENT_ID}`]}>
        <AppProviders>
          <Routes>
            <Route path="/doctor/patients/:patientId" element={<PatientProfilePage />} />
          </Routes>
        </AppProviders>
      </MemoryRouter>,
    );

    await user.click(
      await screen.findByRole('button', { name: 'More profile actions' }, { timeout: 5000 }),
    );

    expect(await screen.findByRole('menuitem', { name: 'Print summary' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Flag a data error' })).not.toBeInTheDocument();
  });
});
