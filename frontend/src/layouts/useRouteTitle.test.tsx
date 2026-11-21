import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type { RouteHandle } from './navigation';
import { useRouteTitle } from './useRouteTitle';

/**
 * Route title from route handles — the same `handle.crumb` contract the
 * breadcrumb already consumes (FRONTEND_ARCHITECTURE.md §4), so naming a
 * page stays a route-config change rather than per-page code.
 */

function Probe() {
  return <span data-testid="title">{useRouteTitle() ?? '(none)'}</span>;
}

function renderAt(path: string) {
  const router = createMemoryRouter(
    [
      {
        path: '/doctor',
        element: <Probe />,
        handle: { crumb: 'Doctor' } satisfies RouteHandle,
        children: [
          {
            path: 'patients',
            element: null,
            handle: { crumb: 'Patients' } satisfies RouteHandle,
          },
          {
            path: 'patients/:id',
            element: null,
            handle: { crumb: 'Patient profile' } satisfies RouteHandle,
          },
          { path: 'untitled', element: null },
        ],
      },
    ],
    { initialEntries: [path], future: { v7_relativeSplatPath: true } },
  );
  return render(<RouterProvider router={router} future={{ v7_startTransition: true }} />);
}

describe('useRouteTitle', () => {
  it('uses the deepest crumb, not the shell crumb', () => {
    renderAt('/doctor/patients');

    expect(screen.getByTestId('title')).toHaveTextContent('Patients');
  });

  it('follows into a detail route', () => {
    renderAt('/doctor/patients/PT-1001');

    expect(screen.getByTestId('title')).toHaveTextContent('Patient profile');
  });

  it('falls back to the nearest ancestor crumb when a leaf declares none', () => {
    renderAt('/doctor/untitled');

    expect(screen.getByTestId('title')).toHaveTextContent('Doctor');
  });
});
