import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import type { NavigateFunction } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { apiClient } from '@/api/client';
import type * as Providers from '@/app/providers';
import { AuthProvider, useAuth } from '@/app/providers/AuthProvider';
import { QueryProvider } from '@/app/providers/QueryProvider';
import LoginPage from '@/features/auth/pages/LoginPage';
import { authService } from '@/features/auth/service';
import { LocaleProvider } from '@/i18n';
import { AvatarMenu } from '@/layouts/Navbar/AvatarMenu';
import type { SessionUser } from '@/types/auth';

import { RequireAuth, RequireGuest } from './guards';

/**
 * A-W1 — a returnTo belongs to the account it was captured for.
 *
 * The shell's sign-out did not navigate, so `RequireAuth` sent the tab to
 * `/login?returnTo=<the previous user's path>` and the next user of the same
 * role was walked straight onto it — a patient's record, its id in the URL.
 * These run the real provider (mock path), guards, sign-in page and avatar
 * menu together, because the defect lived in how they combine: the guard
 * that captures returnTo, and the two places (LoginPage, RequireGuest) that
 * honour it under the SAME rule.
 */

vi.mock('@/app/providers', async (importOriginal) => {
  const actual: typeof Providers = await importOriginal();
  return {
    ...actual,
    useDoctorProfile: () => ({ profile: { fullName: 'Dr. Amelia Chen', photo: null } }),
  };
});

const SEEDED_DOCTOR = 'doctor@medora.health';
const PASSWORD = 'Medora123!';
const PATIENT_PAGE = '/doctor/patients/PT-1001';

const probe: { auth: ReturnType<typeof useAuth> | null; navigate: NavigateFunction | null } = {
  auth: null,
  navigate: null,
};

function Probe() {
  probe.auth = useAuth();
  probe.navigate = useNavigate();
  const { pathname, search } = useLocation();
  return (
    <>
      <output data-testid="path">{pathname}</output>
      <output data-testid="search">{search}</output>
    </>
  );
}

let refresh: (() => Promise<string | null>) | null = null;

async function flush(ms = 2_000) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function renderApp(initialPath: string) {
  render(
    <LocaleProvider>
      <QueryProvider>
        <AuthProvider>
          <MemoryRouter
            initialEntries={[initialPath]}
            future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
          >
            <Routes>
              <Route element={<RequireGuest />}>
                <Route path="/login" element={<LoginPage />} />
              </Route>
              <Route element={<RequireAuth />}>
                <Route
                  path="/doctor/patients/:id"
                  element={
                    <>
                      <h1>Patient record</h1>
                      <AvatarMenu />
                    </>
                  }
                />
                <Route path="/doctor/overview" element={<h1>Doctor overview</h1>} />
              </Route>
              <Route path="/" element={<h1>Home</h1>} />
              <Route path="/lock-screen" element={<h1>Locked</h1>} />
            </Routes>
            <Probe />
          </MemoryRouter>
        </AuthProvider>
      </QueryProvider>
    </LocaleProvider>,
  );
  await flush(50);
}

function auth() {
  if (probe.auth === null) throw new Error('probe not mounted');
  return probe.auth;
}

/** Signs the seeded doctor in and opens a patient's record, as account A. */
async function doctorOnPatientPage() {
  await renderApp('/login');
  await act(async () => {
    const pending = auth().login(SEEDED_DOCTOR, PASSWORD);
    await vi.advanceTimersByTimeAsync(2_000);
    await pending;
  });
  act(() => {
    probe.navigate?.(PATIENT_PAGE);
  });
  expect(screen.getByRole('heading', { name: 'Patient record' })).toBeInTheDocument();
  const doctor = auth().user;
  if (doctor === null) throw new Error('no signed-in user');
  expect(doctor.id).toBe('usr_doctor_amelia');
  return doctor;
}

async function signInThroughTheForm(email: string) {
  fireEvent.input(screen.getByLabelText('Email address'), { target: { value: email } });
  fireEvent.input(screen.getByLabelText('Password', { selector: 'input' }), {
    target: { value: PASSWORD },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  await flush();
}

/** A different account of the same role — the case the role check cannot catch. */
function nextLoginIsAnotherDoctor(previous: SessionUser) {
  vi.spyOn(authService, 'login').mockResolvedValue({
    kind: 'session',
    session: {
      user: { ...previous, id: 'usr_doctor_other', email: 'other.doctor@medora.health' },
      accessToken: 'token-for-another-doctor',
      expiresIn: 900,
    },
  });
}

async function sessionRefused() {
  if (refresh === null) throw new Error('no unauthorized handler registered');
  const restore = vi.spyOn(authService, 'restore').mockResolvedValue(null);
  const run = refresh;
  await act(async () => {
    await run();
  });
  restore.mockRestore();
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  window.sessionStorage.clear();
  refresh = null;
  const register = apiClient.setUnauthorizedHandler.bind(apiClient);
  vi.spyOn(apiClient, 'setUnauthorizedHandler').mockImplementation((next) => {
    if (next) refresh = next;
    register(next);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('A-W1 — a returnTo is honoured only for the account it was captured for', () => {
  it('signing out from the shell reaches the sign-in page with no returnTo', async () => {
    await doctorOnPatientPage();

    fireEvent.click(screen.getByRole('button', { name: /Dr\. Amelia Chen/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    await flush();

    expect(auth().status).toBe('unauthenticated');
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/login$/);
    expect(screen.getByTestId('search')).toBeEmptyDOMElement();
  });

  it('sends a different account to its own landing page after the previous session expired', async () => {
    const doctor = await doctorOnPatientPage();
    await sessionRefused();
    // The expired session still captures where its user was…
    expect(screen.getByTestId('search')).toHaveTextContent(
      `?returnTo=${encodeURIComponent(PATIENT_PAGE)}`,
    );

    nextLoginIsAnotherDoctor(doctor);
    await signInThroughTheForm('other.doctor@medora.health');

    // …but someone else signing in is not taken there.
    expect(auth().user?.id).toBe('usr_doctor_other');
    expect(screen.queryByRole('heading', { name: 'Patient record' })).not.toBeInTheDocument();
    expect(screen.getByTestId('path')).toHaveTextContent(/^\/doctor\/overview$/);
  });

  it('returns the same account to where it was after its session expired', async () => {
    await doctorOnPatientPage();
    await sessionRefused();

    await signInThroughTheForm(SEEDED_DOCTOR);

    expect(auth().user?.id).toBe('usr_doctor_amelia');
    expect(screen.getByTestId('path')).toHaveTextContent(PATIENT_PAGE);
  });

  it('honours a deep link opened on a fresh load, where no previous account is known', async () => {
    await renderApp(`/login?returnTo=${encodeURIComponent(PATIENT_PAGE)}`);
    expect(auth().previousUserId).toBeNull();

    await signInThroughTheForm(SEEDED_DOCTOR);

    expect(screen.getByTestId('path')).toHaveTextContent(PATIENT_PAGE);
  });
});
