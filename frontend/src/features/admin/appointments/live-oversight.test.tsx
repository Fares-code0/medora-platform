import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { envelope, json, pageOf, stubApi } from '@/test/api-stub';

import { PhiAccessProvider } from '../phi';

import { AppointmentOversightSection } from './AppointmentOversightSection';

/**
 * Appointment oversight in a live build (FE-10.10): the section over the
 * HTTP adapter, with only the network stubbed.
 */

vi.mock('./api/service', async () => {
  const { httpOversightService } = await import('./http/http-oversight-service');
  return { oversightService: httpOversightService };
});

const toasts: { variant?: string; title: string; description?: string }[] = [];

vi.mock('@/app/providers', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Marcus Reed', email: 'admin@medora.health' } }),
  useCan: () => () => true,
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

const LOAD = { timeout: 5_000 };
const HOUR = 3_600_000;

function rowView(overrides: Record<string, unknown> = {}) {
  return {
    id: 'APT-10001',
    reference: 'APT-10001',
    startsAt: new Date(Date.now() + 24 * HOUR).toISOString(),
    durationMin: 30,
    visitType: 'Consultation',
    department: 'Cardiology',
    specialty: 'Cardiology',
    doctorId: 'doc-1',
    doctorName: 'Dr. Omar Khalil',
    patientId: 'PT-1003',
    status: 'confirmed',
    stateSince: new Date(Date.now() - 2 * HOUR).toISOString(),
    ageInStateHours: 2,
    rescheduleCount: 0,
    lastNudgedAt: null,
    flags: [],
    ...overrides,
  };
}

function doctorView(id: string, fullName: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    fullName,
    title: null,
    specialty: 'Cardiology',
    departmentName: 'Cardiology',
    licenseNumber: 'CA-1',
    licenseExpiresOn: null,
    professionalCategory: null,
    verificationStatus: 'verified',
    practiceStatus: 'active',
    ratingAvg: null,
    lastActiveAt: null,
    joinedAt: '2026-01-01T00:00:00.000Z',
    patientsCount: 0,
    appointments30d: 0,
    ...overrides,
  };
}

const SUMMARY = {
  today: 4,
  pending: 1,
  upcoming: 9,
  completedThisWeek: 3,
  pendingOverDay: 0,
  cancellationRate7d: 0.125,
  noShowRate7d: 0,
  window7dTotal: 8,
};

function routes(overrides: Record<string, Parameters<typeof stubApi>[0][string]> = {}) {
  return stubApi({
    'GET /admin/appointments': () => pageOf([rowView()]),
    'GET /admin/appointments/summary': () => envelope(SUMMARY),
    'GET /doctors': () =>
      pageOf([doctorView('doc-1', 'Dr. Omar Khalil'), doctorView('doc-2', 'Dr. Salma Ibrahim')]),
    ...overrides,
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/admin/appointments']}>
        <PhiAccessProvider>
          <AppointmentOversightSection />
        </PhiAccessProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('live appointment oversight', () => {
  it('lists the server’s book with the patient withheld, and the server’s KPIs', async () => {
    routes();
    renderPage();

    const table = await screen.findByRole(
      'table',
      { name: /Appointments across every doctor/ },
      LOAD,
    );
    expect(within(table).getByText('APT-10001')).toBeInTheDocument();
    expect(within(table).getByText('Withheld')).toBeInTheDocument();
    // The cancellation rate is the server's fraction, as a percent.
    expect(screen.getByText('12.5')).toBeInTheDocument();
    expect(screen.getAllByText('of 8 in the last 7 days', { exact: false })).toHaveLength(2);
  });

  it('says the history is not served instead of drawing an empty one', async () => {
    routes();
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Actions for APT-10001' }, LOAD));
    await user.click(screen.getByRole('menuitem', { name: 'View detail' }));
    expect(
      await screen.findByText(/does not send an appointment's event history/),
    ).toBeInTheDocument();
    expect(screen.queryByText('Event history')).not.toBeInTheDocument();
  });

  it('shows an error state, not a demo book, when the book cannot be read', async () => {
    routes({ 'GET /admin/appointments': () => json({ code: 'internal', ref: 'E' }, 500) });
    renderPage();
    expect(
      await screen.findByText("Couldn't load this section", undefined, LOAD),
    ).toBeInTheDocument();
    expect(screen.queryByText('APT-2418')).not.toBeInTheDocument();
  });

  it('says so when nothing is on the books', async () => {
    routes({ 'GET /admin/appointments': () => pageOf([]) });
    renderPage();
    expect(
      await screen.findByText('No appointments match these filters.', undefined, LOAD),
    ).toBeInTheDocument();
  });

  it('keeps the reassign dialog open on the server’s refusal, holding its words', async () => {
    const { requests } = routes({
      'POST /admin/appointments/APT-10001/reassign': () =>
        json(
          {
            code: 'conflict',
            message: 'Conflict',
            detail: 'Dr. Salma Ibrahim already has an appointment at that time',
          },
          409,
        ),
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Actions for APT-10001' }, LOAD));
    await user.click(screen.getByRole('menuitem', { name: 'Reassign' }));
    const dialog = await screen.findByRole('dialog', undefined, LOAD);
    const target = within(dialog).getByRole('radio', { name: /Dr. Salma Ibrahim/ });
    expect(within(dialog).getByText(/capacity checked when you confirm/)).toBeInTheDocument();
    await user.click(target);
    await user.type(
      within(dialog).getByLabelText('Why is this being moved?'),
      'Dr. Khalil is on emergency cover until Thursday.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Reassign and notify' }));

    expect(
      await within(dialog).findByText('Dr. Salma Ibrahim already has an appointment at that time.'),
    ).toBeInTheDocument();
    expect(requests.find((request) => request.method === 'POST')?.body).toEqual({
      doctorId: 'doc-2',
      reason: 'Dr. Khalil is on emergency cover until Thursday.',
    });
    await waitFor(() => expect(toasts[0]?.title).toBe('Reassignment failed'));
  });

  it('reassigns, names the receiving doctor, and re-reads the book', async () => {
    let moved = false;
    const { requests } = routes({
      'GET /admin/appointments': () =>
        pageOf([rowView(moved ? { doctorId: 'doc-2', doctorName: 'Dr. Salma Ibrahim' } : {})]),
      'POST /admin/appointments/APT-10001/reassign': () => {
        moved = true;
        return envelope(rowView({ doctorId: 'doc-2', doctorName: 'Dr. Salma Ibrahim' }));
      },
    });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Actions for APT-10001' }, LOAD));
    await user.click(screen.getByRole('menuitem', { name: 'Reassign' }));
    const dialog = await screen.findByRole('dialog', undefined, LOAD);
    await user.click(within(dialog).getByRole('radio', { name: /Dr. Salma Ibrahim/ }));
    await user.type(
      within(dialog).getByLabelText('Why is this being moved?'),
      'Dr. Khalil is on emergency cover until Thursday.',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Reassign and notify' }));

    await waitFor(() =>
      expect(toasts[0]).toMatchObject({
        title: 'APT-10001 reassigned',
        description: expect.stringContaining('Dr. Salma Ibrahim') as unknown,
      }),
    );
    await waitFor(() =>
      expect(
        requests.filter((request) => request.path === '/admin/appointments/summary'),
      ).toHaveLength(2),
    );
  });
});
