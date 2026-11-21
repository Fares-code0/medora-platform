import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '@/app/providers';
import { MOCK_PATIENTS } from '@/features/shared-domain/patient-identity';

import { PatientProfilePage } from '../../pages/PatientProfilePage';
import { patientProfileService } from '../../service';

/**
 * Recording an allergy from the chart's Allergies tab: severity is never
 * defaulted, a duplicate is refused in place, and the row appears only once
 * the service has it.
 */

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

const patient = MOCK_PATIENTS.find((candidate) => candidate.allergies.length > 0);
if (patient === undefined) throw new Error('no seeded patient with an allergy');
const [seededAllergen] = patient.allergies;

function renderAllergies() {
  return render(
    <MemoryRouter initialEntries={[`/doctor/patients/${patient!.id}?tab=allergies`]}>
      <AppProviders>
        <Routes>
          <Route path="/doctor/patients/:patientId" element={<PatientProfilePage />} />
        </Routes>
      </AppProviders>
    </MemoryRouter>,
  );
}

async function openDialog() {
  await userEvent.click(await screen.findByRole('button', { name: 'Record allergy' }, LOAD));
  return screen.findByRole('dialog', { name: 'Record an allergy' });
}

describe('RecordAllergyDialog', () => {
  it('will not record without an explicit severity, and sends nothing until it is chosen', async () => {
    const add = vi.spyOn(patientProfileService, 'addAllergy');
    renderAllergies();
    const dialog = await openDialog();

    await userEvent.type(within(dialog).getByLabelText(/^Allergen/), 'Latex');
    await userEvent.type(within(dialog).getByLabelText(/^Reaction/), 'Contact dermatitis');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record allergy' }));

    expect(within(dialog).getByText('Choose a severity')).toBeInTheDocument();
    expect(add).not.toHaveBeenCalled();
  });

  it('refuses an allergen already on the chart before it reaches the service', async () => {
    const add = vi.spyOn(patientProfileService, 'addAllergy');
    renderAllergies();
    const dialog = await openDialog();

    await userEvent.type(
      within(dialog).getByLabelText(/^Allergen/),
      (seededAllergen ?? '').toLowerCase(),
    );
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Mild' }));
    await userEvent.type(within(dialog).getByLabelText(/^Reaction/), 'Rash');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record allergy' }));

    expect(within(dialog).getByText(/is already on this chart$/)).toBeInTheDocument();
    expect(add).not.toHaveBeenCalled();
  });

  it('records through the service and shows the row only once it is held', async () => {
    const add = vi.spyOn(patientProfileService, 'addAllergy');
    renderAllergies();
    const dialog = await openDialog();

    await userEvent.type(within(dialog).getByLabelText(/^Allergen/), 'Shellfish');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Severe' }));
    await userEvent.type(within(dialog).getByLabelText(/^Reaction/), 'Throat swelling');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record allergy' }));

    await waitFor(() =>
      expect(add).toHaveBeenCalledWith(patient.id, {
        allergen: 'Shellfish',
        severity: 'severe',
        reaction: 'Throat swelling',
        notes: '',
      }),
    );
    expect(await screen.findByText('Shellfish recorded', undefined, LOAD)).toBeInTheDocument();
    expect(await screen.findByRole('cell', { name: 'Shellfish' }, LOAD)).toBeInTheDocument();
  });

  it('keeps the form and names the conflict when the server refuses a duplicate', async () => {
    vi.spyOn(patientProfileService, 'addAllergy').mockRejectedValue(
      Object.assign(new Error('API error: conflict'), {
        kind: 'conflict',
        code: 'conflict',
        detail: 'That allergen is already recorded for this patient',
      }),
    );
    renderAllergies();
    const dialog = await openDialog();

    await userEvent.type(within(dialog).getByLabelText(/^Allergen/), 'Peanuts');
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Moderate' }));
    await userEvent.type(within(dialog).getByLabelText(/^Reaction/), 'Hives');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Record allergy' }));

    expect(
      await within(dialog).findByText('That allergen is already recorded for this patient'),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Allergen/)).toHaveValue('Peanuts');
    expect(screen.queryByText('Peanuts recorded')).not.toBeInTheDocument();
  });
});
