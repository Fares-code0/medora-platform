import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { MEDICATION_CATALOGUE, type MedicationMonograph } from '../../model/catalogue';
import { prescriptionService } from '../../service';

import { MedicationStep } from './MedicationStep';

/**
 * The monograph half of D-18 (API §7.2). Offered only where the formulary
 * serves monographs, fetched only when asked for, and honest about what the
 * source does not record — an unrecorded section is never a blank one.
 */

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
});

const VALID = { step: 'medication' as const, issues: [], valid: true };
const [first] = MEDICATION_CATALOGUE;
if (first === undefined) throw new Error('empty demo catalogue');

function renderStep(monographs: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MedicationStep
        formulary={MEDICATION_CATALOGUE}
        source="clinical-service"
        monographs={monographs}
        genericName={first?.genericName ?? null}
        strength={null}
        onSelectMedication={vi.fn()}
        onSelectStrength={vi.fn()}
        validation={VALID}
        showIssues={false}
      />
    </QueryClientProvider>,
  );
}

function monograph(overrides: Partial<MedicationMonograph> = {}): MedicationMonograph {
  return {
    medicationId: first?.id ?? '',
    name: first?.name ?? '',
    genericName: first?.genericName ?? '',
    indications: 'Bacterial infections of the respiratory tract.',
    contraindications: null,
    standardDosing: '500 mg every 8 hours.',
    pregnancyCategory: 'B',
    warnings: null,
    sideEffects: 'Rash, diarrhoea.',
    ...overrides,
  };
}

describe('the medication monograph', () => {
  it('is not offered where the formulary serves none — and nothing is fetched', () => {
    const get = vi.spyOn(prescriptionService, 'getMonograph');
    renderStep(false);

    expect(screen.queryByRole('button', { name: /View monograph/ })).not.toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it('fetches only when opened, for the selected medication, and names what is not recorded', async () => {
    const get = vi.spyOn(prescriptionService, 'getMonograph').mockResolvedValue(monograph());
    renderStep(true);
    expect(get).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole('button', { name: `View monograph for ${first.name}` }));

    const drawer = await screen.findByRole('dialog', { name: `${first.name} — monograph` });
    expect(await within(drawer).findByText('500 mg every 8 hours.')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith(first.id);
    // Contraindications and warnings are null: said in words, never blank.
    expect(within(drawer).getAllByText('Not recorded in the formulary.')).toHaveLength(2);
  });

  it('says there is no monograph on file when the formulary holds none', async () => {
    vi.spyOn(prescriptionService, 'getMonograph').mockResolvedValue(null);
    renderStep(true);

    await userEvent.click(screen.getByRole('button', { name: /View monograph/ }));

    expect(await screen.findByText('No monograph on file')).toBeInTheDocument();
  });

  it('reports a failed load as a failure with a retry, not as "no monograph"', async () => {
    const get = vi
      .spyOn(prescriptionService, 'getMonograph')
      .mockRejectedValue(Object.assign(new Error('API error: server'), { kind: 'server' }));
    renderStep(true);

    await userEvent.click(screen.getByRole('button', { name: /View monograph/ }));

    expect(await screen.findByText("Couldn't load the monograph")).toBeInTheDocument();
    expect(screen.queryByText('No monograph on file')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Retry|Try again/ }));
    expect(get.mock.calls.length).toBeGreaterThan(1);
  });
});
