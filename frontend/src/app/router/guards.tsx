import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router-dom';

import { useAuth, useCan } from '@/app/providers';
import { resolveDestination } from '@/features/auth';
import { routes } from '@/routes';
import { workspaceFor } from '@/routes/workspaces';
import { Logo } from '@/shared/components/branding';
import type { Permission, Role } from '@/types/auth';

import { ForbiddenPage } from '../error-boundary/ErrorPages';

/**
 * Route guards — FRONTEND_ARCHITECTURE.md §5.2.
 * Three composable layers implemented as layout routes. Guards are UX
 * only; the server re-enforces every rule on each request (§12.1).
 */

/** Layer 1 — authentication. Unauthenticated users go to login with returnTo. */
export function RequireAuth() {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'booting') {
    // Full-app bootstrap pattern (DS 8.32) — replaced with the branded
    // splash in Phase 4 when silent refresh exists.
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-5 bg-background">
        <Logo size="lg" label="Medora" />
        <p className="animate-pulse text-body-sm text-text-tertiary">Loading…</p>
      </div>
    );
  }

  if (status === 'locked') {
    return <Navigate to={routes.lockScreen} state={{ from: location }} replace />;
  }

  if (status === 'unauthenticated') {
    const returnTo = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`${routes.login}?returnTo=${returnTo}`} replace />;
  }

  return <Outlet />;
}

/** Layer 2 — role. Wrong role renders 403 (in place, no redirect loop). */
export function RequireRole({ role }: { role: Role }) {
  const { user } = useAuth();

  if (user?.role !== role) {
    return <ForbiddenPage />;
  }

  return <Outlet />;
}

/**
 * Guest-only guard — the inverse of RequireAuth for the public auth surface.
 * Authenticated users never see login/signup/recovery screens; they bounce
 * to their role dashboard (mirrors RootRedirect). A `locked` session still
 * reaches the standalone lock screen, so only `authenticated` redirects here.
 */
export function RequireGuest() {
  const { status, user } = useAuth();
  const [params] = useSearchParams();

  if (status === 'authenticated' && user) {
    // Honour returnTo with the SAME rule LoginPage uses. On a cold boot
    // straight onto /login the two race; when this guard ignored returnTo it
    // won and silently dropped every deep link that required signing in.
    const destination = resolveDestination(params.get('returnTo'), user.role);
    const fallback = workspaceFor(user.role).home;
    return <Navigate to={destination === routes.root ? fallback : destination} replace />;
  }

  return <Outlet />;
}

/** Layer 3 — capability, for sensitive leaf routes (e.g. content access). */
export function RequirePermission({ permission }: { permission: Permission }) {
  const can = useCan();

  if (!can(permission)) {
    return <ForbiddenPage />;
  }

  return <Outlet />;
}
