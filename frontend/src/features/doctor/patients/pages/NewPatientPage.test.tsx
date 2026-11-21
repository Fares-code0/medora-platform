import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/app/providers/AuthProvider';
import { DoctorProfileProvider } from '@/app/providers/DoctorProfileProvider';
import { ToastProvider } from '@/app/providers/ToastProvider';
import { patientDirectory } from '@/features/shared-domain/patient-identity';
import { routes } from '@/routes';

import { patientsRoutes } from '../routes';

import { NewPatientPage } from './NewPatientPage';

/**
 * Add patient is a page of its own now (it was a modal on the list). These
 * keep the registration contract the dialog had — server field errors land
 * on their fields, an invalid phone never reaches the API, insurance is only
 * asked for where it can be stored — and pin the page's own navigation:
 * reachable at its route, Cancel and browser Back return to the list, and a
 * saved patient opens on their record. Registration against a real server
 * is FE-10.2.
 */

/** Data-router navigation and the lazy route settle asynchronously under load. */
const LOAD = { timeout: 10_000 };

beforeAll(() => {
  // Every data-router navigation builds a Request. Under jsdom the global
  // Request is Node's (undici) while AbortSignal is jsdom's, and undici
  // rejects a signal from another realm — an environment artifact, not app
  // behaviour. The same structural stand-in `NewAppointmentPage.test.tsx`
  // and `features/admin/routes.test.tsx` use; these routes have no loaders.
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
});

function Providers({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AuthProvider>
          <DoctorProfileProvider>{children}</DoctorProfileProvider>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

/** The page between the list and a record, in a data router like the app's. */
function renderPage(initialEntries: string[] = [routes.doctor.newPatient]) {
  const router = createMemoryRouter(
    [
      { path: routes.doctor.patients, element: <p>patients list</p> },
      { path: routes.doctor.newPatient, element: <NewPatientPage /> },
      { path: `${routes.doctor.patients}/:patientId`, element: <p>patient record</p> },
    ],
    { initialEntries, initialIndex: initialEntries.length - 1 },
  );
  render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  );
  return router;
}

async function fillValidForm() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/full name/i), 'Sara Test');
  await user.type(screen.getByLabelText(/date of birth/i), '1990-04-01');
  await user.type(screen.getByLabelText(/^phone/i), '+20 100 555 0101');
  return user;
}

describe('NewPatientPage — registration', () => {
  it('puts a field error from the server on that field, not in a generic toast', async () => {
    vi.spyOn(patientDirectory, 'createPatient').mockRejectedValue(
      Object.assign(new Error('API error: validation'), {
        kind: 'validation',
        fieldErrors: { fullName: ['A patient with this name and date of birth exists'] },
      }),
    );
    renderPage();

    const user = await fillValidForm();
    await user.click(screen.getByRole('button', { name: 'Add patient' }));

    expect(
      await screen.findByText('A patient with this name and date of birth exists'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Could not add patient')).not.toBeInTheDocument();
  });

  it('refuses a phone number the API would refuse, before sending it', async () => {
    const create = vi.spyOn(patientDirectory, 'createPatient');
    renderPage();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/full name/i), 'Sara Test');
    await user.type(screen.getByLabelText(/date of birth/i), '1990-04-01');
    await user.type(screen.getByLabelText(/^phone/i), '(010) 555-0101');
    await user.click(screen.getByRole('button', { name: 'Add patient' }));

    expect(screen.getByText('Enter a valid phone number')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('marks the required fields when submitted empty', async () => {
    const create = vi.spyOn(patientDirectory, 'createPatient');
    renderPage();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Add patient' }));

    expect(screen.getByText('Enter the full name')).toBeInTheDocument();
    expect(screen.getByText('Enter the date of birth')).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('does not collect insurance when the source cannot store it', () => {
    vi.spyOn(patientDirectory, 'capabilities', 'get').mockReturnValue({ insurance: false });
    renderPage();

    expect(screen.queryByLabelText(/insurance/i)).not.toBeInTheDocument();
  });

  it('collects insurance where it can be stored', () => {
    renderPage();

    expect(screen.getByLabelText(/insurance/i)).toBeInTheDocument();
  });

  it('sends one request for a double click, then opens the new record', async () => {
    const create = vi.spyOn(patientDirectory, 'createPatient');
    const router = renderPage();

    const user = await fillValidForm();
    const submit = screen.getByRole('button', { name: 'Add patient' });
    await user.dblClick(submit);

    expect(await screen.findByText('patient record', undefined, LOAD)).toBeInTheDocument();
    expect(create).toHaveBeenCalledTimes(1);
    expect(router.state.location.pathname).toMatch(/^\/doctor\/patients\/(?!new$)/);
    expect(await screen.findByText('Patient added', undefined, LOAD)).toBeInTheDocument();
  });
});

describe('NewPatientPage — navigation', () => {
  it('is the page at the Add Patient route, not a dialog', async () => {
    const router = createMemoryRouter([...patientsRoutes], {
      initialEntries: [routes.doctor.newPatient],
    });
    render(
      <Providers>
        <RouterProvider router={router} />
      </Providers>,
    );

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Add patient' }, LOAD),
    ).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('returns to the list on Cancel', async () => {
    renderPage();

    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' }));

    expect(await screen.findByText('patients list', undefined, LOAD)).toBeInTheDocument();
  });

  it('lets browser Back return to the list it came from', async () => {
    const router = renderPage([routes.doctor.patients, routes.doctor.newPatient]);
    expect(screen.getByRole('heading', { level: 1, name: 'Add patient' })).toBeInTheDocument();

    await router.navigate(-1);

    expect(await screen.findByText('patients list', undefined, LOAD)).toBeInTheDocument();
  });
});
