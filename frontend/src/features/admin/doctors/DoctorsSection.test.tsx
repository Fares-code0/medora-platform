import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { pendingSentence } from './doctors';
import { DoctorsSection } from './DoctorsSection';

/**
 * Doctors management at the surface (ADM-02 · UX §3.2).
 *
 * Two claims are worth holding onto here. The Pending tab is a work queue,
 * so its badge must count only decisions an administrator can actually
 * make. And suspension must state its consequence before it asks — the
 * number of appointments it would strand, read from the live oversight
 * store rather than from a field that can go stale.
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

function renderList(initialUrl = '/admin/doctors') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  function Tree({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[initialUrl]}>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(
    <Tree>
      <DoctorsSection />
    </Tree>,
  );
}

async function openTab(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(screen.getByRole('tab', { name }));
}

describe('the queue', () => {
  it('counts only verifications an administrator can act on', async () => {
    renderList();
    await screen.findByText('Dr. Youssef Nabil');

    // Two doctors are `pending`; Dr. Mansour is `docs-requested`, which is
    // waiting on the doctor and must not inflate the badge.
    const pendingTab = screen.getByRole('tab', { name: /Pending verification/ });
    expect(pendingTab).toHaveTextContent('2');
  });

  it('leads with the doctors who are waiting on a decision', async () => {
    renderList();
    await screen.findByText('Dr. Youssef Nabil');

    const table = screen.getByRole('table', { name: 'Doctors on the platform' });
    const firstRowName = within(table).getAllByRole('row')[1]?.textContent ?? '';
    expect(['Dr. Nadia Farouk', 'Dr. Youssef Nabil'].some((n) => firstRowName.includes(n))).toBe(
      true,
    );
  });

  it('says the queue is clear rather than showing an empty table', async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText('Dr. Youssef Nabil');

    await openTab(user, /Pending verification/);
    await user.type(screen.getByRole('searchbox', { name: 'Search doctors' }), 'nobody');

    expect(await screen.findByText('No pending verifications ✓')).toBeInTheDocument();
  });

  it('searches licence numbers as well as names', async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText('Dr. Omar Khalil');

    await user.type(screen.getByRole('searchbox', { name: 'Search doctors' }), 'CA-207');

    await waitFor(() => {
      expect(screen.getByText('Dr. Omar Khalil')).toBeInTheDocument();
      expect(screen.queryByText('Dr. Amelia Chen')).not.toBeInTheDocument();
    });
  });
});

describe('arriving from the action queue', () => {
  it('opens on the Pending tab when the queue links to ?tab=pending', async () => {
    renderList('/admin/doctors?tab=pending');
    await screen.findByText('Dr. Youssef Nabil');

    expect(screen.getByRole('tab', { name: /Pending verification/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    // Dr. Amelia Chen is verified, so landing on the count must not show her.
    expect(screen.queryByText('Dr. Amelia Chen')).not.toBeInTheDocument();
  });

  it('shows only the licences inside the horizon at ?expiring=soon', async () => {
    renderList('/admin/doctors?expiring=soon');

    // Dr. Elena Reyes' licence expired 20 days ago; the nearest miss is Dr.
    // Omar Khalil at 44 days, outside the 30-day count the queue offered.
    await screen.findByText('Dr. Elena Reyes');
    expect(screen.queryByText('Dr. Omar Khalil')).not.toBeInTheDocument();
    expect(screen.queryByText('Dr. Amelia Chen')).not.toBeInTheDocument();
  });

  it('ignores a value it never honoured, rather than filtering on a number', async () => {
    renderList('/admin/doctors?expiring=90');
    await screen.findByText('Dr. Amelia Chen');

    // `expiring` is a flag; anything but `soon` leaves the list unfiltered
    // instead of implying a 90-day window nothing computes.
    expect(screen.getByText('Dr. Omar Khalil')).toBeInTheDocument();
  });

  it('hands the view over the moment the administrator moves off the seeded tab', async () => {
    const user = userEvent.setup();
    renderList('/admin/doctors?tab=pending');
    await screen.findByText('Dr. Youssef Nabil');

    await openTab(user, /^All/);

    // The URL still says `?tab=pending`; the control is what the list follows.
    expect(await screen.findByText('Dr. Amelia Chen')).toBeInTheDocument();
  });
});

describe('suspension', () => {
  it('states how many appointments it would strand before asking', async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText('Dr. Omar Khalil');

    await user.click(screen.getByRole('button', { name: 'Actions for Dr. Omar Khalil' }));
    const menu = await screen.findByRole('menu', { name: 'Actions for Dr. Omar Khalil' });
    await user.click(within(menu).getByRole('menuitem', { name: /Suspend account/ }));

    // Read from the ADM-05 oversight store, not from a field on the doctor.
    expect(
      await screen.findByText(/Their appointments will require reassignment/),
    ).toBeInTheDocument();
    expect(await screen.findByText(/upcoming appointments? affected/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Reassign them first/ })).toHaveAttribute(
      'href',
      '/admin/appointments?doctor=doc-khalil',
    );
  });

  it('refuses to suspend on a token reason', async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText('Dr. Omar Khalil');

    await user.click(screen.getByRole('button', { name: 'Actions for Dr. Omar Khalil' }));
    const menu = await screen.findByRole('menu', { name: 'Actions for Dr. Omar Khalil' });
    await user.click(within(menu).getByRole('menuitem', { name: /Suspend account/ }));

    await user.type(await screen.findByRole('textbox', { name: /Reason/ }), 'bad');
    await user.click(screen.getByRole('button', { name: 'Suspend account' }));

    expect(await screen.findByText(/at least 12 characters/)).toBeInTheDocument();
    // Still on the roster, untouched.
    const stored = window.localStorage.getItem('medora.admin.doctors.v1');
    expect(stored).toBeNull();
  });

  it('offers reactivation instead of suspension on a suspended account', async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText('Dr. Hana Said');

    await user.click(screen.getByRole('button', { name: 'Actions for Dr. Hana Said' }));
    const menu = await screen.findByRole('menu', { name: 'Actions for Dr. Hana Said' });

    expect(within(menu).getByRole('menuitem', { name: /Reactivate account/ })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: /Suspend account/ })).not.toBeInTheDocument();
  });
});

describe('invitations', () => {
  it('surfaces the service’s refusal rather than pretending it sent', async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText('Dr. Amelia Chen');

    await user.click(screen.getByRole('button', { name: 'Invite doctor' }));
    await user.type(await screen.findByRole('textbox', { name: /Work email/ }), 'amelia.chen@medora.health');
    await user.click(screen.getByRole('button', { name: 'Send invitation' }));

    expect(await screen.findByText(/already belongs to a doctor/)).toBeInTheDocument();
  });
});

describe('the pending hint agrees with its count', () => {
  it('says "is" for one doctor and "are" for more', () => {
    expect(pendingSentence(1)).toBe('1 doctor is waiting on a verification decision.');
    expect(pendingSentence(2)).toBe('2 doctors are waiting on a verification decision.');
  });

  it('renders the hint under the full list', async () => {
    renderList();
    expect(
      await screen.findByText('2 doctors are waiting on a verification decision.'),
    ).toBeInTheDocument();
  });
});
