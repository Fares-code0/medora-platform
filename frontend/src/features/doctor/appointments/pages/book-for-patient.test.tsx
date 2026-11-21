import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AppProviders } from '@/app/providers';
import { routes } from '@/routes';

import { appointmentService } from '../service';

import { AppointmentsPage } from './AppointmentsPage';
import { NewAppointmentPage } from './NewAppointmentPage';

/**
 * NEW-06 — "Schedule appointment" carries the patient.
 *
 * The patient row and the profile header used to navigate to the bare book,
 * so the doctor had to find the patient they had just been looking at a
 * second time. `routes.doctor.bookAppointment({ patientId })` is the
 * contract: it opens the New Appointment page with that patient chosen.
 *
 * Booking was a dialog on the book, reached by `?book=<patientId>`. It is a
 * page now, and the book redirects an old `?book=` link to it — patient
 * kept, param gone — so bookmarks and links already out there still work.
 */

const LOAD = { timeout: 10_000 };
const CASE_TIMEOUT = 30_000;

beforeAll(() => {
  const proto = window.HTMLDialogElement.prototype as unknown as Record<string, unknown>;
  proto['showModal'] = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  proto['close'] = function close(this: HTMLDialogElement) {
    this.open = false;
  };
  // Data-router navigations build a Request; jsdom's AbortSignal is not
  // undici's. The structural stand-in `features/admin/routes.test.tsx` uses.
  vi.stubGlobal(
    'Request',
    class {
      readonly url: string;
      readonly signal: AbortSignal | undefined;
      constructor(url: string, init?: { signal?: AbortSignal }) {
        this.url = url;
        this.signal = init?.signal;
      }
    },
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function renderAt(entry: string) {
  vi.spyOn(appointmentService, 'listAppointments').mockResolvedValue([]);
  const router = createMemoryRouter(
    [
      { path: '/doctor/appointments', element: <AppointmentsPage /> },
      { path: '/doctor/appointments/new', element: <NewAppointmentPage /> },
    ],
    { initialEntries: [entry] },
  );
  render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>,
  );
  return router;
}

function bookingPage() {
  return screen.findByRole('heading', { name: 'New appointment', level: 1 }, LOAD);
}

describe('booking for a patient (NEW-06)', () => {
  it('builds a booking URL that names the patient', () => {
    expect(routes.doctor.bookAppointment({ patientId: 'PT-1001' })).toBe(
      '/doctor/appointments/new?patient=PT-1001',
    );
    expect(routes.doctor.bookAppointment()).toBe('/doctor/appointments/new');
  });

  it(
    'opens the New Appointment page with the patient already chosen',
    async () => {
      renderAt(routes.doctor.bookAppointment({ patientId: 'PT-1001' }));

      await bookingPage();
      await waitFor(
        () =>
          expect(screen.getByRole('radio', { name: /Khaled Nassar — MRN 4411-27/ })).toBeChecked(),
        LOAD,
      );
    },
    CASE_TIMEOUT,
  );

  it(
    'leaves the picker empty for a patient the directory does not hold',
    async () => {
      renderAt(routes.doctor.bookAppointment({ patientId: 'PT-9999' }));

      await bookingPage();
      const radios = await screen.findAllByRole('radio', undefined, LOAD);
      // Give a stale preset every chance to land before asserting it did not.
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(radios.some((radio) => (radio as HTMLInputElement).checked)).toBe(false);
    },
    CASE_TIMEOUT,
  );

  it(
    'opens a blank booking when no patient is named',
    async () => {
      renderAt(routes.doctor.bookAppointment());

      await bookingPage();
      const radios = await screen.findAllByRole('radio', undefined, LOAD);
      expect(radios.some((radio) => (radio as HTMLInputElement).checked)).toBe(false);
    },
    CASE_TIMEOUT,
  );

  it(
    'redirects an old ?book= link to the page, keeping the patient and dropping the param',
    async () => {
      const router = renderAt('/doctor/appointments?book=PT-1001');

      await bookingPage();
      expect(`${router.state.location.pathname}${router.state.location.search}`).toBe(
        '/doctor/appointments/new?patient=PT-1001',
      );
      await waitFor(
        () => expect(screen.getByRole('radio', { name: /Khaled Nassar/ })).toBeChecked(),
        LOAD,
      );
      // Replaced, not pushed: going back does not land on the param again.
      expect(router.state.historyAction).toBe('REPLACE');
    },
    CASE_TIMEOUT,
  );

  it(
    'redirects an empty ?book= to a blank booking',
    async () => {
      const router = renderAt('/doctor/appointments?book=');

      await bookingPage();
      expect(`${router.state.location.pathname}${router.state.location.search}`).toBe(
        '/doctor/appointments/new',
      );
    },
    CASE_TIMEOUT,
  );

  it(
    'opens the page from the book’s New appointment button',
    async () => {
      const router = renderAt(routes.doctor.appointments);

      await userEvent.click(await screen.findByRole('button', { name: 'New appointment' }, LOAD));
      await bookingPage();
      expect(router.state.location.pathname).toBe('/doctor/appointments/new');
    },
    CASE_TIMEOUT,
  );

  it(
    'stays on the book without the param',
    async () => {
      const router = renderAt(routes.doctor.appointments);

      await screen.findByRole('button', { name: 'New appointment' }, LOAD);
      expect(router.state.location.pathname).toBe('/doctor/appointments');
      expect(
        screen.queryByRole('heading', { name: 'New appointment', level: 1 }),
      ).not.toBeInTheDocument();
    },
    CASE_TIMEOUT,
  );
});
