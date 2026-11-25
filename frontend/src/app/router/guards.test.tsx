import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { SessionUser, Permission, Role } from '@/types/auth';

import { RequireAuth, RequireGuest, RequirePermission, RequireRole } from './guards';

/**
 * Route guards — FRONTEND_ARCHITECTURE.md §5.2.
 * The guards are the app's only client-side access control, so each branch
 * (booting / locked / unauthenticated / wrong role / missing permission) is
 * pinned here. Auth state is stubbed because the guards' contract is with
 * `useAuth`, not with how a session is established.
 */

type AuthStatus = 'booting' | 'locked' | 'unauthenticated' | 'authenticated';

const authState: {
  status: AuthStatus;
  user: SessionUser | null;
  permissions: Permission[];
  previousUserId: string | null;
  signedOut: boolean;
} = {
  status: 'unauthenticated',
  user: null,
  permissions: [],
  previousUserId: null,
  signedOut: false,
};

vi.mock('@/app/providers', () => ({
  useAuth: () => ({
    status: authState.status,
    user: authState.user,
    previousUserId: authState.previousUserId,
    signedOut: authState.signedOut,
  }),
  useCan: () => (permission: Permission) => authState.permissions.includes(permission),
}));

function signedInAs(role: Role, permissions: Permission[] = []): void {
  authState.status = 'authenticated';
  authState.user = {
    id: 'u1',
    name: 'Test User',
    email: 't@medora.health',
    role,
    permissions,
  };
  authState.permissions = permissions;
}

/** Login landing pad that also exposes the query string, so returnTo is assertable. */
function LoginPad() {
  const { search } = useLocation();
  return (
    <>
      <h1>Login</h1>
      <p data-testid="login-search">{search}</p>
    </>
  );
}

/**
 * Renders a guard over a protected route, with landing pads for each redirect
 * target. Redirect targets are declared OUTSIDE the guarded branch on purpose:
 * nesting `/login` under `RequireAuth` makes the guard redirect to itself
 * forever.
 */
function renderGuard(guard: React.ReactElement, initialPath = '/doctor/labs') {
  return render(
    <MemoryRouter
      initialEntries={[initialPath]}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route element={guard}>
          <Route path="/doctor/labs" element={<h1>Labs</h1>} />
          <Route path="/public" element={<h1>Public</h1>} />
        </Route>
        <Route path="/login" element={<LoginPad />} />
        <Route path="/lock-screen" element={<h1>Locked</h1>} />
        <Route path="/doctor/overview" element={<h1>Doctor overview</h1>} />
        <Route path="/doctor/patients/:id" element={<h1>Patient record</h1>} />
        <Route path="/admin" element={<h1>Admin area</h1>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  authState.status = 'unauthenticated';
  authState.user = null;
  authState.permissions = [];
  authState.previousUserId = null;
  authState.signedOut = false;
});

describe('RequireAuth', () => {
  it('shows a loading splash while the session is booting, never the protected content', () => {
    authState.status = 'booting';

    renderGuard(<RequireAuth />);

    expect(screen.getByText('Loading…')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Labs' })).not.toBeInTheDocument();
  });

  it('sends a locked session to the lock screen', () => {
    authState.status = 'locked';

    renderGuard(<RequireAuth />);

    expect(screen.getByRole('heading', { name: 'Locked' })).toBeInTheDocument();
  });

  it('sends an unauthenticated visitor to login carrying the path as returnTo', () => {
    renderGuard(<RequireAuth />, '/doctor/labs?critical=true');

    expect(screen.getByRole('heading', { name: 'Login' })).toBeInTheDocument();
    expect(screen.getByTestId('login-search')).toHaveTextContent(
      `returnTo=${encodeURIComponent('/doctor/labs?critical=true')}`,
    );
  });

  // A-W1: the address belongs to the user who signed out, not the next one.
  it('sends a user who signed out to login with no returnTo', () => {
    authState.previousUserId = 'u1';
    authState.signedOut = true;

    renderGuard(<RequireAuth />, '/doctor/labs?critical=true');

    expect(screen.getByRole('heading', { name: 'Login' })).toBeInTheDocument();
    expect(screen.getByTestId('login-search')).toBeEmptyDOMElement();
  });

  it('renders the protected route once authenticated', () => {
    signedInAs('doctor');

    renderGuard(<RequireAuth />);

    expect(screen.getByRole('heading', { name: 'Labs' })).toBeInTheDocument();
  });
});

describe('RequireRole', () => {
  it('renders the route for the matching role', () => {
    signedInAs('doctor');

    renderGuard(<RequireRole role="doctor" />);

    expect(screen.getByRole('heading', { name: 'Labs' })).toBeInTheDocument();
  });

  it('renders 403 in place for the wrong role rather than redirecting', () => {
    signedInAs('admin');

    renderGuard(<RequireRole role="doctor" />);

    expect(screen.queryByRole('heading', { name: 'Labs' })).not.toBeInTheDocument();
    expect(screen.getByText(/403/i)).toBeInTheDocument();
  });

  it('renders 403 when there is no user at all', () => {
    renderGuard(<RequireRole role="doctor" />);

    expect(screen.getByText(/403/i)).toBeInTheDocument();
  });
});

describe('RequireGuest', () => {
  it('lets an unauthenticated visitor reach the public surface', () => {
    renderGuard(<RequireGuest />, '/public');

    expect(screen.getByRole('heading', { name: 'Public' })).toBeInTheDocument();
  });

  it('bounces an authenticated doctor to the doctor overview', () => {
    signedInAs('doctor');

    renderGuard(<RequireGuest />, '/public');

    expect(screen.getByRole('heading', { name: 'Doctor overview' })).toBeInTheDocument();
  });

  it('honours returnTo for the account it was captured for', () => {
    signedInAs('doctor');
    authState.previousUserId = 'u1';

    renderGuard(<RequireGuest />, `/public?returnTo=${encodeURIComponent('/doctor/patients/p1')}`);

    expect(screen.getByRole('heading', { name: 'Patient record' })).toBeInTheDocument();
  });

  // A-W1: the SAME rule LoginPage applies — another account's path is not
  // this one's, whatever their shared role.
  it('ignores a returnTo captured for a different account', () => {
    signedInAs('doctor');
    authState.previousUserId = 'someone-else';

    renderGuard(<RequireGuest />, `/public?returnTo=${encodeURIComponent('/doctor/patients/p1')}`);

    expect(screen.getByRole('heading', { name: 'Doctor overview' })).toBeInTheDocument();
  });

  it('bounces an authenticated admin to the admin area', () => {
    signedInAs('admin');

    renderGuard(<RequireGuest />, '/public');

    expect(screen.getByRole('heading', { name: 'Admin area' })).toBeInTheDocument();
  });

  it('leaves a locked session on the public surface so it can reach the lock screen', () => {
    authState.status = 'locked';

    renderGuard(<RequireGuest />, '/public');

    expect(screen.getByRole('heading', { name: 'Public' })).toBeInTheDocument();
  });
});

describe('RequirePermission', () => {
  it('renders the route when the capability is held', () => {
    signedInAs('doctor', ['ai.use']);

    renderGuard(<RequirePermission permission="ai.use" />);

    expect(screen.getByRole('heading', { name: 'Labs' })).toBeInTheDocument();
  });

  it('renders 403 when the capability is missing', () => {
    signedInAs('doctor', []);

    renderGuard(<RequirePermission permission="ai.use" />);

    expect(screen.getByText(/403/i)).toBeInTheDocument();
  });
});
