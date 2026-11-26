import { type ReactNode } from 'react';

import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { apiClient } from '@/api/client';
import { createQueryClient } from '@/api/query-client';
import { listRecentDoctors, recordDoctorView } from '@/features/doctors/recent';
import { createInMemorySecureStore } from '@/storage/secure-store';

import { isIneligibleProbeRefusal } from '@/features/patient-link/probe';

import { isEligibleIdentity } from './eligibility';
import type { AuthService, SignInResult } from './model/types';
import { SessionProvider, useSession } from './SessionProvider';
import { createTokenStorage, type TokenStorage } from './storage';

/**
 * The patients-only gate (C-11), through the real `SessionProvider`.
 *
 * A non-patient account must never be installed: on sign-in, OTP, cold
 * start and every refresh it is revoked server-side (`logout` with
 * `skipRefresh`), its refresh token is not kept, the PHI cache and recent
 * doctors are swept, and the session lands `unauthenticated` /
 * `ineligible`. A patient is untouched.
 */

function result(role: string | null, suffix = ''): SignInResult {
  return {
    tokens: { accessToken: `access${suffix}`, refreshToken: `refresh${suffix}` },
    identity: {
      subjectId: `subject${suffix}`,
      role,
      displayName: 'Someone',
      email: 'someone@example.com',
      emailVerified: true,
    },
  };
}

const PATIENT = result('patient', '-p');
const DOCTOR = result('doctor', '-d');

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

let session: ReturnType<typeof useSession> | null = null;
let mounted: QueryClient | null = null;

function Capture() {
  const s = useSession();
  session = s;
  const reason = s.state.status === 'unauthenticated' ? (s.state.reason ?? '') : '';
  return (
    <>
      <Text testID="status">{s.state.status}</Text>
      <Text testID="reason">{reason}</Text>
    </>
  );
}

async function mount(
  overrides: Partial<Record<keyof AuthService, jest.Mock>> = {},
  stored: string | null = null,
) {
  const queryClient = createQueryClient();
  mounted = queryClient;
  const tokenStorage: TokenStorage = createTokenStorage(createInMemorySecureStore());
  if (stored !== null) await tokenStorage.writeRefreshToken(stored);
  const auth = {
    login: jest.fn(() => Promise.resolve({ kind: 'authenticated', result: PATIENT })),
    verifyOtp: jest.fn(() => Promise.resolve(PATIENT)),
    refresh: jest.fn(() => Promise.resolve(PATIENT)),
    logout: jest.fn(() => Promise.resolve()),
    ...overrides,
  } as unknown as AuthService & Record<'login' | 'verifyOtp' | 'refresh' | 'logout', jest.Mock>;

  function Tree({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  const view = render(
    <Tree>
      <SessionProvider authService={auth} tokenStorage={tokenStorage}>
        <Capture />
      </SessionProvider>
    </Tree>,
  );
  const status = () => view.getByTestId('status').props.children as string;
  const reason = () => view.getByTestId('reason').props.children as string;
  await waitFor(() => expect(status()).not.toBe('booting'));
  return { queryClient, tokenStorage, auth, status, reason };
}

function seedPhi(queryClient: QueryClient) {
  queryClient.setQueryData(['appointments', 'list', {}], [{ id: 'appt-1' }]);
  queryClient.setQueryData(['patient-link'], { linked: true, patient: { id: 'x', fullName: 'X' } });
  recordDoctorView({
    id: 'doc-1',
    fullName: 'Dr A',
    title: 'Dr',
    specialty: 'Cardiology',
    photoUrl: null,
  } as Parameters<typeof recordDoctorView>[0]);
}

beforeEach(() => {
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  mounted?.clear();
  mounted = null;
  apiClient.setAccessToken(null);
  apiClient.setRefreshHandler(null);
  apiClient.setSessionLostHandler(null);
  session = null;
  jest.restoreAllMocks();
});

describe('isEligibleIdentity', () => {
  it('admits the patient role only, and fails closed on a missing one', () => {
    expect(isEligibleIdentity({ role: 'patient' })).toBe(true);
    for (const role of ['doctor', 'admin', 'receptionist', 'Patient', '', null]) {
      expect(isEligibleIdentity({ role })).toBe(false);
    }
  });
});

describe('isIneligibleProbeRefusal', () => {
  it('is 403 with the code patient_only and nothing else', () => {
    expect(isIneligibleProbeRefusal({ kind: 'forbidden', code: 'patient_only' })).toBe(true);
    expect(isIneligibleProbeRefusal({ kind: 'forbidden' })).toBe(false);
    expect(isIneligibleProbeRefusal({ kind: 'forbidden', code: 'forbidden' })).toBe(false);
    expect(isIneligibleProbeRefusal({ kind: 'auth', code: 'patient_only' })).toBe(false);
    expect(isIneligibleProbeRefusal(new Error('patient_only'))).toBe(false);
  });
});

describe('sign-in', () => {
  it('admits a patient and does not revoke anything', async () => {
    const t = await mount();
    await act(async () => {
      await session?.login({ email: 'a@b.c', password: 'x', rememberMe: false });
    });
    await waitFor(() => expect(t.status()).toBe('authenticated'));
    expect(t.auth.logout).not.toHaveBeenCalled();
    expect(await t.tokenStorage.readRefreshToken()).toBe('refresh-p');
    expect(apiClient.hasAccessToken()).toBe(true);
  });

  it('ends a non-patient login: revoked server-side, nothing kept, reason ineligible', async () => {
    const t = await mount({
      login: jest.fn(() => Promise.resolve({ kind: 'authenticated', result: DOCTOR })),
    });
    seedPhi(t.queryClient);
    await act(async () => {
      await session?.login({ email: 'a@b.c', password: 'x', rememberMe: false });
    });

    await waitFor(() => expect(t.reason()).toBe('ineligible'));
    expect(t.status()).toBe('unauthenticated');
    expect(t.auth.logout).toHaveBeenCalledTimes(1);
    expect(t.auth.logout).toHaveBeenCalledWith({ skipRefresh: true });
    expect(await t.tokenStorage.readRefreshToken()).toBeNull();
    expect(apiClient.hasAccessToken()).toBe(false);
    expect(t.queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(listRecentDoctors()).toEqual([]);
  });

  it('ends a session whose payload names no role', async () => {
    const t = await mount({
      login: jest.fn(() => Promise.resolve({ kind: 'authenticated', result: result(null) })),
    });
    await act(async () => {
      await session?.login({ email: 'a@b.c', password: 'x', rememberMe: false });
    });
    await waitFor(() => expect(t.reason()).toBe('ineligible'));
    expect(await t.tokenStorage.readRefreshToken()).toBeNull();
  });

  it('ends a non-patient OTP completion the same way', async () => {
    const t = await mount({
      login: jest.fn(() => Promise.resolve({ kind: 'otp-required', otpToken: 'otp-1' })),
      verifyOtp: jest.fn(() => Promise.resolve(DOCTOR)),
    });
    await act(async () => {
      await session?.login({ email: 'a@b.c', password: 'x', rememberMe: false });
    });
    await act(async () => {
      await session?.completeOtp('123456');
    });
    await waitFor(() => expect(t.reason()).toBe('ineligible'));
    expect(t.auth.logout).toHaveBeenCalledWith({ skipRefresh: true });
    expect(await t.tokenStorage.readRefreshToken()).toBeNull();
  });

  it('still ends the session locally when the server-side revocation fails', async () => {
    const t = await mount({
      login: jest.fn(() => Promise.resolve({ kind: 'authenticated', result: DOCTOR })),
      logout: jest.fn(() => Promise.reject({ kind: 'network' })),
    });
    await act(async () => {
      await session?.login({ email: 'a@b.c', password: 'x', rememberMe: false });
    });
    await waitFor(() => expect(t.reason()).toBe('ineligible'));
    expect(await t.tokenStorage.readRefreshToken()).toBeNull();
    expect(apiClient.hasAccessToken()).toBe(false);
  });
});

describe('cold-start restore', () => {
  it('ends a restored non-patient session instead of installing it', async () => {
    const t = await mount({ refresh: jest.fn(() => Promise.resolve(DOCTOR)) }, 'stored-1');
    await waitFor(() => expect(t.reason()).toBe('ineligible'));
    expect(t.auth.refresh).toHaveBeenCalledWith('stored-1');
    expect(t.auth.logout).toHaveBeenCalledWith({ skipRefresh: true });
    // Neither the old token nor the rotated one is left behind.
    expect(await t.tokenStorage.readRefreshToken()).toBeNull();
    expect(apiClient.hasAccessToken()).toBe(false);
  });

  it('restores a patient session as before', async () => {
    const t = await mount({}, 'stored-1');
    await waitFor(() => expect(t.status()).toBe('authenticated'));
    expect(t.auth.logout).not.toHaveBeenCalled();
  });

  it('does not treat a 403 on refresh as ineligibility: the token is kept, unconfirmed', async () => {
    const t = await mount(
      { refresh: jest.fn(() => Promise.reject({ kind: 'forbidden', code: 'patient_only' })) },
      'stored-1',
    );
    await waitFor(() => expect(t.status()).toBe('unconfirmed'));
    expect(t.auth.logout).not.toHaveBeenCalled();
    expect(await t.tokenStorage.readRefreshToken()).toBe('stored-1');
  });
});

describe('mid-session refresh', () => {
  it('ends the session when a refresh comes back as a non-patient (role changed)', async () => {
    const t = await mount({ refresh: jest.fn(() => Promise.resolve(DOCTOR)) });
    await act(async () => {
      await session?.adoptSession(PATIENT);
    });
    await waitFor(() => expect(t.status()).toBe('authenticated'));
    seedPhi(t.queryClient);

    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(json(401, { code: 'unauthorized', message: 'Session expired' }));

    await act(async () => {
      await expect(apiClient.get('me/appointments')).rejects.toMatchObject({ kind: 'cancelled' });
    });

    await waitFor(() => expect(t.reason()).toBe('ineligible'));
    // The original request is not replayed with the non-patient token.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(t.auth.logout).toHaveBeenCalledWith({ skipRefresh: true });
    expect(await t.tokenStorage.readRefreshToken()).toBeNull();
    expect(t.queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('a 401 refusal (ADR-046 revocation on role change) is an ordinary expiry', async () => {
    const t = await mount({
      refresh: jest.fn(() => Promise.reject({ kind: 'auth', code: 'unauthorized' })),
    });
    await act(async () => {
      await session?.adoptSession(PATIENT);
    });
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(json(401, { code: 'unauthorized', message: 'Session expired' }));
    await act(async () => {
      await apiClient.get('me/appointments').catch(() => undefined);
    });
    await waitFor(() => expect(t.reason()).toBe('session-expired'));
  });
});

describe('endIneligibleSession (the probe)', () => {
  it('revokes and ends a signed-in session as ineligible', async () => {
    const t = await mount();
    await act(async () => {
      await session?.adoptSession(PATIENT);
    });
    seedPhi(t.queryClient);
    await act(async () => {
      await session?.endIneligibleSession();
    });
    await waitFor(() => expect(t.reason()).toBe('ineligible'));
    expect(t.auth.logout).toHaveBeenCalledWith({ skipRefresh: true });
    expect(await t.tokenStorage.readRefreshToken()).toBeNull();
    expect(t.queryClient.getQueryCache().getAll()).toHaveLength(0);
  });

  it('is a no-op when signed out', async () => {
    const t = await mount();
    await act(async () => {
      await session?.endIneligibleSession();
    });
    expect(t.reason()).toBe('');
    expect(t.auth.logout).not.toHaveBeenCalled();
  });
});
