import { Navigate } from 'react-router-dom';

import { useAuth } from '@/app/providers';
import { getDoctorLandingPath } from '@/features/doctor/settings';
import { routes } from '@/routes';
import { workspaceFor } from '@/routes/workspaces';

/**
 * Root ("/") redirect — sends an authenticated user to their role's landing
 * surface (admins to the Administration Center, doctors to their per-user
 * landing preference) and guests to login.
 */
export function RootRedirect() {
  const { status, user } = useAuth();

  if (status === 'authenticated' && user) {
    // A doctor may choose their landing page; every other role lands on its
    // workspace home (DEC-006a).
    const destination =
      user.role === 'doctor' ? getDoctorLandingPath(user.id) : workspaceFor(user.role).home;
    return <Navigate to={destination} replace />;
  }
  return <Navigate to={routes.login} replace />;
}
