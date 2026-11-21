import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '@/app/providers';

import { MOCK_PRESCRIPTIONS } from '../model/mock-data';
import { prescriptionService } from '../service';

import { PharmacyPage } from './PharmacyPage';

/**
 * The prescription list over the seam (FE-10.6): loading, success, empty and
 * error — and a failed load is never shown as an empty pharmacy.
 */

const LOAD = { timeout: 10_000 };

afterEach(() => {
  vi.restoreAllMocks();
});

function renderList() {
  return render(
    <MemoryRouter initialEntries={['/doctor/pharmacy']}>
      <AppProviders>
        <PharmacyPage />
      </AppProviders>
    </MemoryRouter>,
  );
}

describe('PharmacyPage', () => {
  it('shows a loading state while the prescriptions are on their way', () => {
    vi.spyOn(prescriptionService, 'listPrescriptions').mockReturnValue(
      new Promise(() => undefined),
    );
    renderList();

    expect(screen.queryByText('No prescriptions yet')).not.toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('lists what the service returns', async () => {
    const [first] = MOCK_PRESCRIPTIONS;
    if (first === undefined) throw new Error('fixture');
    vi.spyOn(prescriptionService, 'listPrescriptions').mockResolvedValue([first]);
    renderList();

    expect((await screen.findAllByText(first.id, undefined, LOAD)).length).toBeGreaterThan(0);
  });

  it('says there are none when there are none', async () => {
    vi.spyOn(prescriptionService, 'listPrescriptions').mockResolvedValue([]);
    renderList();

    expect(await screen.findByText('No prescriptions yet', undefined, LOAD)).toBeInTheDocument();
  });

  it('reports a failed load as an error — not as an empty pharmacy', async () => {
    vi.spyOn(prescriptionService, 'listPrescriptions').mockRejectedValue(
      Object.assign(new Error('API error: server'), { kind: 'server', ref: 'x' }),
    );
    renderList();

    expect(await screen.findByText(/Couldn.t load/, undefined, LOAD)).toBeInTheDocument();
    expect(screen.queryByText('No prescriptions yet')).not.toBeInTheDocument();
  });
});
