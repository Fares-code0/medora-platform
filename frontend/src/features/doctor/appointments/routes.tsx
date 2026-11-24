import type { RouteObject } from 'react-router-dom';

import type { RouteHandle } from '@/layouts';
import { routes } from '@/routes';

/**
 * Appointments feature routes — FRONTEND_ARCHITECTURE.md §3.4 / §5.3.
 * One lazy chunk for the book; /doctor/appointments/:appointmentId renders
 * the same page with the details drawer open (P3 deep link, UX §1.3). The
 * New Appointment page is a chunk of its own.
 */
const lazyPage = async () => {
  const { AppointmentsPage } = await import('./pages/AppointmentsPage');
  return { Component: AppointmentsPage };
};

export const appointmentsRoutes: readonly RouteObject[] = [
  {
    path: routes.doctor.appointments,
    handle: { titleKey: 'nav.appointments' } satisfies RouteHandle,
    lazy: lazyPage,
  },
  {
    /*
     * Declared before `:appointmentId` so the static segment wins the match —
     * react-router ranks static above dynamic, but the order is kept explicit
     * so a reader does not have to know that to be sure.
     */
    path: routes.doctor.bookAppointment(),
    handle: { titleKey: 'route.newAppointment' } satisfies RouteHandle,
    lazy: async () => {
      const { NewAppointmentPage } = await import('./pages/NewAppointmentPage');
      return { Component: NewAppointmentPage };
    },
  },
  {
    path: `${routes.doctor.appointments}/:appointmentId`,
    handle: { titleKey: 'route.appointment' } satisfies RouteHandle,
    lazy: lazyPage,
  },
];
