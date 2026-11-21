import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { routes } from '@/routes';

import { LegacyAdministrationRoute } from './LegacyAdministrationRoute';

/**
 * The administration area moved from /doctor/administration to /admin in
 * Phase B. Anyone holding an old bookmark, or any link written before the
 * move, must land somewhere that makes sense rather than a 404.
 *
 * **D-27 split that by role.** An administrator still lands on the
 * equivalent new page. A DOCTOR used to be redirected too — into
 * `/admin/queue`, which `RequireRole` answers with a 403 reading "Your
 * account doesn't include permission to view this area… contact your
 * administrator". Wrong twice: it blames the doctor's permissions for a
 * deliberate product decision, and it sends them to escalate something no
 * administrator can grant. They now get told what happened.
 */

const user = vi.fn<() => { role: 'admin' | 'doctor' } | null>();

vi.mock('@/app/providers', () => ({ useAuth: () => ({ user: user() }) }));

function Landing() {
  const { pathname, search } = useLocation();
  return <span data-testid="landed">{pathname + search}</span>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter
      initialEntries={[path]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route
          path={`${routes.legacy.administrationRoot}/*`}
          element={<LegacyAdministrationRoute />}
        />
        <Route path={`${routes.admin.root}/*`} element={<Landing />} />
        <Route path={`${routes.doctor.appointments}`} element={<Landing />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('an administrator on an old administration URL', () => {
  beforeEach(() => {
    user.mockReturnValue({ role: 'admin' });
  });

  it('sends the old area root to the new area root', () => {
    renderAt('/doctor/administration');

    expect(screen.getByTestId('landed')).toHaveTextContent('/admin');
  });

  it('carries a section slug across', () => {
    renderAt('/doctor/administration/staff');

    expect(screen.getByTestId('landed')).toHaveTextContent('/admin/staff');
  });

  it('carries a deep-linked settings panel across', () => {
    renderAt('/doctor/administration/settings/security');

    expect(screen.getByTestId('landed')).toHaveTextContent('/admin/settings/security');
  });

  it('preserves the query string', () => {
    renderAt('/doctor/administration/queue?filter=urgent');

    expect(screen.getByTestId('landed')).toHaveTextContent('/admin/queue?filter=urgent');
  });

  it('tolerates a trailing slash', () => {
    renderAt('/doctor/administration/');

    expect(screen.getByTestId('landed')).toHaveTextContent('/admin');
  });
});

describe('a doctor on an old administration URL', () => {
  beforeEach(() => {
    user.mockReturnValue({ role: 'doctor' });
  });

  it('is told the area moved, instead of being bounced into a 403', () => {
    renderAt('/doctor/administration/queue');

    expect(screen.getByText(/Clinic operations moved/i)).toBeInTheDocument();
    // The old path bounced here and RequireRole answered "contact your
    // administrator" — advice about a deliberate product decision that no
    // administrator can act on.
    expect(screen.queryByTestId('landed')).not.toBeInTheDocument();
  });

  it('names where their own clinic day actually is', () => {
    renderAt('/doctor/administration/waiting-room');

    const link = screen.getByRole('link', { name: /my appointments/i });
    expect(link).toHaveAttribute('href', routes.doctor.appointments);
  });

  it('says the same thing for every old section, including the area root', () => {
    for (const path of [
      '/doctor/administration',
      '/doctor/administration/rooms',
      '/doctor/administration/shifts',
    ]) {
      const { unmount } = renderAt(path);
      expect(screen.getByText(/Clinic operations moved/i)).toBeInTheDocument();
      unmount();
    }
  });
});
