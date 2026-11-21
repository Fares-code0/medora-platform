import type { RouteObject } from 'react-router-dom';

import type { RouteHandle } from '@/layouts';
import { routes } from '@/routes';

/**
 * The doctor's own clinic board (D-27b). Lazy, like every feature route.
 */
export const clinicRoutes: readonly RouteObject[] = [
  {
    path: routes.doctor.myClinic,
    handle: { crumb: 'My clinic' } satisfies RouteHandle,
    lazy: async () => {
      const { MyClinicPage } = await import('./pages/MyClinicPage');
      return { Component: MyClinicPage };
    },
  },
];
