import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { envelope, json, pageOf, stubApi } from '@/test/api-stub';

import { DoctorProfilePage } from './DoctorProfilePage';
import { DoctorsSection } from './DoctorsSection';
import { __resetHttpDoctorTicks } from './http/http-doctors-service';

/**
 * Doctors management in a live build (FE-10.10): the screens over the HTTP
 * adapter, with only the network stubbed. What matters here is what the
 * screens refuse to do — show a seeded doctor, offer an action the API does
 * not serve, or paper over a refusal — as much as what they show.
 */

vi.mock('./api/service', async () => {
  const { httpDoctorsService } = await import('./http/http-doctors-service');
  return { doctorsService: httpDoctorsService };
});

vi.mock('../appointments/api/service', async () => {
  const { httpOversightService } = await import('../appointments/http/http-oversight-service');
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
  __resetHttpDoctorTicks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const LOAD = { timeout: 5_000 };
const ID = 'doc-uuid-1';

function summaryView(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    fullName: 'Dr. Laila Mansour',
    title: null,
    specialty: 'Dermatology',
    departmentName: null,
    licenseNumber: 'DE-1',
    licenseExpiresOn: null,
    professionalCategory: null,
    verificationStatus: 'pending',
    practiceStatus: 'active',
    ratingAvg: null,
    lastActiveAt: null,
    joinedAt: '2026-09-10T08:00:00.000Z',
    patientsCount: 0,
    appointments30d: 0,
    ...overrides,
  };
}

function documentView(kind: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `vdoc-${kind}`,
    kind,
    fileId: `file-${kind}`,
    uploadedAt: '2026-09-11T08:00:00.000Z',
    expiresOn: null,
    decision: 'pending',
    decidedAt: null,
    rejectReason: null,
    checks: { authentic: false, current: false, identityMatch: false },
    ...overrides,
  };
}

function detailView(overrides: Record<string, unknown> = {}) {
  return {
    ...summaryView(),
    contactEmail: 'laila.mansour@medora.health',
    contactPhone: '+20 100 000 0001',
    officeLocation: null,
    officeHours: null,
    biography: null,
    yearsOfExperience: 3,
    languages: ['Arabic'],
    education: [],
    certifications: [],
    skills: [],
    employeeId: null,
    verifiedAt: null,
    documents: [documentView('degree_certificate')],
    affectedAppointments: 0,
    verifiable: false,
    ...overrides,
  };
}

function tree(children: ReactNode, url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/admin/doctors" element={children} />
          <Route path="/admin/doctors/:doctorId" element={children} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('the live roster', () => {
  it('shows a loading state, then the server’s doctors and none of the demo ones', async () => {
    stubApi({ 'GET /doctors': () => pageOf([summaryView()]) });
    tree(<DoctorsSection />, '/admin/doctors');

    expect(screen.queryByText('Dr. Laila Mansour')).not.toBeInTheDocument();
    expect(await screen.findByText('Dr. Laila Mansour', undefined, LOAD)).toBeInTheDocument();
    expect(screen.queryByText('Dr. Youssef Nabil')).not.toBeInTheDocument();
    expect(screen.getByText('Not yet rated')).toBeInTheDocument();
  });

  it('offers no doctor invitation and no access reset — the API serves neither', async () => {
    stubApi({ 'GET /doctors': () => pageOf([summaryView()]) });
    const user = userEvent.setup();
    tree(<DoctorsSection />, '/admin/doctors');
    await screen.findByText('Dr. Laila Mansour', undefined, LOAD);

    expect(screen.queryByRole('button', { name: 'Invite doctor' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Actions for Dr. Laila Mansour' }));
    expect(screen.queryByRole('menuitem', { name: 'Send access reset' })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Review verification' })).toBeInTheDocument();
  });

  it('says so when there are no doctors', async () => {
    stubApi({ 'GET /doctors': () => pageOf([]) });
    tree(<DoctorsSection />, '/admin/doctors');
    expect(
      await screen.findByText('No doctors match these filters.', undefined, LOAD),
    ).toBeInTheDocument();
  });

  it('shows an error, not an empty or demo roster, when the read fails', async () => {
    stubApi({ 'GET /doctors': () => json({ code: 'internal', ref: 'ERR-1' }, 500) });
    tree(<DoctorsSection />, '/admin/doctors');
    expect(
      await screen.findByText("Couldn't load this section", undefined, LOAD),
    ).toBeInTheDocument();
    expect(screen.queryByText('Dr. Youssef Nabil')).not.toBeInTheDocument();
  });

  it('explains a refused permission rather than offering a useless retry story', async () => {
    stubApi({ 'GET /doctors': () => json({ code: 'forbidden' }, 403) });
    tree(<DoctorsSection />, '/admin/doctors');
    expect(
      await screen.findByText(
        'Your account does not hold the permission this section needs.',
        undefined,
        LOAD,
      ),
    ).toBeInTheDocument();
  });

  it('suspends with a reason and re-reads the roster from the server', async () => {
    let suspended = false;
    const { requests } = stubApi({
      'GET /doctors': () =>
        pageOf([summaryView({ practiceStatus: suspended ? 'suspended' : 'active' })]),
      'GET /admin/appointments': () => pageOf([]),
      [`POST /doctors/${ID}/suspend`]: () => {
        suspended = true;
        return envelope({ doctorId: ID, practiceStatus: 'suspended', affectedAppointments: 0 });
      },
    });
    const user = userEvent.setup();
    tree(<DoctorsSection />, '/admin/doctors');
    await screen.findByText('Dr. Laila Mansour', undefined, LOAD);

    await user.click(screen.getByRole('button', { name: 'Actions for Dr. Laila Mansour' }));
    await user.click(screen.getByRole('menuitem', { name: 'Suspend account' }));
    const dialog = await screen.findByRole('alertdialog', undefined, LOAD);
    await user.type(within(dialog).getByLabelText(/Reason/), 'Prescribing audit opened today.');
    await user.click(within(dialog).getByRole('button', { name: 'Suspend account' }));

    await waitFor(() => expect(toasts[0]?.title).toBe('Dr. Laila Mansour suspended'));
    expect(requests.find((request) => request.method === 'POST')?.body).toEqual({
      reason: 'Prescribing audit opened today.',
    });
    // The roster is read again after the decision, from the server.
    await waitFor(() => {
      const posted = requests.findIndex((request) => request.method === 'POST');
      expect(requests.slice(posted + 1).some((request) => request.path === '/doctors')).toBe(true);
    });
  });
});

describe('the live profile', () => {
  it('drops the tabs whose history the API does not serve', async () => {
    stubApi({ [`GET /doctors/${ID}`]: () => envelope(detailView()) });
    tree(<DoctorProfilePage />, `/admin/doctors/${ID}`);

    await screen.findByRole('heading', { name: 'Dr. Laila Mansour' }, LOAD);
    const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);
    expect(tabs).toEqual(['Profile', 'Documents', 'Appointments']);
    expect(screen.queryByRole('button', { name: 'Reset access' })).not.toBeInTheDocument();
    expect(screen.queryByText('Administrative fields')).not.toBeInTheDocument();
  });

  it('says there is no such doctor on a 404', async () => {
    stubApi({ [`GET /doctors/${ID}`]: () => json({ code: 'not_found' }, 404) });
    tree(<DoctorProfilePage />, `/admin/doctors/${ID}`);
    expect(
      await screen.findByRole('heading', { name: 'No such doctor' }, LOAD),
    ).toBeInTheDocument();
  });

  it('approves a document only once all three checks are ticked', async () => {
    let approved = false;
    const { requests } = stubApi({
      [`GET /doctors/${ID}`]: () =>
        envelope(
          detailView({
            documents: [
              documentView(
                'degree_certificate',
                approved
                  ? {
                      decision: 'approved',
                      decidedAt: '2026-10-05T10:00:00.000Z',
                      checks: { authentic: true, current: true, identityMatch: true },
                    }
                  : {},
              ),
            ],
          }),
        ),
      'GET /doctors': () => pageOf([summaryView()]),
      [`POST /doctors/${ID}/documents/vdoc-degree_certificate/approve`]: () => {
        approved = true;
        return envelope(detailView());
      },
    });
    const user = userEvent.setup();
    tree(<DoctorProfilePage />, `/admin/doctors/${ID}?tab=documents`);

    const approve = await screen.findByRole('button', { name: 'Approve' }, LOAD);
    expect(approve).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Authentic — Degree certificate' }));
    await user.click(screen.getByRole('checkbox', { name: 'Current — Degree certificate' }));
    expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled();
    await user.click(
      screen.getByRole('checkbox', { name: 'Matches identity — Degree certificate' }),
    );
    await user.click(screen.getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(toasts[0]?.title).toBe('Document approved'));
    expect(requests.find((request) => request.method === 'POST')?.body).toEqual({
      authentic: true,
      current: true,
      identityMatch: true,
    });
    expect(await screen.findByText('Approved', undefined, LOAD)).toBeInTheDocument();
  });

  it('shows the server’s refusal when verification is not yet allowed', async () => {
    stubApi({
      [`GET /doctors/${ID}`]: () =>
        envelope(
          detailView({
            documents: ['medical_license', 'degree_certificate', 'national_id'].map((kind) =>
              documentView(kind, {
                decision: 'approved',
                checks: { authentic: true, current: true, identityMatch: true },
              }),
            ),
          }),
        ),
      [`POST /doctors/${ID}/verify`]: () =>
        json({ code: 'conflict', detail: 'Outstanding documents: national_id' }, 409),
    });
    const user = userEvent.setup();
    tree(<DoctorProfilePage />, `/admin/doctors/${ID}?tab=documents`);

    await user.click(await screen.findByRole('button', { name: 'Complete verification' }, LOAD));
    await waitFor(() =>
      expect(toasts[0]).toMatchObject({
        variant: 'error',
        title: 'Verification was not completed',
        description: 'Outstanding documents: national_id.',
      }),
    );
  });

  it('requests documents by kind, and refuses a request that names none', async () => {
    const { requests } = stubApi({
      [`GET /doctors/${ID}`]: () => envelope(detailView()),
      'GET /doctors': () => pageOf([summaryView()]),
      [`POST /doctors/${ID}/request-documents`]: () =>
        envelope({ doctorId: ID, verificationStatus: 'docs_requested', verifiedAt: null }),
    });
    const user = userEvent.setup();
    tree(<DoctorProfilePage />, `/admin/doctors/${ID}`);

    await user.click(await screen.findByRole('button', { name: 'Request documents' }, LOAD));
    const dialog = await screen.findByRole('dialog', undefined, LOAD);
    // Every required document is outstanding, so all three start selected.
    for (const name of ['Medical licence', 'Degree certificate', 'Identity document']) {
      expect(within(dialog).getByRole('checkbox', { name })).toBeChecked();
      await user.click(within(dialog).getByRole('checkbox', { name }));
    }
    await user.type(within(dialog).getByLabelText(/Reason/), 'Clear scans of both pages, please.');
    await user.click(within(dialog).getByRole('button', { name: 'Send request' }));
    expect(
      await within(dialog).findByText('Choose at least one document to request.'),
    ).toBeInTheDocument();
    expect(requests.some((request) => request.method === 'POST')).toBe(false);

    await user.click(within(dialog).getByRole('checkbox', { name: 'Degree certificate' }));
    await user.click(within(dialog).getByRole('button', { name: 'Send request' }));
    await waitFor(() => expect(toasts[0]?.title).toBe('Request sent'));
    expect(requests.find((request) => request.method === 'POST')?.body).toEqual({
      kinds: ['degree_certificate'],
      reason: 'Clear scans of both pages, please.',
    });
  });
});
