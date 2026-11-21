import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { PatientLabTrends } from '../model/trends';
import type { LabTest } from '../model/types';

import { AnalyteTrendDrawer } from './AnalyteTrendDrawer';

/**
 * The drawer plots what the port serves (API §8.8, `GET /patients/{id}/
 * lab-trends`), not what the screen behind it happened to load. Before, it
 * derived points from the loaded orders — a slice of the patient's history,
 * which on the detail page was a single order until the list arrived — and in
 * a live build its footnote still said "No laboratory system is connected".
 */

const getTrends =
  vi.fn<(patientId: string, analytes: readonly string[]) => Promise<PatientLabTrends>>();

vi.mock('../service', () => ({
  labService: {
    getTrends: (patientId: string, analytes: readonly string[]) => getTrends(patientId, analytes),
    capabilities: { annotations: false, transmits: true },
  },
}));

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
  getTrends.mockReset();
});

/** One loaded, completed order: it offers Potassium and carries one point. */
const LOADED: LabTest = {
  id: 'LAB-100030',
  patient: {
    id: 'PT-1004',
    name: 'Omar Farouk',
    mrn: '4472-90',
    age: 60,
    gender: 'male',
    bloodType: 'AB+',
    phone: '+20 101 662 7408',
  },
  testName: 'Basic metabolic panel',
  testCode: 'BMP',
  category: 'Chemistry',
  department: 'Internal Medicine',
  orderedBy: 'Dr. Amelia Chen',
  clinicalIndication: 'Follow-up',
  status: 'completed',
  priority: 'routine',
  requestedDate: '2026-10-01T08:00:00.000Z',
  collectedDate: '2026-10-01T08:00:00.000Z',
  completedDate: '2026-10-01T08:00:00.000Z',
  specimen: null,
  results: [
    {
      id: 'r-1',
      analyte: 'Potassium',
      value: '6.1',
      numericValue: 6.1,
      unit: 'mmol/L',
      referenceRange: { low: 3.5, high: 5.1, text: '3.5–5.1' },
      flag: 'critical-high',
    },
  ],
  interpretation: null,
  hasCriticalResult: true,
  review: null,
  attachments: [],
  annotations: [],
  timeline: [],
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
};

/** The patient's whole history, as served: two orders the screen never loaded. */
const SERVED: PatientLabTrends = {
  series: [
    {
      analyte: 'Potassium',
      unit: 'mmol/L',
      referenceLow: 3.5,
      referenceHigh: 5.1,
      referenceText: '3.5–5.1',
      points: [
        { labId: 'LAB-100010', at: '2026-08-01T08:00:00.000Z', value: 4.4, flag: 'normal' },
        { labId: 'LAB-100020', at: '2026-09-01T08:00:00.000Z', value: 5.0, flag: 'normal' },
        { labId: 'LAB-100030', at: '2026-10-01T08:00:00.000Z', value: 6.1, flag: 'critical-high' },
      ],
    },
  ],
  empty: [],
};

function renderDrawer() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <AnalyteTrendDrawer
        open
        onClose={() => undefined}
        tests={[LOADED]}
        patientId="PT-1004"
        patientName="Omar Farouk"
        initialAnalyte="Potassium"
      />
    </QueryClientProvider>,
  );
}

describe('AnalyteTrendDrawer over the port', () => {
  it('plots the patient’s served history, not just the orders on screen', async () => {
    getTrends.mockResolvedValue(SERVED);
    const user = userEvent.setup();
    renderDrawer();

    const drawer = await screen.findByRole('dialog');
    await user.click(await within(drawer).findByRole('button', { name: 'View as table' }));

    expect(getTrends).toHaveBeenCalledWith('PT-1004', ['Potassium']);
    const table = within(drawer).getByRole('table');
    expect(within(table).getByText('LAB-100010')).toBeInTheDocument();
    expect(within(table).getByText('LAB-100020')).toBeInTheDocument();
    expect(within(table).getByText('LAB-100030')).toBeInTheDocument();
  });

  it('says where the points come from without calling a connected laboratory a demo', async () => {
    getTrends.mockResolvedValue(SERVED);
    renderDrawer();

    expect(
      await screen.findByText(/released results from completed orders, as the laboratory service/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/No laboratory system is connected/)).not.toBeInTheDocument();
  });

  it('reports a failed read and plots nothing, then recovers on retry', async () => {
    getTrends.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(SERVED);
    const user = userEvent.setup();
    renderDrawer();

    expect(await screen.findByText("Couldn't load this trend")).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /over time/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Retry/ }));
    expect(await screen.findByRole('img', { name: /Potassium over time/ })).toBeInTheDocument();
  });

  it('names an analyte the server has nothing to plot for', async () => {
    getTrends.mockResolvedValue({ series: [], empty: ['Potassium'] });
    renderDrawer();

    expect(
      await screen.findByText('No released numeric result for Potassium.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /over time/ })).not.toBeInTheDocument();
  });
});
