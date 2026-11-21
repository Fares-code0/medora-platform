import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '@/app/providers';

import type { MedicalRecordSummary } from '../model/types';
import { recordService } from '../service';

import { MedicalRecordsPage } from './MedicalRecordsPage';

/**
 * The records list over the seam (FE-10.5): the four states a live list can
 * be in, and the one rule that matters most for a clinical screen — a failed
 * load is an error, never an empty (or a fake) list.
 */

const LOAD = { timeout: 10_000 };

afterEach(() => {
  vi.restoreAllMocks();
});

const ROW: MedicalRecordSummary = {
  id: 'MR-10001',
  patient: {
    id: 'PT-1003',
    name: 'Amira Saleh',
    mrn: '4468-12',
    age: 34,
    gender: 'female',
    bloodType: 'B+',
    phone: '+20 122 574 9911',
  },
  visitDate: '2026-10-04T00:00:00.000Z',
  visitType: 'Consultation',
  department: 'General Medicine',
  doctor: 'Dr. Amelia Chen',
  status: 'draft',
  priority: 'normal',
  diagnoses: [{ code: 'R51.9', label: 'Headache, unspecified', isPrimary: true }],
  chiefComplaint: 'Headache for three days',
  followUpDate: null,
  createdAt: '2026-10-04T17:04:24.507Z',
  updatedAt: '2026-10-04T17:04:24.507Z',
};

function renderList(search = '') {
  return render(
    <MemoryRouter initialEntries={[`/doctor/medical-records${search}`]}>
      <AppProviders>
        <MedicalRecordsPage />
      </AppProviders>
    </MemoryRouter>,
  );
}

describe('MedicalRecordsPage', () => {
  it('shows a loading state while the records are on their way', () => {
    vi.spyOn(recordService, 'listRecords').mockReturnValue(new Promise(() => undefined));
    renderList();

    expect(screen.queryByText('No medical records yet')).not.toBeInTheDocument();
    expect(screen.queryByText('Amira Saleh')).not.toBeInTheDocument();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
  });

  it('lists what the service returns', async () => {
    vi.spyOn(recordService, 'listRecords').mockResolvedValue([ROW]);
    renderList();

    expect((await screen.findAllByText('Amira Saleh', undefined, LOAD)).length).toBeGreaterThan(0);
    expect(screen.getAllByText('MR-10001').length).toBeGreaterThan(0);
  });

  it('says there are none when there are none', async () => {
    vi.spyOn(recordService, 'listRecords').mockResolvedValue([]);
    renderList();

    expect(await screen.findByText('No medical records yet', undefined, LOAD)).toBeInTheDocument();
  });

  it('reports a failed load as an error, with a retry — not as an empty list', async () => {
    const list = vi
      .spyOn(recordService, 'listRecords')
      .mockRejectedValue(
        Object.assign(new Error('API error: server'), { kind: 'server', ref: 'x' }),
      );
    renderList();

    const alert = await screen.findByText("Couldn't load medical records", undefined, LOAD);
    expect(alert).toBeInTheDocument();
    expect(screen.queryByText('No medical records yet')).not.toBeInTheDocument();

    list.mockResolvedValue([ROW]);
    const region = alert.closest('div')?.parentElement ?? document.body;
    await userEvent.click(within(region).getByRole('button', { name: /Retry|Try again/ }));
    expect((await screen.findAllByText('Amira Saleh', undefined, LOAD)).length).toBeGreaterThan(0);
  });

  it('names a deep-linked patient filter from the records it holds', async () => {
    vi.spyOn(recordService, 'listRecords').mockResolvedValue([ROW]);
    renderList('?patient=PT-1003');

    expect(await screen.findByText('Patient: Amira Saleh', undefined, LOAD)).toBeInTheDocument();
  });
});
