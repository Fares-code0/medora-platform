import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type * as Providers from '@/app/providers';

import { medicalRecordsRoutes } from './routes';

/**
 * Authoring a record needs `records.edit` — the capability the API's record
 * controller requires to create one (`@Can('records.edit')` on its POST). The
 * sidebar shows New Medical Record only to a user who holds it, and the
 * authoring route itself is guarded by `RequirePermission`, so a direct link
 * is refused with 403 rather than merely having its entry hidden. The list
 * and a record's own page keep the access they had.
 */

const access = vi.hoisted(() => ({ permissions: [] as string[] }));

vi.mock('@/app/providers', async (importOriginal) => ({
  ...(await importOriginal<typeof Providers>()),
  useCan: () => (permission: string) => access.permissions.includes(permission),
}));

// The pages themselves are covered by their own suites; here only whether the
// route lets the user reach them matters.
vi.mock('./pages/NewMedicalRecordPage', () => ({
  NewMedicalRecordPage: () => <h1>New medical record form</h1>,
}));
vi.mock('./pages/MedicalRecordsPage', () => ({
  MedicalRecordsPage: () => <h1>Medical records list</h1>,
}));
vi.mock('./pages/MedicalRecordDetailPage', () => ({
  MedicalRecordDetailPage: () => <h1>Medical record detail</h1>,
}));

beforeAll(() => {
  // Every data-router navigation builds a Request. Under jsdom the global
  // Request is Node's (undici) while AbortSignal is jsdom's, and undici
  // rejects a signal from another realm — an environment artifact, not app
  // behaviour. The same structural stand-in the pharmacy and admin route
  // suites use; these routes have no loaders.
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
});

function visit(path: string) {
  const router = createMemoryRouter([...medicalRecordsRoutes], { initialEntries: [path] });
  return render(<RouterProvider router={router} />);
}

describe('New medical record route', () => {
  it('opens the existing authoring flow for a user with records.edit', async () => {
    access.permissions = ['records.view', 'records.edit'];
    visit('/doctor/medical-records/new');
    expect(
      await screen.findByRole('heading', { name: 'New medical record form' }),
    ).toBeInTheDocument();
    expect(screen.queryByText("You don't have access to this page")).not.toBeInTheDocument();
  });

  it('refuses a direct visit without it, with 403 in place', async () => {
    access.permissions = ['records.view'];
    visit('/doctor/medical-records/new?patient=PT-1002');
    expect(await screen.findByText("You don't have access to this page")).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'New medical record form' }),
    ).not.toBeInTheDocument();
  });
});

describe('Medical records list and detail routes', () => {
  it('still open the list without records.edit, as before', async () => {
    access.permissions = ['records.view'];
    visit('/doctor/medical-records');
    expect(
      await screen.findByRole('heading', { name: 'Medical records list' }),
    ).toBeInTheDocument();
  });

  it('still open a record’s own page without records.edit, as before', async () => {
    access.permissions = ['records.view'];
    visit('/doctor/medical-records/MR-2041');
    expect(
      await screen.findByRole('heading', { name: 'Medical record detail' }),
    ).toBeInTheDocument();
  });
});
