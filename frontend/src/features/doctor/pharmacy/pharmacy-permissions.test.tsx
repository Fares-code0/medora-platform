import { render, screen } from '@testing-library/react';
import { createMemoryRouter, MemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '@/app/providers';
import type * as Providers from '@/app/providers';

import { PharmacyPage } from './pages/PharmacyPage';
import { pharmacyRoutes } from './routes';
import { prescriptionService } from './service';

/**
 * Writing a prescription needs `prescriptions.create` — the capability the
 * API's prescription controller requires on every route. The page-header
 * button is shown only to a user who holds it, and the authoring route itself
 * is guarded by `RequirePermission`, so a direct link is refused with 403
 * rather than merely having its button hidden.
 */

const access = vi.hoisted(() => ({ permissions: [] as string[] }));

vi.mock('@/app/providers', async (importOriginal) => ({
  ...(await importOriginal<typeof Providers>()),
  useCan: () => (permission: string) => access.permissions.includes(permission),
}));

// The authoring flow itself is covered by its own suite; here only whether
// the route lets the user reach it matters.
vi.mock('./pages/NewPrescriptionPage', () => ({
  NewPrescriptionPage: () => <h1>New prescription form</h1>,
}));

beforeAll(() => {
  // Every data-router navigation builds a Request. Under jsdom the global
  // Request is Node's (undici) while AbortSignal is jsdom's, and undici
  // rejects a signal from another realm — an environment artifact, not app
  // behaviour. The same structural stand-in `features/admin/routes.test.tsx`
  // uses; these routes have no loaders.
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

afterEach(() => {
  access.permissions = [];
  vi.restoreAllMocks();
});

function renderList() {
  vi.spyOn(prescriptionService, 'listPrescriptions').mockReturnValue(new Promise(() => undefined));
  return render(
    <MemoryRouter initialEntries={['/doctor/pharmacy']}>
      <AppProviders>
        <PharmacyPage />
      </AppProviders>
    </MemoryRouter>,
  );
}

function visit(path: string) {
  const router = createMemoryRouter([...pharmacyRoutes], { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

describe('Pharmacy page header — New prescription', () => {
  it('is offered to a user with prescriptions.create', () => {
    access.permissions = ['prescriptions.create'];
    renderList();
    expect(screen.getByRole('button', { name: 'New prescription' })).toBeInTheDocument();
  });

  it('is not offered to a user without it', () => {
    renderList();
    expect(screen.queryByRole('button', { name: 'New prescription' })).not.toBeInTheDocument();
    // The rest of the header is untouched.
    expect(screen.getByRole('heading', { name: 'Pharmacy' })).toBeInTheDocument();
  });
});

describe('New prescription route', () => {
  it('opens the authoring flow for a user with prescriptions.create', async () => {
    access.permissions = ['prescriptions.create'];
    visit('/doctor/pharmacy/new');
    expect(await screen.findByRole('heading', { name: 'New prescription form' })).toBeInTheDocument();
    expect(screen.queryByText('403')).not.toBeInTheDocument();
  });

  it('refuses a direct visit without it, with 403 in place', async () => {
    visit('/doctor/pharmacy/new?patient=pt-1');
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'New prescription form' })).not.toBeInTheDocument();
  });
});
