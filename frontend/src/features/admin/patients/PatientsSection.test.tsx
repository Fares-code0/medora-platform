import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PhiAccessProvider } from '../phi';

import { PatientsSection } from './PatientsSection';

/**
 * Patients management at the surface (ADM-04 · UX §3.4).
 *
 * Three claims are worth holding onto. Identifiers are masked before
 * anybody asks — the default state of this table leaks nothing. The search
 * box still works against the *underlying* values, which is what makes a
 * masked table usable rather than merely safe. And the account controls are
 * gated on the capability, not merely hidden behind a disabled button.
 */

const capabilities = { current: true };

vi.mock('@/app/providers', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Marcus Reed', email: 'admin@medora.health' } }),
  useCan: () => () => capabilities.current,
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
  capabilities.current = true;
});

function renderList(initialUrl = '/admin/patients') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  // The real tree wraps the whole `/admin/*` branch in the PHI gate
  // (`app/router/index.tsx`), and `MaskedIdentifier` refuses to render
  // outside it — deliberately, so a screen cannot print an identifier by
  // forgetting the provider.
  function Tree({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[initialUrl]}>
          <PhiAccessProvider>{children}</PhiAccessProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }
  return render(
    <Tree>
      <PatientsSection />
    </Tree>,
  );
}

async function waitForRows() {
  await screen.findByRole('table', { name: 'Patient accounts' });
  await waitFor(() => {
    expect(screen.getByText('PT-1001')).toBeInTheDocument();
  });
}

describe('masking', () => {
  it('shows no patient name in the clear before anybody asks', async () => {
    renderList();
    await waitForRows();

    // The roster names are the ones the fixtures use; none may appear.
    for (const name of ['Khaled Nassar', 'Mona Adel', 'Omar Farouk', 'Layla Mansour']) {
      expect(screen.queryByText(name)).not.toBeInTheDocument();
    }
    // The masked form is what renders instead.
    expect(screen.getByText(/Kh••• N•••/)).toBeInTheDocument();
  });

  it('names the account rather than the person in its controls', async () => {
    renderList();
    await waitForRows();

    // A menu button's accessible name is announced and logged, so masking
    // the table while labelling the button "Actions for Khaled Nassar"
    // would give the whole thing away.
    expect(screen.getByRole('button', { name: 'Actions for patient PT-1001' })).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Actions for .*Khaled/ }),
    ).not.toBeInTheDocument();
  });
});

describe('search', () => {
  it('matches the underlying value even though the row is masked', async () => {
    const user = userEvent.setup();
    renderList();
    await waitForRows();

    await user.type(screen.getByRole('searchbox', { name: 'Search patient accounts' }), 'Farouk');

    await waitFor(() => {
      expect(screen.getByText('PT-1004')).toBeInTheDocument();
      expect(screen.queryByText('PT-1001')).not.toBeInTheDocument();
    });
    // Finding the row did not unmask it.
    expect(screen.queryByText('Omar Farouk')).not.toBeInTheDocument();
  });

  it('matches a phone number typed without punctuation', async () => {
    const user = userEvent.setup();
    renderList();
    await waitForRows();

    await user.type(screen.getByRole('searchbox', { name: 'Search patient accounts' }), '2143387');

    await waitFor(() => {
      expect(screen.getByText('PT-1001')).toBeInTheDocument();
      expect(screen.queryByText('PT-1004')).not.toBeInTheDocument();
    });
  });
});

describe('the work queue', () => {
  it('leads with the account that cannot sign in', async () => {
    renderList();
    await waitForRows();

    const table = screen.getByRole('table', { name: 'Patient accounts' });
    const firstRow = within(table).getAllByRole('row')[1]?.textContent ?? '';
    // PT-1002 is the locked one.
    expect(firstRow).toContain('PT-1002');
  });

  it('offers unlocking only on the locked account', async () => {
    const user = userEvent.setup();
    renderList();
    await waitForRows();

    await user.click(screen.getByRole('button', { name: 'Actions for patient PT-1002' }));
    const locked = await screen.findByRole('menu', { name: 'Actions for patient PT-1002' });
    expect(within(locked).getByRole('menuitem', { name: /Unlock account/ })).toBeInTheDocument();
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Actions for patient PT-1001' }));
    const active = await screen.findByRole('menu', { name: 'Actions for patient PT-1001' });
    expect(within(active).queryByRole('menuitem', { name: /Unlock account/ })).not.toBeInTheDocument();
  });

  it('shows only accounts with open work when linked to with ?flag=open', async () => {
    renderList('/admin/patients?flag=open');
    await screen.findByRole('table', { name: 'Patient accounts' });

    // PT-1002 carries a flag and a request, PT-1003 a flag, PT-1004 a
    // request. PT-1001 and PT-1005 have nothing open on them.
    await waitFor(() => {
      expect(screen.getByText('PT-1002')).toBeInTheDocument();
    });
    expect(screen.getByText('PT-1003')).toBeInTheDocument();
    expect(screen.getByText('PT-1004')).toBeInTheDocument();
    expect(screen.queryByText('PT-1001')).not.toBeInTheDocument();
    expect(screen.queryByText('PT-1005')).not.toBeInTheDocument();
  });

  it('offers reactivation instead of deactivation on a closed account', async () => {
    const user = userEvent.setup();
    renderList();
    await waitForRows();

    await user.click(screen.getByRole('button', { name: 'Actions for patient PT-1005' }));
    const menu = await screen.findByRole('menu', { name: 'Actions for patient PT-1005' });

    expect(within(menu).getByRole('menuitem', { name: /Reactivate account/ })).toBeInTheDocument();
    expect(
      within(menu).queryByRole('menuitem', { name: /Deactivate account/ }),
    ).not.toBeInTheDocument();
    // A deactivated account cannot be sent a link it could never act on.
    expect(
      within(menu).queryByRole('menuitem', { name: /Reset credentials/ }),
    ).not.toBeInTheDocument();
  });
});

describe('capability gating', () => {
  it('leaves a role without account management nothing to click', async () => {
    capabilities.current = false;
    const user = userEvent.setup();
    renderList();
    await waitForRows();

    await user.click(screen.getByRole('button', { name: 'Actions for patient PT-1002' }));
    const menu = await screen.findByRole('menu', { name: 'Actions for patient PT-1002' });

    expect(within(menu).getByRole('menuitem', { name: /View account/ })).toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: /Unlock/ })).not.toBeInTheDocument();
    expect(within(menu).queryByRole('menuitem', { name: /Deactivate/ })).not.toBeInTheDocument();
    expect(screen.getByText(/can review accounts but not change them/)).toBeInTheDocument();
  });
});

describe('deactivation', () => {
  it('refuses a token reason and writes nothing', async () => {
    const user = userEvent.setup();
    renderList();
    await waitForRows();

    await user.click(screen.getByRole('button', { name: 'Actions for patient PT-1001' }));
    const menu = await screen.findByRole('menu', { name: 'Actions for patient PT-1001' });
    await user.click(within(menu).getByRole('menuitem', { name: /Deactivate account/ }));

    await user.type(await screen.findByRole('textbox', { name: /Reason/ }), 'bad');
    await user.click(screen.getByRole('button', { name: 'Deactivate account' }));

    expect(await screen.findByText(/at least 12 characters/)).toBeInTheDocument();
    expect(window.localStorage.getItem('medora.admin.patients.v1')).toBeNull();
  });
});
