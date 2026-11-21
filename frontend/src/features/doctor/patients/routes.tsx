import type { RouteObject } from 'react-router-dom';

import type { RouteHandle } from '@/layouts';
import { routes } from '@/routes';

/**
 * Patients feature routes — FRONTEND_ARCHITECTURE.md §3.4 / §5.3.
 * The list (Phase 3) and the profile (Phase 4, UX 2.3) are lazy
 * boundaries; the shell breadcrumb reads `handle.crumb`.
 */
export const patientsRoutes: readonly RouteObject[] = [
  {
    path: routes.doctor.patients,
    handle: { crumb: 'Patients' } satisfies RouteHandle,
    lazy: async () => {
      const { PatientsPage } = await import('./pages/PatientsPage');
      return { Component: PatientsPage };
    },
  },
  {
    // Declared before `:patientId` so the static segment visibly wins.
    path: routes.doctor.newPatient,
    handle: { crumb: 'Add patient' } satisfies RouteHandle,
    lazy: async () => {
      const { NewPatientPage } = await import('./pages/NewPatientPage');
      return { Component: NewPatientPage };
    },
  },
  {
    path: `${routes.doctor.patients}/:patientId`,
    handle: { crumb: 'Patient profile' } satisfies RouteHandle,
    lazy: async () => {
      const { PatientProfilePage } = await import('./pages/PatientProfilePage');
      return { Component: PatientProfilePage };
    },
  },
];
