import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, Link, RouterProvider } from 'react-router-dom';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { adminSettingsApi } from '../../api/admin-settings.api';

import { PermissionMatrixPanel } from './PermissionMatrixPanel';

/**
 * ADM-09 — the editor end to end, through the real service.
 *
 * The service is deliberately NOT mocked: the requirement is that a change
 * survives a reload, and the only way to show that is to save through
 * `adminSettingsApi` and then mount a brand-new tree with a brand-new query
 * cache — which is what a reload is. `useAuth`/`useToast` are stubbed because
 * the panel's contract is with the matrix, not with how a session is
 * established.
 */

const toasts: { variant?: string; title: string }[] = [];

vi.mock('@/app/providers', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Marcus Reed', email: 'admin@medora.health' } }),
  useToast: () => ({
    toast: (entry: { variant?: string; title: string }) => {
      toasts.push(entry);
    },
  }),
}));

beforeAll(() => {
  // jsdom ships <dialog> without the modal methods Modal relies on.
  const proto = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto['showModal'] = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  proto['close'] = function close(this: HTMLDialogElement) {
    this.open = false;
  };

  // Every data-router navigation builds a Request. Under jsdom the global
  // Request is Node's (undici) while AbortSignal is jsdom's, and undici
  // rejects a signal from another realm — an environment artifact, not app
  // behaviour. A structural stand-in is enough: these routes have no loaders.
  vi.stubGlobal(
    'Request',
    class {
      readonly url: string;
      readonly signal: AbortSignal | undefined;
      constructor(url: string, init?: { signal?: AbortSignal }) {
        this.url = url;
        this.signal = init?.signal;
      }
    },
  );
});

beforeEach(() => {
  window.localStorage.clear();
  toasts.length = 0;
});

/**
 * The panel loads its own matrix and role counts through the access service
 * (FE-10.10) — here the demo adapter over the real settings store, so a save
 * seeds the cache exactly as it does in the app.
 */
function LoadedPanel() {
  return <PermissionMatrixPanel />;
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const router = createMemoryRouter(
    [
      {
        path: '/admin/settings/roles',
        element: (
          <>
            <LoadedPanel />
            <Link to="/admin/settings/security">Go to Security</Link>
          </>
        ),
      },
      { path: '/admin/settings/security', element: <h1>Security</h1> },
    ],
    { initialEntries: ['/admin/settings/roles'] },
  );

  function Tree({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  return render(
    <Tree>
      <RouterProvider router={router} />
    </Tree>,
  );
}

async function waitForGrid() {
  await screen.findByRole('table');
}

/** The desktop grid and the mobile cards both render; target the table. */
function cell(capability: string, role: string) {
  const table = screen.getByRole('table');
  return within(table).getByRole('switch', { name: new RegExp(`^${capability} for ${role}`) });
}

/**
 * Modal keeps a closed <dialog> element in the tree (its body is what is
 * conditionally rendered), so `getByRole('alertdialog')` is ambiguous once a
 * panel has opened more than one. Scope by the title text instead.
 */
function openDialog(title: RegExp) {
  const dialog = screen.getByText(title).closest('dialog');
  if (!dialog) throw new Error(`No dialog contains ${title.source}`);
  return within(dialog);
}

describe('the grid', () => {
  it('renders one column per role and one row per capability', async () => {
    renderPanel();
    await waitForGrid();

    const table = screen.getByRole('table');
    for (const role of ['Administrator', 'Doctor', 'Reception', 'Laboratory', 'Pharmacy']) {
      expect(
        within(table).getByRole('columnheader', { name: new RegExp(role) }),
      ).toBeInTheDocument();
    }
    expect(within(table).getByRole('rowheader', { name: /Prescribe/ })).toBeInTheDocument();
  });

  it('names every cell by capability and role, not just "switch"', async () => {
    renderPanel();
    await waitForGrid();

    expect(cell('Review lab results', 'Pharmacy')).toHaveAttribute('aria-checked', 'false');
    expect(cell('Review lab results', 'Doctor')).toHaveAttribute('aria-checked', 'true');
  });

  it('shows the seeded matrix, not an empty one', async () => {
    renderPanel();
    await waitForGrid();

    expect(cell('Prescribe', 'Doctor')).toHaveAttribute('aria-checked', 'true');
    expect(cell('Manage system settings', 'Administrator')).toHaveAttribute('aria-checked', 'true');
  });
});

describe('members by role', () => {
  // UX §3.9: "per-role member list". The member list is the Users panel
  // filtered to the role, so each role links there rather than duplicating it.
  it('links each role to its accounts in Users, filtered to that role', async () => {
    renderPanel();
    await waitForGrid();

    const nav = screen.getByRole('navigation', { name: 'Accounts by role' });
    const expected = {
      admin: 'Administrator',
      doctor: 'Doctor',
      reception: 'Reception',
      laboratory: 'Laboratory',
      pharmacy: 'Pharmacy',
    };
    for (const [code, label] of Object.entries(expected)) {
      expect(
        within(nav).getByRole('link', { name: new RegExp(`^${label} · \\d+ active$`) }),
      ).toHaveAttribute('href', `/admin/settings/users?role=${code}`);
    }
    expect(within(nav).getAllByRole('link')).toHaveLength(5);
  });
});

describe('safety rules', () => {
  it('disables the cells fixed by policy', async () => {
    renderPanel();
    await waitForGrid();

    expect(cell('Edit roles & permissions', 'Administrator')).toBeDisabled();
    expect(cell('Edit roles & permissions', 'Doctor')).toBeDisabled();
    expect(cell('Prescribe', 'Reception')).toBeDisabled();
    expect(cell('Decide verifications', 'Doctor')).toBeDisabled();
  });

  it('states the reason in the accessible name rather than only a tooltip', async () => {
    renderPanel();
    await waitForGrid();

    expect(cell('Decide verifications', 'Doctor')).toHaveAccessibleName(
      /Doctors cannot sit on their own verification decisions/,
    );
  });

  it('blocks the save when a capability would be left with no role', async () => {
    const user = userEvent.setup();
    renderPanel();
    await waitForGrid();

    // Doctor and Laboratory are the only holders of lab review.
    await user.click(cell('Review lab results', 'Doctor'));
    await user.click(cell('Review lab results', 'Laboratory'));

    expect(await screen.findByText(/No role would hold these capabilities/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Review & save/ })).toBeDisabled();
  });
});

describe('changed state and the save bar', () => {
  it('stays quiet until something changes', async () => {
    renderPanel();
    await waitForGrid();

    expect(screen.queryByRole('button', { name: /Review & save/ })).not.toBeInTheDocument();
  });

  it('marks the changed cell and counts the affected accounts', async () => {
    const user = userEvent.setup();
    renderPanel();
    await waitForGrid();

    await user.click(cell('Review lab results', 'Pharmacy'));

    expect(cell('Review lab results', 'Pharmacy')).toHaveAccessibleName(/changed to allowed/);
    // One pharmacy account exists in the seed and it is deactivated.
    expect(await screen.findByText(/1 unsaved change/)).toBeInTheDocument();
    expect(screen.getByText(/0 accounts affected/)).toBeInTheDocument();
  });

  it('counts only active accounts of the changed role', async () => {
    const user = userEvent.setup();
    renderPanel();
    await waitForGrid();

    await user.click(cell('Export system logs', 'Doctor'));

    expect(await screen.findByText(/1 account affected/)).toBeInTheDocument();
  });

  it('restores the saved matrix on discard', async () => {
    const user = userEvent.setup();
    renderPanel();
    await waitForGrid();

    await user.click(cell('Review lab results', 'Pharmacy'));
    await user.click(screen.getByRole('button', { name: 'Discard' }));
    await user.click(await screen.findByRole('button', { name: /Discard changes/ }));

    await waitFor(() => {
      expect(cell('Review lab results', 'Pharmacy')).toHaveAttribute('aria-checked', 'false');
    });
    expect(screen.queryByRole('button', { name: /Review & save/ })).not.toBeInTheDocument();
  });
});

describe('unsaved-changes protection', () => {
  it('intercepts navigation away and can be cancelled', async () => {
    const user = userEvent.setup();
    renderPanel();
    await waitForGrid();

    await user.click(cell('Review lab results', 'Pharmacy'));
    await user.click(screen.getByRole('link', { name: 'Go to Security' }));

    expect(await screen.findByText(/Leave with unsaved permission changes\?/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Stay on this page' }));

    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  it('lets the navigation through once confirmed', async () => {
    const user = userEvent.setup();
    renderPanel();
    await waitForGrid();

    await user.click(cell('Review lab results', 'Pharmacy'));
    await user.click(screen.getByRole('link', { name: 'Go to Security' }));
    await user.click(await screen.findByRole('button', { name: /Leave and discard/ }));

    expect(await screen.findByRole('heading', { name: 'Security' })).toBeInTheDocument();
  });

  it('does not intercept navigation when nothing changed', async () => {
    const user = userEvent.setup();
    renderPanel();
    await waitForGrid();

    await user.click(screen.getByRole('link', { name: 'Go to Security' }));

    expect(await screen.findByRole('heading', { name: 'Security' })).toBeInTheDocument();
  });
});

describe('review and save', () => {
  it('previews the change set and who it reaches before writing anything', async () => {
    const user = userEvent.setup();
    renderPanel();
    await waitForGrid();

    await user.click(cell('View medical records', 'Reception'));
    await user.click(await screen.findByRole('button', { name: /Review & save/ }));

    const dialog = openDialog(/Review permission changes/);
    // The dialog shows the access service's dry run, which answers asynchronously.
    expect(await dialog.findByText('Grant')).toBeInTheDocument();
    expect(dialog.getAllByText(/View medical records/).length).toBeGreaterThan(0);
    // PHI capability — called out on its own.
    expect(dialog.getByText(/This grants access to patient data/)).toBeInTheDocument();

    // Still nothing persisted.
    const stored = await adminSettingsApi.getSettings();
    expect(stored.permissions.matrix.reception).not.toContain('records.view');
  });

  it('persists the change and survives a full reload', async () => {
    const user = userEvent.setup();
    const { unmount } = renderPanel();
    await waitForGrid();

    await user.click(cell('Review lab results', 'Pharmacy'));
    await user.click(await screen.findByRole('button', { name: /Review & save/ }));
    await user.click(await screen.findByRole('button', { name: /Apply 1 change/ }));

    await waitFor(() => {
      expect(toasts.some((entry) => entry.title === 'Permissions updated')).toBe(true);
    });

    // A reload: tear the tree down, throw the query cache away, mount again.
    unmount();
    renderPanel();
    await waitForGrid();

    expect(cell('Review lab results', 'Pharmacy')).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('button', { name: /Review & save/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Revision 2/)).toBeInTheDocument();
  });

  it('clears the dirty state after saving', async () => {
    const user = userEvent.setup();
    renderPanel();
    await waitForGrid();

    await user.click(cell('Review lab results', 'Pharmacy'));
    await user.click(await screen.findByRole('button', { name: /Review & save/ }));
    await user.click(await screen.findByRole('button', { name: /Apply 1 change/ }));

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /Review & save/ })).not.toBeInTheDocument();
    });
  });
});

describe('concurrent edits', () => {
  it('offers both change sets instead of silently overwriting', async () => {
    const user = userEvent.setup();
    renderPanel();
    await waitForGrid();

    await user.click(cell('Review lab results', 'Pharmacy'));

    // Another administrator saves while this panel is open.
    const current = await adminSettingsApi.getSettings();
    await adminSettingsApi.savePermissions({
      matrix: {
        ...current.permissions.matrix,
        reception: [...current.permissions.matrix.reception, 'logs.export'],
      },
      baseRevision: current.permissions.revision,
      actor: 'Ana Silva',
    });

    await user.click(await screen.findByRole('button', { name: /Review & save/ }));
    // The dry run compares with the matrix as stored now, so it also lists
    // undoing Ana's cell — and says so before Apply.
    expect(await screen.findByText('The matrix changed since you opened it')).toBeInTheDocument();
    expect(screen.getByText(/1 of these changes is a cell you did not edit/)).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: /Apply 2 changes/ }));

    await screen.findByText(/Someone else saved first/);
    const dialog = openDialog(/Someone else saved first/);
    expect(dialog.getByText(/Ana Silva/)).toBeInTheDocument();
    expect(dialog.getByText('Their changes')).toBeInTheDocument();
    expect(dialog.getByText('Your changes')).toBeInTheDocument();
  });

  it('applies this administrator’s draft over theirs on request', async () => {
    const user = userEvent.setup();
    renderPanel();
    await waitForGrid();

    await user.click(cell('Review lab results', 'Pharmacy'));

    const current = await adminSettingsApi.getSettings();
    await adminSettingsApi.savePermissions({
      matrix: {
        ...current.permissions.matrix,
        reception: [...current.permissions.matrix.reception, 'logs.export'],
      },
      baseRevision: current.permissions.revision,
      actor: 'Ana Silva',
    });

    await user.click(await screen.findByRole('button', { name: /Review & save/ }));
    await user.click(await screen.findByRole('button', { name: /Apply 2 changes/ }));
    await user.click(await screen.findByRole('button', { name: /Apply mine over theirs/ }));

    await waitFor(async () => {
      const stored = await adminSettingsApi.getSettings();
      expect(stored.permissions.matrix.pharmacy).toContain('labs.review');
      expect(stored.permissions.revision).toBe(3);
    });
  });
});
