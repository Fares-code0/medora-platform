import type { RouteObject } from 'react-router-dom';

import { RequirePermission } from '@/app/router/guards';
import type { RouteHandle } from '@/layouts';
import { routes } from '@/routes';

/**
 * Pharmacy feature routes — FRONTEND_ARCHITECTURE.md §3.4 / §5.3.
 * The list and the prescription detail are lazy boundaries; the shell
 * breadcrumb reads `handle.crumb`.
 */
export const pharmacyRoutes: readonly RouteObject[] = [
  {
    path: routes.doctor.pharmacy,
    handle: { titleKey: 'nav.pharmacy' } satisfies RouteHandle,
    lazy: async () => {
      const { PharmacyPage } = await import('./pages/PharmacyPage');
      return { Component: PharmacyPage };
    },
  },
  {
    /*
     * Authoring needs `prescriptions.create` — the capability the API's
     * prescription controller requires on every route. The guard renders 403
     * in place, so a direct link, a bookmark or any in-app entry point is
     * refused the same way, not merely hidden.
     */
    element: <RequirePermission permission="prescriptions.create" />,
    children: [
      {
        /*
         * Static, so it outranks `:prescriptionId` in react-router's ranking —
         * `/doctor/pharmacy/new` is the authoring flow, never a prescription
         * whose id happens to be "new".
         */
        path: `${routes.doctor.pharmacy}/new`,
        handle: { titleKey: 'route.newPrescription' } satisfies RouteHandle,
        lazy: async () => {
          const { NewPrescriptionPage } = await import('./pages/NewPrescriptionPage');
          return { Component: NewPrescriptionPage };
        },
      },
    ],
  },
  {
    path: `${routes.doctor.pharmacy}/:prescriptionId`,
    handle: { titleKey: 'route.prescription' } satisfies RouteHandle,
    lazy: async () => {
      const { PrescriptionDetailPage } = await import('./pages/PrescriptionDetailPage');
      return { Component: PrescriptionDetailPage };
    },
  },
];
