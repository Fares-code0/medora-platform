import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/app/providers/AuthProvider';
import { DoctorProfileProvider } from '@/app/providers/DoctorProfileProvider';
import { InterfaceSettingsProvider } from '@/app/providers/InterfaceSettingsProvider';
import { ToastProvider } from '@/app/providers/ToastProvider';
import { MOCK_PATIENTS } from '@/features/shared-domain/patient-identity';

import { patientProfileService } from '../service';

import { PatientProfilePage } from './PatientProfilePage';

const PATIENT_ID = MOCK_PATIENTS[0]?.id ?? '';

function renderProfile(search = '') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      {/* AppProviders supplies these in the app. The toast host is needed
          because since D-04 the Documents tab reports a refused file
          through it. */}
      <InterfaceSettingsProvider>
        <ToastProvider>
          <AuthProvider>
            <DoctorProfileProvider>
              <MemoryRouter initialEntries={[`/doctor/patients/${PATIENT_ID}${search}`]}>
                <Routes>
                  <Route path="/doctor/patients/:patientId" element={<PatientProfilePage />} />
                </Routes>
              </MemoryRouter>
            </DoctorProfileProvider>
          </AuthProvider>
        </ToastProvider>
      </InterfaceSettingsProvider>
    </QueryClientProvider>,
  );
}

describe('the patient record', () => {
  it('opens Overview from an unknown ?tab= deep link', async () => {
    renderProfile('?tab=not-a-tab');

    expect(await screen.findByRole('tab', { name: /Overview/ }, { timeout: 5000 })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });
});

/**
 * D-04, asserted through the page rather than the tab.
 *
 * `DocumentsTab.test.tsx` covers the component in both storage states, but
 * the fabricated PDF was never in the component — the page built it and
 * passed it down as `onView` / `onDownload`. A tab that refuses to render
 * an action is worth nothing if the page still hands it an exporter, so
 * this mounts the real record and checks the wiring that used to be wrong.
 */
describe('the Documents tab on the real record', () => {
  it('lists the files but offers no way to open one, and says why', async () => {
    renderProfile('?tab=documents');

    expect(
      await screen.findByText(/no document service is connected/i, undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^view$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^download / })).not.toBeInTheDocument();
  });
});

/**
 * D-07 in mock mode, where the admin patients area reads the same store:
 * the entry is offered. `live-data-error-report.test.tsx` is the other half
 * — no route, no entry.
 */
describe('flagging a data error in mock mode', () => {
  it('offers the action from the More menu', async () => {
    renderProfile();

    await userEvent.click(
      await screen.findByRole('button', { name: 'More profile actions' }, { timeout: 5000 }),
    );

    expect(await screen.findByRole('menuitem', { name: 'Flag a data error' })).toBeInTheDocument();
  });
});

/**
 * FE-10.2 — a tab's record is read only when the tab is opened. Server-side
 * every tab read is an audited `patient.tab_view`, so a chart that fetched
 * all its tabs on opening would log "read the notes" for a doctor who only
 * looked at the header.
 */
describe('lazy tab loading', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads no record-bearing tab on opening, and the notes only once Notes is opened', async () => {
    const getTab = vi.spyOn(patientProfileService, 'getTab');
    renderProfile();

    const notesTab = await screen.findByRole('tab', { name: /Notes/ }, { timeout: 5000 });
    expect(getTab).not.toHaveBeenCalled();

    await userEvent.click(notesTab);

    await waitFor(() => {
      expect(getTab).toHaveBeenCalledWith(PATIENT_ID, 'notes');
    });
    expect(getTab).toHaveBeenCalledTimes(1);
  });

  it('shows a failed tab as an error inside the tab, leaving the chart standing', async () => {
    vi.spyOn(patientProfileService, 'getTab').mockRejectedValue(new Error('boom'));
    renderProfile('?tab=history');

    expect(
      await screen.findByText("Couldn't load medical history", undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Overview/ })).toBeInTheDocument();
  });
});
