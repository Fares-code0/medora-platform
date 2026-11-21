import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Permission } from '@/types/auth';

import { PhiAccessProvider } from '../phi';

import { AppointmentOversightSection } from './AppointmentOversightSection';

/**
 * ADM-05 at the surface.
 *
 * The pure rules are pinned in `oversight.test.ts` and the service contract
 * in `oversight.api.test.ts`; what is left to prove is that the page honours
 * them — that a patient's name does not reach the table, and that an
 * administrator without `appointments.reassign` is not offered a reassign
 * button they would only be refused later. Capability gating is exactly the
 * kind of thing that regresses silently, so it is asserted rather than
 * assumed.
 */

const granted: Permission[] = [];

vi.mock('@/app/providers', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Marcus Reed', email: 'admin@medora.health' } }),
  useCan: () => (permission: Permission) => granted.includes(permission),
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
  granted.length = 0;
});

function renderPage(initialUrl = '/admin/appointments') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  function Tree({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        {/* The section reads `?doctor=` on mount, so it needs a router. */}
        <MemoryRouter initialEntries={[initialUrl]}>
          <PhiAccessProvider>{children}</PhiAccessProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(
    <Tree>
      <AppointmentOversightSection />
    </Tree>,
  );
}

/** Opens the row menu for one appointment and returns its item labels. */
async function openRowMenu(user: ReturnType<typeof userEvent.setup>, reference: string) {
  await user.click(screen.getByRole('button', { name: `Actions for ${reference}` }));
  const menu = await screen.findByRole('menu', { name: `Actions for ${reference}` });
  return within(menu)
    .getAllByRole('menuitem')
    .map((item) => item.textContent?.trim() ?? '');
}

describe('the table', () => {
  it('shows appointments from every doctor, not one calendar', async () => {
    renderPage();

    await screen.findByText('APT-2401');

    for (const doctor of ['Dr. Omar Khalil', 'Dr. Amelia Chen', 'Dr. Amira Hassan']) {
      expect(screen.getAllByText(doctor).length).toBeGreaterThan(0);
    }
  });

  it('never prints a patient name, even though the row carries one', async () => {
    renderPage();

    await screen.findByText('APT-2401');

    // `Khaled Nassar` is on the seeded record for APT-2401 and is still the
    // value passed to the cell — the gate is what keeps it off the screen.
    expect(screen.queryByText(/Khaled Nassar/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Patient name, masked/).length).toBeGreaterThan(0);
  });

  it('does not offer a reveal at all to a role without the PHI capability', async () => {
    renderPage();

    await screen.findByText('APT-2401');

    expect(
      screen.queryByRole('button', { name: /^Reveal patient name for APT-/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByText(/Revealing is not permitted for your role/).length,
    ).toBeGreaterThan(0);
  });

  it('offers the justified reveal once the role holds it (ADM-10)', async () => {
    granted.push('patients.revealIdentity');
    renderPage();

    await screen.findByText('APT-2401');

    expect(
      screen.getByRole('button', { name: 'Reveal patient name for APT-2401' }),
    ).toBeInTheDocument();
    // Still masked: holding the capability is not the same as having used it.
    expect(screen.queryByText(/Khaled Nassar/)).not.toBeInTheDocument();
  });

  it('surfaces the intervention signal on a stuck request', async () => {
    renderPage();

    await screen.findByText('APT-2401');

    expect(screen.getAllByText('Stuck pending').length).toBeGreaterThan(0);
  });

  it('arrives narrowed to the stuck requests when linked to with ?flag=stuck-pending', async () => {
    // The count ADM-01 offers on the overview.
    renderPage('/admin/appointments?flag=stuck-pending');

    await screen.findByText('APT-2401');

    // APT-2402 (30h) and APT-2414 (74h) are stuck too; APT-2403 is pending
    // but only 3h old, and APT-2404 is confirmed.
    expect(screen.getByText('APT-2402')).toBeInTheDocument();
    expect(screen.getByText('APT-2414')).toBeInTheDocument();
    expect(screen.queryByText('APT-2403')).not.toBeInTheDocument();
    expect(screen.queryByText('APT-2404')).not.toBeInTheDocument();
  });

  it('arrives narrowed to one doctor when linked to with ?doctor=', async () => {
    // The link ADM-02 offers before suspending someone.
    renderPage('/admin/appointments?doctor=doc-khalil');

    await screen.findByText('APT-2401');

    expect(screen.queryByText('APT-2404')).not.toBeInTheDocument();
    expect(screen.getAllByText('Dr. Omar Khalil').length).toBeGreaterThan(0);
    expect(screen.queryByText('Dr. Amelia Chen')).not.toBeInTheDocument();
  });
});

describe('capability gating', () => {
  it('offers only the record when the role holds neither scheduling capability', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('APT-2404');

    // APT-2404 is confirmed, so a nudge would not apply either.
    expect(await openRowMenu(user, 'APT-2404')).toEqual(['View detail']);
  });

  it('adds reassign only with appointments.reassign', async () => {
    granted.push('appointments.reassign');
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('APT-2404');

    expect(await openRowMenu(user, 'APT-2404')).toEqual(['View detail', 'Reassign']);
  });

  it('adds administrative cancel only with its own capability', async () => {
    granted.push('appointments.cancelAdministratively');
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('APT-2404');

    expect(await openRowMenu(user, 'APT-2404')).toEqual([
      'View detail',
      'Cancel administratively',
    ]);
  });

  it('never offers an intervention on a closed appointment, whatever the role holds', async () => {
    granted.push('appointments.reassign', 'appointments.cancelAdministratively');
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('APT-2407');

    // APT-2407 is completed.
    expect(await openRowMenu(user, 'APT-2407')).toEqual(['View detail']);
  });

  it('offers a nudge on a pending request regardless of the other two capabilities', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('APT-2401');

    expect(await openRowMenu(user, 'APT-2401')).toEqual(['View detail', 'Nudge doctor']);
  });
});

describe('bulk actions', () => {
  it('limits selection to requests a nudge would actually reach', async () => {
    renderPage();
    await screen.findByText('APT-2401');

    // APT-2414 was nudged half an hour ago and is inside the cooldown; a
    // completed appointment can never be selected.
    expect(
      screen.getByRole('checkbox', { name: 'Select APT-2401 for a reminder' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: 'Select APT-2414 for a reminder' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('checkbox', { name: 'Select APT-2407 for a reminder' }),
    ).not.toBeInTheDocument();
  });

  it('keeps the bulk button inert until something is selected, then sends the reminder', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('APT-2401');

    const bulk = screen.getByRole('button', { name: /Nudge selected/ });
    expect(bulk).toBeDisabled();

    await user.click(screen.getByRole('checkbox', { name: 'Select APT-2401 for a reminder' }));
    expect(screen.getByRole('button', { name: /Nudge selected \(1\)/ })).toBeEnabled();

    await user.click(screen.getByRole('button', { name: /Nudge selected \(1\)/ }));
    await user.click(await screen.findByRole('button', { name: 'Send reminder' }));

    // The reminder lands on the record, which is what makes it auditable.
    await waitFor(() => {
      const stored: unknown = JSON.parse(
        window.localStorage.getItem('medora.admin.appointments.v1') ?? '{}',
      );
      const appointments = (stored as { appointments?: { reference: string; lastNudgedAt: string | null }[] })
        .appointments;
      expect(appointments?.find((entry) => entry.reference === 'APT-2401')?.lastNudgedAt).not.toBeNull();
    });
  });
});
