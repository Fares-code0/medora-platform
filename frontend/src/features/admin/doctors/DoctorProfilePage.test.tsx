import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PhiAccessProvider } from '../phi';

import { DoctorProfilePage } from './DoctorProfilePage';

/**
 * The admin doctor profile (ADM-03 · UX §3.3).
 *
 * What is being pinned is the verification workflow as an administrator
 * meets it: the approve button stays inert until all three checks are
 * ticked, "Complete verification" states what is blocking it rather than
 * being mysteriously grey, and the whole thing only becomes available once
 * the file is genuinely complete.
 */

vi.mock('@/app/providers', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Marcus Reed', email: 'admin@medora.health' } }),
  useCan: () => () => true,
  useToast: () => ({ toast: () => undefined }),
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
  window.localStorage.clear();
});

function renderProfile(doctorId: string, tab = 'documents') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  function Tree({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/admin/doctors/${doctorId}?tab=${tab}`]}>
          <PhiAccessProvider>{children}</PhiAccessProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(
    <Tree>
      <Routes>
        <Route path="/admin/doctors/:doctorId" element={<DoctorProfilePage />} />
      </Routes>
    </Tree>,
  );
}

describe('the identity header', () => {
  it('carries verification and account standing, not just a name', async () => {
    renderProfile('doc-said', 'profile');

    expect(await screen.findByRole('heading', { name: 'Dr. Hana Said' })).toBeInTheDocument();
    expect(screen.getByText('Suspended', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText(/prescribing-pattern audit/)).toBeInTheDocument();
  });

  it('fails the page rather than rendering tabs about nobody', async () => {
    renderProfile('doc-nobody');

    expect(await screen.findByText('No such doctor')).toBeInTheDocument();
  });
});

describe('the documents tab', () => {
  it('holds approval until all three checks are ticked', async () => {
    const user = userEvent.setup();
    renderProfile('doc-nabil');

    // The degree certificate is the one awaiting review.
    await screen.findByText('Degree certificate');
    const approveButtons = screen.getAllByRole('button', { name: 'Approve' });
    const degreeApprove = approveButtons[1];
    expect(degreeApprove).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: /Authentic — Degree certificate/ }));
    await user.click(screen.getByRole('checkbox', { name: /Current — Degree certificate/ }));
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Approve' })[1]).toBeDisabled();
    });

    await user.click(
      screen.getByRole('checkbox', { name: /Matches identity — Degree certificate/ }),
    );
    await waitFor(() => {
      expect(screen.getAllByRole('button', { name: 'Approve' })[1]).toBeEnabled();
    });
  });

  it('says what is blocking verification instead of only greying the button', async () => {
    renderProfile('doc-nabil');

    expect(await screen.findByText('Still outstanding')).toBeInTheDocument();
    expect(
      screen.getByText('Degree certificate has not been approved.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Complete verification/ })).toBeDisabled();
  });

  it('opens verification once the file is complete', async () => {
    renderProfile('doc-farouk');

    await screen.findByText('Degree certificate');

    expect(screen.queryByText('Still outstanding')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Complete verification/ })).toBeEnabled();
  });

  it('completes verification and reflects it in the header', async () => {
    const user = userEvent.setup();
    renderProfile('doc-farouk');

    await user.click(await screen.findByRole('button', { name: /Complete verification/ }));

    await waitFor(() => {
      expect(screen.getByText(/is verified\./)).toBeInTheDocument();
    });

    const stored: unknown = JSON.parse(
      window.localStorage.getItem('medora.admin.doctors.v1') ?? '{}',
    );
    const doctors = (stored as { doctors?: { id: string; verification: string }[] }).doctors;
    expect(doctors?.find((entry) => entry.id === 'doc-farouk')?.verification).toBe('verified');
  });

  it('locks the checklist on a doctor who is already verified', async () => {
    renderProfile('doc-chen');

    await screen.findByText('Medical licence');

    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Authentic — Medical licence/ })).toBeDisabled();
  });

  it('flags a licence that is close to expiry', async () => {
    renderProfile('doc-khalil');

    // Dr. Khalil's licence expires inside the warning window, so its card
    // carries the warning treatment while the others do not.
    const licenceCard = (await screen.findByText('Medical licence')).closest('section');
    const expiry = within(licenceCard as HTMLElement).getByText(/^Expires/);

    expect(expiry).toHaveClass('text-warning');
  });
});

describe('the activity tab', () => {
  it('reports counts, never clinical content, and flags impossible travel', async () => {
    renderProfile('doc-said', 'activity');

    expect(await screen.findByText('Impossible travel detected')).toBeInTheDocument();
    expect(screen.getByText('Counts only — never content')).toBeInTheDocument();
  });
});

describe('the appointments tab', () => {
  it('masks the patient on every row it borrows from oversight', async () => {
    renderProfile('doc-khalil', 'appointments');

    // Wait for a row, not just the panel: the table is empty until the
    // oversight query resolves.
    await screen.findByText('APT-2401');

    expect(screen.getAllByText(/Patient name, masked/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Khaled Nassar/)).not.toBeInTheDocument();
  });
});
