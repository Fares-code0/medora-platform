import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { envelope, json, stubApi } from '@/test/api-stub';

import { DEFAULT_FILTERS } from './model/types';
import { ReportsPage } from './pages/ReportsPage';

/**
 * Reports & Analytics in a live build: the page over the HTTP adapter (RM
 * M21's `/reports/*`, served on `backend`) with only the network stubbed.
 *
 * What matters is what the page refuses to claim: a filter the server does
 * not apply, a revenue chart without billing, a rename or favourite no route
 * keeps, a schedule that "delivers" when nothing is sent, or demo figures
 * labelled as the server's.
 */

vi.mock('./service', async () => {
  const { httpReportsService } = await import('./http/http-reports-service');
  return { reportsService: httpReportsService };
});

const toasts: { variant?: string; title: string; description?: string }[] = [];

vi.mock('@/app/providers', () => ({
  useAuth: () => ({
    user: { id: 'u-live', name: 'Amelia Chen', email: 'a.chen@clinic.example' },
  }),
  useToast: () => ({
    toast: (entry: { variant?: string; title: string; description?: string }) => {
      toasts.push(entry);
    },
  }),
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

beforeEach(() => {
  toasts.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const series = (name: string, tone: string, points: [string, number][] = []) => ({
  name,
  tone,
  points: points.map(([label, value]) => ({ label, value })),
});

const SNAPSHOT = envelope({
  category: 'overview',
  billingEnabled: false,
  range: { from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' },
  comparison: null,
  kpis: [
    {
      id: 'patients',
      label: 'Patients',
      value: 42,
      format: 'number',
      deltaPercent: 5,
      tone: 'primary',
      spark: [],
    },
  ],
  trend: [series('Patients', 'primary', [['W1', 10]]), series('Appointments', 'info', [['W1', 4]])],
  weekday: series('Appointments', 'primary', [['Mon', 3]]),
  departments: [{ label: 'Cardiology', value: 12, tone: 'chart1' }],
  labStatus: [],
  ageDistribution: series('Patients', 'info'),
  heatmap: { rows: ['Mon'], columns: ['Morning'], cells: [[2]], max: 2 },
  pharmacy: series('Prescriptions', 'warning'),
  messages: series('Messages', 'info'),
  aiUsage: series('AI threads', 'accent'),
  records: series('Records', 'secondary'),
});

const REVENUE_ALTERNATE = envelope({
  category: 'revenue',
  billingEnabled: false,
  alternate: 'top-visit-types',
  notice: 'Billing is not enabled for this clinic. Showing your most frequent visit types instead.',
  topVisitTypes: [{ label: 'Follow-up', value: 18 }],
  range: { from: '2026-10-01T00:00:00.000Z', to: '2026-11-01T00:00:00.000Z' },
});

const SAVED = {
  id: 'rep-1',
  name: 'Monthly overview',
  category: 'overview',
  range: 'month',
  favorite: false,
  createdAt: '2026-10-01T09:00:00.000Z',
  lastViewedAt: null,
  filters: DEFAULT_FILTERS,
};

const SCHEDULED = {
  id: 'sch-1',
  name: 'Weekly summary',
  category: 'overview',
  frequency: 'weekly',
  format: 'pdf',
  recipients: ['a.chen@clinic.example'],
  status: 'active',
  nextRunAt: '2026-11-01T09:15:00.000Z',
  history: [],
};

function routes(overrides: Record<string, () => unknown> = {}) {
  return {
    'GET /reports/analytics': () => SNAPSHOT,
    'GET /reports/insights': () => envelope([]),
    'GET /reports/saved': () => envelope([SAVED]),
    'GET /reports/scheduled': () => envelope([SCHEDULED]),
    ...overrides,
  };
}

function renderPage(path = '/doctor/reports') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <ReportsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const LOAD = { timeout: 5000 };

describe('Reports over the API', () => {
  it("labels the figures as the server's, never as demo analytics", async () => {
    stubApi(routes());
    renderPage();

    expect(
      await screen.findByText(/Computed by the Medora server/, undefined, LOAD),
    ).toBeInTheDocument();
    expect(screen.queryByText(/illustrative demo analytics/)).not.toBeInTheDocument();
    // The trend promises only the series the server sent.
    expect(screen.getByText('Patients · Appointments')).toBeInTheDocument();
  });

  it('offers only the filters the server applies, and says so', async () => {
    stubApi(routes());
    const user = userEvent.setup();
    renderPage('/doctor/reports?department=Cardiology');

    await screen.findByText(/Computed by the Medora server/, undefined, LOAD);
    // A department in the URL is not an applied filter: no chip for it.
    expect(screen.queryByText('Dept: Cardiology')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /filters/i }));
    const drawer = screen.getByRole('dialog', { name: 'Advanced filters' });
    expect(
      within(drawer).getByText(/filters these reports by age band and gender only/),
    ).toBeVisible();
    expect(within(drawer).queryByText('Department')).not.toBeInTheDocument();
    expect(within(drawer).queryByText('Lab test')).not.toBeInTheDocument();
    expect(within(drawer).getByText('Age band')).toBeInTheDocument();
    expect(within(drawer).getByText('Gender')).toBeInTheDocument();
  });

  it('shows revenue without billing as the server’s top visit types, with its notice', async () => {
    stubApi(routes({ 'GET /reports/analytics': () => REVENUE_ALTERNATE }));
    renderPage('/doctor/reports?category=revenue');

    expect(await screen.findByText('Top visit types', undefined, LOAD)).toBeInTheDocument();
    expect(screen.getByText(/Billing is not enabled for this clinic/)).toBeInTheDocument();
    expect(screen.queryByText(/Revenue shown in thousands/)).not.toBeInTheDocument();
  });

  it('offers no rename or favourite on a saved report, and names a refused delete', async () => {
    stubApi(
      routes({
        'DELETE /reports/saved/rep-1': () => json({ message: 'boom' }, 500),
      }),
    );
    const user = userEvent.setup();
    renderPage();

    await screen.findByText('Monthly overview', undefined, LOAD);
    await user.click(screen.getByRole('button', { name: 'Monthly overview options' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).queryByRole('menuitem', { name: 'Rename' })).not.toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: /favorite/i })).not.toBeInTheDocument();
    await user.click(within(menu).getByRole('menuitem', { name: 'Delete' }));

    await waitFor(() => {
      expect(toasts).toContainEqual(
        expect.objectContaining({ variant: 'error', title: 'Could not delete the report' }),
      );
    });
    expect(toasts.some((toast) => toast.variant === 'success')).toBe(false);
  });

  it('says a schedule is kept but not sent, and reads it in words', async () => {
    stubApi(routes());
    renderPage();

    expect(
      await screen.findByText(/reports are not sent yet/, undefined, LOAD),
    ).toBeInTheDocument();
    expect(
      await screen.findByText('Weekly · PDF · 1 recipient', undefined, LOAD),
    ).toBeInTheDocument();
    expect(screen.getByText(/not sent while delivery is unavailable/)).toBeInTheDocument();
  });

  it('pre-fills a new schedule with the signed-in doctor’s own address', async () => {
    stubApi(routes());
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'New schedule' }, LOAD));
    expect(screen.getByRole('textbox', { name: 'Recipients' })).toHaveValue(
      'a.chen@clinic.example',
    );
  });
});
