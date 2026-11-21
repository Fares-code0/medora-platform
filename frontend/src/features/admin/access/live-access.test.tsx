import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { envelope, json, pageOf, stubApi } from '@/test/api-stub';

import { DEFAULT_PERMISSION_MATRIX } from '../permissions';
import { UsersPanel } from '../sections/settings/AccessPanels';
import { PermissionMatrixPanel } from '../sections/settings/PermissionMatrixPanel';
import { RolesSection } from '../sections/settings/RolesSection';

/**
 * Users, the permission matrix and staff invitations in a live build
 * (FE-10.10): the panels over the HTTP adapter, with only the network
 * stubbed.
 */

vi.mock('./service', async () => {
  const { httpAccessService } = await import('./http/http-access-service');
  return { accessService: httpAccessService };
});

const toasts: { variant?: string; title: string; description?: string }[] = [];

vi.mock('@/app/providers', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Marcus Reed', email: 'admin@medora.health' } }),
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

/** API §15.1's `RoleView`, as `GET /roles` returns it. */
function roleView(
  code: string,
  label: string,
  activeMembers: number,
  baseRole: string | null = null,
) {
  return {
    id: `rol_${code}`,
    code,
    label,
    baseRole,
    system: baseRole === null,
    members: activeMembers,
    activeMembers,
    inMatrix: baseRole === null,
  };
}

function userView(overrides: Record<string, unknown> = {}) {
  return {
    id: 'usr_doctor',
    name: 'Dr. Amelia Chen',
    email: 'doctor@medora.health',
    role: 'doctor',
    active: true,
    lastActiveAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const ADMIN = userView({
  id: 'usr_admin',
  name: 'Marcus Reed',
  email: 'admin@medora.health',
  role: 'admin',
});
const PATIENT = userView({
  id: 'usr_patient',
  name: 'Amira Saleh',
  email: 'amira@example.com',
  role: 'patient',
});

function renderPanel(panel: ReactNode, initialEntry = '/') {
  // The data router is what `useBlocker` (the matrix's unsaved-changes
  // guard) needs; jsdom's Request is swapped for a structural stand-in, as
  // the matrix panel's own test does.
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
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const router = createMemoryRouter([{ path: '/', element: panel }], {
    initialEntries: [initialEntry],
  });
  return {
    router,
    ...render(
      <QueryClientProvider client={client}>
        <RouterProvider router={router} />
      </QueryClientProvider>,
    ),
  };
}

describe('the live Users panel', () => {
  it('lists every account the server returns, patients included, and none of the demo ones', async () => {
    stubApi({ 'GET /admin/users': () => pageOf([ADMIN, userView(), PATIENT]) });
    renderPanel(<UsersPanel />);

    expect(await screen.findByText('Dr. Amelia Chen', undefined, LOAD)).toBeInTheDocument();
    expect(screen.getByText('Amira Saleh')).toBeInTheDocument();
    expect(screen.queryByText('Dr. Lena Hart')).not.toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Role for Amira Saleh' })).toHaveTextContent(
      'Patient',
    );
    // Your own row cannot be changed from here.
    expect(screen.getByRole('combobox', { name: 'Role for Marcus Reed' })).toBeDisabled();
    expect(screen.getAllByText(/never signed in/)).toHaveLength(3);
  });

  it('searches on the server', async () => {
    const { requests } = stubApi({ 'GET /admin/users': () => pageOf([userView()]) });
    const user = userEvent.setup();
    renderPanel(<UsersPanel />);
    await screen.findByText('Dr. Amelia Chen', undefined, LOAD);

    await user.type(screen.getByRole('searchbox', { name: 'Search accounts' }), 'chen');
    await waitFor(() =>
      expect(requests.some((request) => request.query.get('q') === 'chen')).toBe(true),
    );
  });

  // UX §3.9's per-role member list: the matrix links each role here, so the
  // filter has to be readable from the address and has to stay in it.
  it('opens filtered to the role the address names, and asks the server for that role only', async () => {
    const { requests } = stubApi({ 'GET /admin/users': () => pageOf([userView()]) });
    renderPanel(<UsersPanel />, '/?role=laboratory');
    await screen.findByText('Dr. Amelia Chen', undefined, LOAD);

    expect(screen.getByRole('combobox', { name: 'Filter by role' })).toHaveTextContent(
      'Laboratory',
    );
    const userRequests = requests.filter((request) => request.path === '/admin/users');
    expect(userRequests.length).toBeGreaterThan(0);
    expect(userRequests.every((request) => request.query.get('role') === 'laboratory')).toBe(true);
  });

  it('ignores a role it does not offer rather than filtering by it', async () => {
    const { requests } = stubApi({ 'GET /admin/users': () => pageOf([userView()]) });
    renderPanel(<UsersPanel />, '/?role=superuser');
    await screen.findByText('Dr. Amelia Chen', undefined, LOAD);

    expect(screen.getByRole('combobox', { name: 'Filter by role' })).toHaveTextContent('All roles');
    expect(requests.some((request) => request.query.has('role'))).toBe(false);
  });

  it('keeps the chosen role in the address', async () => {
    stubApi({ 'GET /admin/users': () => pageOf([userView()]) });
    const user = userEvent.setup();
    const { router } = renderPanel(<UsersPanel />);
    await screen.findByText('Dr. Amelia Chen', undefined, LOAD);

    await user.click(screen.getByRole('combobox', { name: 'Filter by role' }));
    await user.click(screen.getByRole('option', { name: 'Doctor' }));
    await waitFor(() => expect(router.state.location.search).toBe('?role=doctor'));

    await user.click(screen.getByRole('combobox', { name: 'Filter by role' }));
    await user.click(screen.getByRole('option', { name: 'All roles' }));
    await waitFor(() => expect(router.state.location.search).toBe(''));
  });

  it('says so when no account matches', async () => {
    stubApi({ 'GET /admin/users': () => pageOf([]) });
    renderPanel(<UsersPanel />);
    expect(await screen.findByText('No accounts yet.', undefined, LOAD)).toBeInTheDocument();
  });

  it('shows the error state when the list is refused', async () => {
    stubApi({ 'GET /admin/users': () => json({ code: 'forbidden' }, 403) });
    renderPanel(<UsersPanel />);
    expect(
      await screen.findByText(
        'Your account does not hold the permission this section needs.',
        undefined,
        LOAD,
      ),
    ).toBeInTheDocument();
  });

  it('sends the administrator role to the invitation flow when the server refuses it', async () => {
    const { requests } = stubApi({
      'GET /admin/users': () => pageOf([ADMIN, userView()]),
      'PATCH /admin/users/usr_doctor': () =>
        json(
          {
            code: 'two_factor_required',
            message: 'Conflict',
            detail: 'The admin role requires an enrolled second factor.',
          },
          409,
        ),
    });
    const user = userEvent.setup();
    renderPanel(<UsersPanel />);
    await screen.findByText('Dr. Amelia Chen', undefined, LOAD);

    await user.click(screen.getByRole('combobox', { name: 'Role for Dr. Amelia Chen' }));
    await user.click(screen.getByRole('option', { name: 'Administrator' }));
    await waitFor(() =>
      expect(toasts[0]).toMatchObject({
        variant: 'error',
        title: 'Could not update Dr. Amelia Chen',
        description: expect.stringContaining('by invitation only') as unknown,
      }),
    );
    expect(requests.find((request) => request.method === 'PATCH')?.body).toEqual({ role: 'admin' });
    // The row still shows what the server holds, not what was asked for.
    expect(screen.getByRole('combobox', { name: 'Role for Dr. Amelia Chen' })).toHaveTextContent(
      'Doctor',
    );
  });

  it('deactivates an account and re-reads the list from the server', async () => {
    let active = true;
    const { requests } = stubApi({
      'GET /admin/users': () => pageOf([userView({ active })]),
      'PATCH /admin/users/usr_doctor': () => {
        active = false;
        return envelope(userView({ active }));
      },
    });
    const user = userEvent.setup();
    renderPanel(<UsersPanel />);

    await user.click(await screen.findByRole('switch', { name: 'Dr. Amelia Chen active' }, LOAD));
    await waitFor(() => expect(toasts[0]?.title).toBe('Dr. Amelia Chen updated'));
    expect(await screen.findByText('Deactivated')).toBeInTheDocument();
    expect(requests.filter((request) => request.path === '/admin/users')).toHaveLength(2);
  });
});

describe('the live staff invitation', () => {
  it('checks the address, shows a duplicate refusal, then sends', async () => {
    let sent = 0;
    const { requests } = stubApi({
      'GET /admin/users': () => pageOf([userView()]),
      'POST /auth/admin-invitations': (request) => {
        const { email } = request.body as { email: string };
        if (email === 'doctor@medora.health') {
          return json(
            {
              code: 'email_taken',
              message: 'Email already registered',
              detail: 'An account with this email already exists',
            },
            409,
          );
        }
        sent += 1;
        return envelope({ email, role: 'admin', expiresAt: '2026-10-08T12:00:00.000Z' });
      },
    });
    const user = userEvent.setup();
    renderPanel(<UsersPanel />);
    await screen.findByText('Dr. Amelia Chen', undefined, LOAD);

    await user.click(screen.getByRole('button', { name: 'Invite staff member' }));
    const dialog = await screen.findByRole('dialog', undefined, LOAD);
    const email = within(dialog).getByLabelText('Work email');

    await user.type(email, 'not-an-address');
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }));
    expect(within(dialog).getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(requests.some((request) => request.method === 'POST')).toBe(false);

    await user.clear(email);
    await user.type(email, 'doctor@medora.health');
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }));
    expect(
      await within(dialog).findByText('An account with this email already exists.'),
    ).toBeInTheDocument();

    await user.clear(email);
    await user.type(email, 'new.admin@medora.health');
    await user.click(within(dialog).getByRole('combobox', { name: 'Role' }));
    await user.click(within(dialog).getByRole('option', { name: 'Administrator' }));
    expect(within(dialog).getByText(/enrol an authenticator app/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }));

    await waitFor(() => expect(toasts[0]?.title).toBe('Invitation sent'));
    expect(sent).toBe(1);
    expect(requests.filter((request) => request.method === 'POST').at(-1)?.body).toEqual({
      email: 'new.admin@medora.health',
      role: 'admin',
    });
  });

  it('offers only the roles an invitation may confer', async () => {
    stubApi({ 'GET /admin/users': () => pageOf([]) });
    const user = userEvent.setup();
    renderPanel(<UsersPanel />);
    await screen.findByText('No accounts yet.', undefined, LOAD);

    await user.click(screen.getByRole('button', { name: 'Invite staff member' }));
    const dialog = await screen.findByRole('dialog', undefined, LOAD);
    await user.click(within(dialog).getByRole('combobox', { name: 'Role' }));
    const roles = within(dialog)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(roles).toEqual(['Administrator', 'Reception', 'Laboratory', 'Pharmacy']);
  });

  it('words a refused permission plainly', async () => {
    stubApi({
      'GET /admin/users': () => pageOf([]),
      'POST /auth/admin-invitations': () => json({ code: 'forbidden' }, 403),
    });
    const user = userEvent.setup();
    renderPanel(<UsersPanel />);
    await screen.findByText('No accounts yet.', undefined, LOAD);

    await user.click(screen.getByRole('button', { name: 'Invite staff member' }));
    const dialog = await screen.findByRole('dialog', undefined, LOAD);
    await user.type(within(dialog).getByLabelText('Work email'), 'a@medora.health');
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }));
    expect(await within(dialog).findByText(/does not hold the permission/)).toBeInTheDocument();
  });
});

describe('the live permission matrix', () => {
  it('reads the grid and the active counts from the server, and offers no reset', async () => {
    stubApi({
      'GET /roles/matrix': () =>
        envelope({
          matrix: DEFAULT_PERMISSION_MATRIX,
          revision: 4,
          updatedAt: '2026-10-01T09:00:00.000Z',
          updatedBy: null,
        }),
      'GET /roles': () =>
        envelope([roleView('admin', 'Administrator', 1), roleView('doctor', 'Doctor', 5)]),
    });
    renderPanel(<PermissionMatrixPanel />);

    expect(await screen.findByText(/Revision 4/, undefined, LOAD)).toHaveTextContent(
      'Platform baseline',
    );
    expect(screen.getByText('5 active')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset defaults' })).not.toBeInTheDocument();
  });

  it('shows the error state when the matrix cannot be read', async () => {
    stubApi({
      'GET /roles/matrix': () => json({ code: 'internal', ref: 'E' }, 500),
      'GET /roles': () => envelope([]),
    });
    renderPanel(<PermissionMatrixPanel />);
    expect(
      await screen.findByText("Couldn't load this section", undefined, LOAD),
    ).toBeInTheDocument();
  });
});

describe('the live permission matrix review — the server’s dry run (API §15.3)', () => {
  const grant = { role: 'reception', capability: 'records.view', next: true, phi: true };

  function routes(preview: () => unknown) {
    return stubApi({
      'GET /roles/matrix': () =>
        envelope({
          matrix: DEFAULT_PERMISSION_MATRIX,
          revision: 4,
          updatedAt: '2026-10-01T09:00:00.000Z',
          updatedBy: null,
        }),
      'GET /roles': () =>
        envelope([roleView('admin', 'Administrator', 1), roleView('reception', 'Reception', 3)]),
      'POST /roles/matrix/preview': preview,
      'PUT /roles/matrix': () =>
        envelope({
          matrix: DEFAULT_PERMISSION_MATRIX,
          revision: 5,
          updatedAt: '2026-10-25T09:00:00.000Z',
          updatedBy: null,
        }),
    });
  }

  function previewView(overrides: Record<string, unknown> = {}) {
    return {
      changes: [grant],
      // Deliberately not the client's own count (3): the dialog must show the server's.
      roles: [{ role: 'reception', grants: 1, revokes: 0, activeUsers: 7 }],
      affectedUsers: 7,
      phiGrants: [grant],
      orphaned: [],
      ...overrides,
    };
  }

  async function openReview() {
    const user = userEvent.setup();
    renderPanel(<PermissionMatrixPanel />);
    const table = await screen.findByRole('table', undefined, LOAD);
    await user.click(
      within(table).getByRole('switch', { name: /^View medical records for Reception/ }),
    );
    await user.click(screen.getByRole('button', { name: /Review & save/ }));
    const title = screen.getByText('Review permission changes');
    const dialog = title.closest('dialog');
    if (dialog === null) throw new Error('no review dialog');
    return { user, dialog: within(dialog) };
  }

  it('shows the server’s answer and writes nothing until it is confirmed', async () => {
    const { requests } = routes(() => envelope(previewView()));
    const { user, dialog } = await openReview();

    expect(
      await dialog.findByText('7 active accounts across 1 role.', undefined, LOAD),
    ).toBeInTheDocument();
    expect(dialog.getByText(/This grants access to patient data/)).toBeInTheDocument();
    const preview = requests.find((request) => request.path === '/roles/matrix/preview');
    expect(preview?.method).toBe('POST');
    expect((preview?.body as { grid: Record<string, string[]> }).grid.reception).toContain(
      'records.view',
    );
    expect(requests.some((request) => request.method === 'PUT')).toBe(false);

    await user.click(dialog.getByRole('button', { name: 'Apply 1 change' }));
    await waitFor(() => {
      expect(toasts).toContainEqual(
        expect.objectContaining({
          title: 'Permissions updated',
          description: '1 change applied to 7 accounts.',
        }),
      );
    });
    expect(requests.find((request) => request.method === 'PUT')?.body).toMatchObject({
      revision: 4,
      confirm: true,
    });
  });

  it('withholds Apply when the dry run fails, and checks again on request', async () => {
    let calls = 0;
    const { requests } = routes(() => {
      calls += 1;
      return calls === 1 ? json({ code: 'internal', ref: 'E1' }, 500) : envelope(previewView());
    });
    const { user, dialog } = await openReview();

    expect(
      await dialog.findByText('Couldn’t check this change', undefined, LOAD),
    ).toBeInTheDocument();
    expect(dialog.getByText(/Nothing has been saved\./)).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Apply changes' })).toBeDisabled();

    await user.click(dialog.getByRole('button', { name: 'Check again' }));
    expect(await dialog.findByRole('button', { name: 'Apply 1 change' }, LOAD)).toBeEnabled();
    expect(requests.some((request) => request.method === 'PUT')).toBe(false);
  });

  it('withholds Apply when the server says no role would hold a capability', async () => {
    const { requests } = routes(() => envelope(previewView({ orphaned: ['logs.export'] })));
    const { dialog } = await openReview();

    expect(
      await dialog.findByText('No role would hold these capabilities', undefined, LOAD),
    ).toBeInTheDocument();
    expect(dialog.getByText(/^Export system logs\./)).toBeInTheDocument();
    expect(dialog.getByRole('button', { name: 'Apply 1 change' })).toBeDisabled();
    expect(requests.some((request) => request.method === 'PUT')).toBe(false);
  });
});

describe('live roles (API §15.1, §15.4 — DEC-013)', () => {
  it('lists custom roles with their base, and says they have no web workspace', async () => {
    stubApi({
      'GET /roles': () =>
        envelope([
          roleView('doctor', 'Doctor', 5),
          roleView('senior_nurse', 'Senior nurse', 2, 'reception'),
        ]),
    });
    renderPanel(<RolesSection />);

    const item = (await screen.findByText('Senior nurse', undefined, LOAD)).closest('li');
    expect(item).not.toBeNull();
    const row = within(item as HTMLElement);
    expect(row.getByText('Custom')).toBeInTheDocument();
    expect(row.getByText('Based on Reception', { exact: false })).toBeInTheDocument();
    expect(row.getByText(/No web workspace yet/)).toBeInTheDocument();
  });

  it('creates a role with exactly the body the API takes, and shows it once re-read', async () => {
    let created = false;
    const { requests } = stubApi({
      'GET /roles': () =>
        envelope([
          roleView('reception', 'Reception', 1),
          ...(created ? [roleView('ward-clerk', 'Ward clerk', 0, 'reception')] : []),
        ]),
      'POST /roles': () => {
        created = true;
        return json(envelope(roleView('ward-clerk', 'Ward clerk', 0, 'reception')), 201);
      },
    });
    const user = userEvent.setup();
    renderPanel(<RolesSection />);

    await user.click(await screen.findByRole('button', { name: 'New custom role' }, LOAD));
    const dialog = within(screen.getByRole('dialog'));
    await user.type(dialog.getByLabelText('Name'), 'Ward clerk');
    await user.type(dialog.getByLabelText('Code'), 'Ward-Clerk');
    await user.click(dialog.getByRole('combobox', { name: 'Base role' }));
    await user.click(screen.getByRole('option', { name: 'Reception' }));
    await user.click(dialog.getByRole('button', { name: 'Create role' }));

    await waitFor(() =>
      expect(requests.find((request) => request.method === 'POST')?.body).toEqual({
        code: 'ward-clerk',
        label: 'Ward clerk',
        baseRole: 'reception',
      }),
    );
    expect(await screen.findByText('Ward clerk', undefined, LOAD)).toBeInTheDocument();
    expect(toasts.at(-1)).toMatchObject({ variant: 'success', title: 'Role created' });
  });

  it('shows the server’s refusal and creates nothing on a 409', async () => {
    stubApi({
      'GET /roles': () => envelope([roleView('reception', 'Reception', 1)]),
      'POST /roles': () =>
        json(
          {
            code: 'conflict',
            title: 'Conflict',
            detail: 'A role with the code "clerk" already exists',
          },
          409,
        ),
    });
    const user = userEvent.setup();
    renderPanel(<RolesSection />);

    await user.click(await screen.findByRole('button', { name: 'New custom role' }, LOAD));
    const dialog = within(screen.getByRole('dialog'));
    await user.type(dialog.getByLabelText('Name'), 'Clerk');
    await user.type(dialog.getByLabelText('Code'), 'clerk');
    await user.click(dialog.getByRole('combobox', { name: 'Base role' }));
    await user.click(screen.getByRole('option', { name: 'Reception' }));
    await user.click(dialog.getByRole('button', { name: 'Create role' }));

    expect(await dialog.findByText('No role was created')).toBeInTheDocument();
    expect(toasts.some((entry) => entry.title === 'Role created')).toBe(false);
  });

  it('names a custom role in the Users panel instead of printing its code', async () => {
    stubApi({
      'GET /admin/users': () =>
        pageOf([userView({ id: 'usr_n', name: 'Nora Haddad', role: 'senior_nurse' })]),
      'GET /roles': () => envelope([roleView('senior_nurse', 'Senior nurse', 1, 'reception')]),
    });
    renderPanel(<UsersPanel />);

    await screen.findByText('Nora Haddad', undefined, LOAD);
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Role for Nora Haddad' })).toHaveTextContent(
        'Senior nurse',
      ),
    );
  });
});
