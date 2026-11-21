import type { ComponentType } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { clinicOperationsApi } from '@/features/shared-domain/clinic-operations/store';
import { adminNavigation } from '@/layouts';
import { pageOf, stubApi } from '@/test/api-stub';

import { adminRoutes, clinicOperationsLoaders } from './routes';
import { AdminSettingsSection } from './sections/settings/AdminSettingsSection';

/**
 * The administration area in a live build (FE-10.10).
 *
 * Every seam in this file selects its HTTP side, as a live build does. The
 * claim is the FE-10 §18 posture for the admin area: a section the API does
 * not serve says "Not connected yet" rather than rendering its seeded demo
 * store — fictional patients, staff and settings next to a real sign-in —
 * while the sections FE-10.10 connected load their real screens.
 */

vi.mock('@/api/seam', () => ({
  selectService: <T,>(implementations: { readonly mock: T; readonly http: T }) =>
    implementations.http,
  selectImplementation: <T,>(_: boolean, implementations: { readonly mock: T; readonly http: T }) =>
    implementations.http,
}));

vi.mock('@/app/providers', () => ({
  useAuth: () => ({ user: { id: 'u1', name: 'Marcus Reed', email: 'admin@medora.health' } }),
  useCan: () => () => true,
  useToast: () => ({ toast: () => undefined }),
}));

beforeAll(() => {
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
  vi.unstubAllGlobals();
  vi.stubGlobal(
    'Request',
    class {
      readonly url: string;
      constructor(url: string) {
        this.url = url;
      }
    },
  );
});

/** A route object's own path, or `index` for the area's landing route. */
function findRoute(path: string): RouteObject {
  const route = adminRoutes.find((entry) => (path === 'index' ? entry.index : entry.path === path));
  if (route === undefined) throw new Error(`no admin route ${path}`);
  return route;
}

async function componentOf(route: RouteObject): Promise<ComponentType> {
  if (typeof route.lazy !== 'function') throw new Error('route is not lazy');
  const loaded = (await route.lazy()) as { Component?: ComponentType };
  if (loaded.Component === undefined) throw new Error('route has no Component');
  return loaded.Component;
}

function renderAt(element: React.ReactNode, path = '/') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const router = createMemoryRouter(
    [
      { path: '/', element },
      { path: '/admin/settings/:panel', element },
    ],
    { initialEntries: [path] },
  );
  return render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('sections the API does not serve', () => {
  it.each([
    ['index', 'Overview'],
    ['clinic', 'Clinic Overview'],
    ['queue', 'Queue Management'],
    ['staff', 'Staff Management'],
    ['logs', 'System Logs'],
    ['reports', 'Reports'],
    ['profile', 'My Profile'],
  ])('%s renders its header over "Not connected yet"', async (path, label) => {
    const Component = await componentOf(findRoute(path));
    renderAt(<Component />);

    expect(screen.getByRole('heading', { name: label })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Not connected yet' })).toBeInTheDocument();
  });

  it('gates the patient roster and conversation viewer, child routes included', async () => {
    for (const parent of ['patients', 'communications']) {
      const children = findRoute(parent).children ?? [];
      expect(children).toHaveLength(2);
      for (const child of children) {
        const Component = await componentOf(child);
        const { unmount } = renderAt(<Component />);
        expect(screen.getByRole('heading', { name: 'Not connected yet' })).toBeInTheDocument();
        unmount();
      }
    }
  });
});

describe('sections FE-10.10 connected', () => {
  it('loads the real appointment oversight and doctor screens', async () => {
    expect((await componentOf(findRoute('appointments'))).name).toBe('AppointmentOversightSection');
    const doctors = findRoute('doctors').children ?? [];
    const names = await Promise.all(doctors.map(async (child) => (await componentOf(child)).name));
    expect(names).toEqual(['DoctorsSection', 'DoctorProfilePage']);
  });

  it('badges the Doctors item with the pending verification count', () => {
    const items = adminNavigation.sections.flatMap((section) => section.items);
    expect(items.find((item) => item.id === 'doctors')?.badgeSource).toBe('pendingRequests');
  });
});

describe('the clinic-operations store', () => {
  it('answers not connected for reads and writes alike', async () => {
    await expect(clinicOperationsApi.staff.list()).rejects.toMatchObject({
      code: 'not_connected',
    });
    await expect(clinicOperationsApi.queue.list()).rejects.toMatchObject({
      code: 'not_connected',
    });
    await expect(clinicOperationsApi.phiAccess.list()).rejects.toMatchObject({
      code: 'not_connected',
    });
  });
});

describe('platform settings', () => {
  it('says the settings document is not connected', async () => {
    renderAt(<AdminSettingsSection />, '/admin/settings/general');
    expect(await screen.findByText('Not connected yet')).toBeInTheDocument();
    expect(screen.queryByText('Medora Clinic Platform')).not.toBeInTheDocument();
  });

  it('still serves the Users panel from the live API', async () => {
    const { requests } = stubApi({
      'GET /admin/users': () =>
        pageOf([
          {
            id: 'usr_doctor',
            name: 'Dr. Amelia Chen',
            email: 'doctor@medora.health',
            role: 'doctor',
            active: true,
            lastActiveAt: null,
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ]),
    });
    renderAt(<AdminSettingsSection />, '/admin/settings/users');

    expect(
      await screen.findByText('Dr. Amelia Chen', undefined, { timeout: 5_000 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Not connected yet' })).not.toBeInTheDocument();
    // The settings document was never asked for — only the live users list
    // and the role list that names custom roles (API §15.1, DEC-013).
    expect(
      requests.every((request) => request.path === '/admin/users' || request.path === '/roles'),
    ).toBe(true);
  });
});

/**
 * The reception workspace serves Queue and Waiting Room through the same
 * loaders as the admin routes, so a live build shows a receptionist exactly
 * what it shows an administrator: the section header over "Not connected
 * yet" — the screens stay demo-only.
 */
describe('Queue and Waiting Room for reception, in a live build', () => {
  it.each([
    ['queue', clinicOperationsLoaders.queue, 'Queue Management'],
    ['waiting-room', clinicOperationsLoaders.waitingRoom, 'Waiting Room'],
  ] as const)('%s renders its header over "Not connected yet"', async (slug, load, label) => {
    const { Component } = await load();
    const { unmount } = renderAt(<Component />);
    expect(screen.getByRole('heading', { name: label })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Not connected yet' })).toBeInTheDocument();
    unmount();

    // The admin route for the same section says exactly the same.
    const Admin = await componentOf(findRoute(slug));
    renderAt(<Admin />);
    expect(screen.getByRole('heading', { name: label })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Not connected yet' })).toBeInTheDocument();
  });
});
