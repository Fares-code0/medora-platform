import type { RouteObject } from 'react-router-dom';

import { RequirePermission } from '@/app/router/guards';
import type { RouteHandle } from '@/layouts';
import { routes } from '@/routes';

/**
 * Medical-records feature routes — FRONTEND_ARCHITECTURE.md §3.4 / §5.3.
 * The list and the record detail are lazy boundaries; the shell
 * breadcrumb reads `handle.crumb`.
 */
export const medicalRecordsRoutes: readonly RouteObject[] = [
  {
    path: routes.doctor.medicalRecords,
    handle: { crumb: 'Medical records' } satisfies RouteHandle,
    lazy: async () => {
      const { MedicalRecordsPage } = await import('./pages/MedicalRecordsPage');
      return { Component: MedicalRecordsPage };
    },
  },
  {
    /*
     * Authoring needs `records.edit` — the capability the API's record
     * controller requires to create a record. The guard renders 403 in place,
     * so a direct link is refused the same way, not merely hidden.
     */
    element: <RequirePermission permission="records.edit" />,
    children: [
      {
        /*
         * Declared before `:recordId` so the static segment wins the match —
         * react-router ranks static above dynamic, but the order is kept
         * explicit because a reader should not have to know that to be sure.
         */
        path: `${routes.doctor.medicalRecords}/new`,
        handle: { crumb: 'New record' } satisfies RouteHandle,
        lazy: async () => {
          const { NewMedicalRecordPage } = await import('./pages/NewMedicalRecordPage');
          return { Component: NewMedicalRecordPage };
        },
      },
    ],
  },
  {
    path: `${routes.doctor.medicalRecords}/:recordId`,
    handle: { crumb: 'Record' } satisfies RouteHandle,
    lazy: async () => {
      const { MedicalRecordDetailPage } = await import('./pages/MedicalRecordDetailPage');
      return { Component: MedicalRecordDetailPage };
    },
  },
];
