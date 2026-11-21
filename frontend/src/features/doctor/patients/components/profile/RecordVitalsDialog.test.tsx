import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '@/app/providers';
import { MOCK_PATIENTS } from '@/features/shared-domain/patient-identity';

import { PatientProfilePage } from '../../pages/PatientProfilePage';
import { patientProfileService } from '../../service';

/** Recording vital signs from the Overview tab's vitals card. */

const LOAD = { timeout: 10_000 };

beforeAll(() => {
  const proto = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto['showModal'] = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  proto['close'] = function close(this: HTMLDialogElement) {
    this.open = false;
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const [patient] = MOCK_PATIENTS;
if (patient === undefined) throw new Error('empty roster');

function renderOverview() {
  return render(
    <MemoryRouter initialEntries={[`/doctor/patients/${patient!.id}`]}>
      <AppProviders>
        <Routes>
          <Route path="/doctor/patients/:patientId" element={<PatientProfilePage />} />
        </Routes>
      </AppProviders>
    </MemoryRouter>,
  );
}

const ENTRIES: readonly [RegExp, string][] = [
  [/^Systolic/, '142'],
  [/^Diastolic/, '91'],
  [/^Heart rate/, '88'],
  [/^Temperature/, '37.9'],
  [/^Respiratory rate/, '18'],
  [/^SpO₂/, '95'],
  [/^Weight/, '70'],
  [/^Height/, '170'],
];

async function openDialog() {
  await userEvent.click(await screen.findByRole('button', { name: 'Record vitals' }, LOAD));
  return screen.findByRole('dialog', { name: 'Record vital signs' });
}

describe('RecordVitalsDialog', () => {
  it('sends nothing while a reading is missing, and names what is missing', async () => {
    const record = vi.spyOn(patientProfileService, 'recordVitals');
    renderOverview();
    const dialog = await openDialog();

    for (const [label, value] of ENTRIES.slice(0, 7)) {
      await userEvent.type(within(dialog).getByLabelText(label), value);
    }
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record vitals' }));

    expect(within(dialog).getByText('Required')).toBeInTheDocument();
    expect(record).not.toHaveBeenCalled();
  });

  it('records a complete reading, which then becomes the card’s latest', async () => {
    const record = vi.spyOn(patientProfileService, 'recordVitals');
    renderOverview();
    const dialog = await openDialog();

    for (const [label, value] of ENTRIES) {
      await userEvent.type(within(dialog).getByLabelText(label), value);
    }
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record vitals' }));

    await waitFor(() =>
      expect(record).toHaveBeenCalledWith(patient.id, {
        systolic: 142,
        diastolic: 91,
        heartRate: 88,
        temperatureC: 37.9,
        respiratoryRate: 18,
        oxygenSaturation: 95,
        weightKg: 70,
        heightCm: 170,
      }),
    );
    expect(await screen.findByText('Vital signs recorded', undefined, LOAD)).toBeInTheDocument();
    expect(await screen.findByText('142/91 mmHg', undefined, LOAD)).toBeInTheDocument();
    // BMI is derived, never typed: 70 / 1.7² = 24.2.
    expect(screen.getByText('24.2')).toBeInTheDocument();
  });
});
