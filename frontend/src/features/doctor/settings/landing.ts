import { routes } from '@/routes';

import { workflowStore } from './model/store';
import type { LandingPage } from './model/types';

/**
 * Resolves the doctor's chosen default landing page (Preferences section)
 * to a route, so the app's root redirect honors it. Reading the persisted
 * settings document here is what makes the landing-page preference real
 * rather than cosmetic. Falls back to the dashboard overview.
 */
const LANDING_ROUTE: Record<LandingPage, string> = {
  overview: routes.doctor.overview,
  patients: routes.doctor.patients,
  appointments: routes.doctor.appointments,
  labs: routes.doctor.labs,
  messages: routes.doctor.messages,
};

export function getDoctorLandingPath(userId: string): string {
  try {
    const landing = workflowStore.read(userId).landingPage;
    return LANDING_ROUTE[landing] ?? routes.doctor.overview;
  } catch {
    return routes.doctor.overview;
  }
}
