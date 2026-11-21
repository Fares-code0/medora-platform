import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mockPrescriptionService } from '../../mock/mock-prescription-service';
import { MEDICATION_CATALOGUE } from '../../model/catalogue';
import { prescriptionService } from '../../service';

import { MedicationStep } from './MedicationStep';

// In tests the service is the mock adapter itself, so a bare `spyOn` calls
// through to its real search.

/**
 * D-18's typeahead. Typing two or more characters asks the port for the
 * formulary entries whose brand or generic name contains them
 * (`GET /medications?q=` live) and narrows the list to those. A failed search
 * filters nothing and says so; a selected medication is never hidden by a
 * search that does not match it.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

const VALID = { step: 'medication' as const, issues: [], valid: true };

function renderStep(genericName: string | null = null) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return render(
    <MedicationStep
      formulary={MEDICATION_CATALOGUE}
      source="demo-formulary"
      monographs={false}
      genericName={genericName}
      strength={null}
      onSelectMedication={vi.fn()}
      onSelectStrength={vi.fn()}
      validation={VALID}
      showIssues={false}
    />,
    { wrapper },
  );
}

const medicationList = () => screen.getByRole('radiogroup', { name: /Medication/ });
const radioNames = () =>
  within(medicationList())
    .getAllByRole('radio')
    .map((radio) => radio.getAttribute('value'));

describe('the medication typeahead', () => {
  it('narrows the list to the server’s matches, by brand or generic name', async () => {
    const search = vi.spyOn(prescriptionService, 'searchMedications');
    const user = userEvent.setup();
    renderStep();
    expect(radioNames()).toHaveLength(MEDICATION_CATALOGUE.length);

    await user.type(screen.getByLabelText('Search the formulary'), 'lipi');

    await vi.waitFor(() => expect(radioNames()).toEqual(['Atorvastatin']));
    expect(search).toHaveBeenLastCalledWith('lipi');
  });

  it('does not search on one character, and says why', async () => {
    const search = vi.spyOn(prescriptionService, 'searchMedications');
    const user = userEvent.setup();
    renderStep();

    await user.type(screen.getByLabelText('Search the formulary'), 'w');

    expect(await screen.findByText('Type at least 2 characters to search.')).toBeInTheDocument();
    expect(search).not.toHaveBeenCalled();
    expect(radioNames()).toHaveLength(MEDICATION_CATALOGUE.length);
  });

  it('names a search with no match instead of showing an empty list', async () => {
    vi.spyOn(prescriptionService, 'searchMedications').mockResolvedValue([]);
    const user = userEvent.setup();
    renderStep();

    await user.type(screen.getByLabelText('Search the formulary'), 'zzz');

    expect(
      await screen.findByText('No medication in the formulary matches “zzz”.'),
    ).toBeInTheDocument();
  });

  it('keeps a selected medication on screen when the search does not match it', async () => {
    const user = userEvent.setup();
    renderStep('Warfarin');

    await user.type(screen.getByLabelText('Search the formulary'), 'lipi');

    await vi.waitFor(() => expect(radioNames()).toEqual(['Warfarin', 'Atorvastatin']));
  });

  it('filters nothing when the search fails, says so, and retries', async () => {
    const search = vi
      .spyOn(prescriptionService, 'searchMedications')
      .mockRejectedValueOnce(Object.assign(new Error('down'), { kind: 'server' }));
    const user = userEvent.setup();
    renderStep();

    await user.type(screen.getByLabelText('Search the formulary'), 'lipi');

    expect(await screen.findByText('The search could not be completed')).toBeInTheDocument();
    expect(radioNames()).toHaveLength(MEDICATION_CATALOGUE.length);

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await vi.waitFor(() => expect(radioNames()).toEqual(['Atorvastatin']));
    expect(search).toHaveBeenCalledTimes(2);
  });
});

describe('the mock search follows the server’s rule', () => {
  it('matches brand or generic name, in any case', async () => {
    await expect(mockPrescriptionService.searchMedications('COUM')).resolves.toMatchObject([
      { genericName: 'Warfarin' },
    ]);
    await expect(mockPrescriptionService.searchMedications('metf')).resolves.toMatchObject([
      { genericName: 'Metformin' },
    ]);
  });
});
