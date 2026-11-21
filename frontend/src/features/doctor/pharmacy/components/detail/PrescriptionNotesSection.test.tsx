import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '@/app/providers';

import { MOCK_PRESCRIPTIONS } from '../../model/mock-data';
import type { Prescription } from '../../model/types';
import { prescriptionService } from '../../service';

import { PrescriptionNotesSection } from './PrescriptionNotesSection';

/**
 * Adding a note to a prescription (API §7.10): pessimistic — the note joins
 * the list only from the server's answer — and a failure keeps what was typed.
 */

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const [seed] = MOCK_PRESCRIPTIONS;
if (seed === undefined) throw new Error('empty prescription seed');
const prescription: Prescription = { ...seed, notes: [] };

function renderSection() {
  return render(
    <MemoryRouter>
      <AppProviders>
        <PrescriptionNotesSection prescription={prescription} />
      </AppProviders>
    </MemoryRouter>,
  );
}

describe('PrescriptionNotesSection — adding a note', () => {
  it('sends the trimmed note and confirms only once the server has it', async () => {
    let resolve: (value: Prescription) => void = () => {};
    const add = vi
      .spyOn(prescriptionService, 'addNote')
      .mockImplementation(() => new Promise((done) => (resolve = done)));
    renderSection();

    await userEvent.click(screen.getByRole('button', { name: 'Add note' }));
    const save = screen.getByRole('button', { name: 'Save note' });
    expect(save).toBeDisabled();

    await userEvent.type(screen.getByLabelText('New note'), '  Recheck potassium in a week. ');
    await userEvent.click(save);

    await waitFor(() =>
      expect(add).toHaveBeenCalledWith(
        expect.objectContaining({
          prescriptionId: prescription.id,
          body: 'Recheck potassium in a week.',
        }),
      ),
    );
    expect(screen.queryByText('Note added')).not.toBeInTheDocument();

    resolve(prescription);
    expect(await screen.findByText('Note added')).toBeInTheDocument();
  });

  it('keeps the text and says why when the note is not saved', async () => {
    vi.spyOn(prescriptionService, 'addNote').mockRejectedValue(new Error('Prescription locked'));
    renderSection();

    await userEvent.click(screen.getByRole('button', { name: 'Add note' }));
    await userEvent.type(screen.getByLabelText('New note'), 'Hold if dizzy.');
    await userEvent.click(screen.getByRole('button', { name: 'Save note' }));

    expect(await screen.findByText('The note was not saved')).toBeInTheDocument();
    expect(screen.getByText('Prescription locked')).toBeInTheDocument();
    expect(screen.getByLabelText('New note')).toHaveValue('Hold if dizzy.');
    expect(screen.queryByText('Note added')).not.toBeInTheDocument();
  });
});
