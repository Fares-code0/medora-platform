import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react-native';
import { AppState, Text, type AppStateStatus } from 'react-native';

import { apiClient } from '@/api/client';
import { PHI_QUERY_DOMAINS } from '@/api/query-keys';
import { catalogues, interpolate } from '@/i18n';
import { createInMemorySecureStore } from '@/storage/secure-store';

import type { SessionLockPolicy } from './lock-policy';
import type { AuthService, SignInResult } from './model/types';
import { SessionProvider, useSession } from './SessionProvider';
import { createTokenStorage, type TokenStorage } from './storage';
import { authErrorKey } from './useAuthErrorMessage';

/**
 * Session tests — checklist U-02.
 *
 * The assertions that matter are the ones about what is left behind: a
 * logout that fails server-side must still clear the device, and a lost
 * session must notify once rather than once per in-flight request.
 */

const SIGNED_IN: SignInResult = {
  tokens: { accessToken: 'access-1', refreshToken: 'refresh-1' },
  identity: {
    subjectId: 'subject-1',
    displayName: 'Sara Ahmed',
    email: 'sara@example.com',
    emailVerified: true,
  },
};

function stubAuthService(overrides: Partial<AuthService> = {}): AuthService {
  return {
    login: jest.fn(() => Promise.resolve({ kind: 'authenticated', result: SIGNED_IN } as const)),
    verifyOtp: jest.fn(() => Promise.resolve(SIGNED_IN)),
    resendOtp: jest.fn(() => Promise.resolve()),
    refresh: jest.fn(() => Promise.resolve(SIGNED_IN)),
    logout: jest.fn(() => Promise.resolve()),
    forgotPassword: jest.fn(() => Promise.resolve()),
    resetPassword: jest.fn(() => Promise.resolve()),
    changePassword: jest.fn(() => Promise.resolve()),
    setupTwoFactor: jest.fn(() =>
      Promise.resolve({ secret: 'S', otpauthUrl: 'otpauth://totp/x', recoveryCodes: [] }),
    ),
    enableTwoFactor: jest.fn(() => Promise.resolve()),
    disableTwoFactor: jest.fn(() => Promise.resolve()),
    redeemRecoveryCode: jest.fn(() => Promise.resolve(SIGNED_IN)),
    twoFactorStatus: jest.fn(() => Promise.resolve(null)),
    startTwoFactorReenrollment: jest.fn(() =>
      Promise.resolve({ secret: 'S', otpauthUrl: 'otpauth://totp/x', enrolmentToken: 'e' }),
    ),
    confirmTwoFactorReenrollment: jest.fn(() => Promise.resolve([])),
    verifyEmail: jest.fn(() => Promise.resolve()),
    resendVerification: jest.fn(() => Promise.resolve()),
    // Registration resolves to a next step, never a session (ADR-035 §4).
    register: jest.fn(() =>
      Promise.resolve({ nextStep: 'verify-email' as const, email: 'new@medora.test' }),
    ),
    ...overrides,
  };
}

interface Harness {
  readonly status: () => string;
  readonly session: () => ReturnType<typeof useSession>;
  readonly storage: TokenStorage;
  readonly queryClient: QueryClient;
}

function renderSession(options: {
  authService?: AuthService;
  storedRefreshToken?: string;
  lockPolicy?: SessionLockPolicy;
}): Promise<Harness> {
  const storage = createTokenStorage(createInMemorySecureStore());
  const authService = options.authService ?? stubAuthService();
  // `gcTime: Infinity` because the T-11 tests below assert on what is
  // still in the cache; a query collected on its own between two `act`s
  // would look exactly like a sweep that never happened. Each test gets
  // its own client, so nothing leaks between them.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  let captured: ReturnType<typeof useSession> | null = null;

  function Probe() {
    const session = useSession();
    captured = session;
    return <Text testID="status">{session.state.status}</Text>;
  }

  function Tree({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  const seed =
    options.storedRefreshToken === undefined
      ? Promise.resolve()
      : storage.writeRefreshToken(options.storedRefreshToken);

  return seed.then(async () => {
    const view = render(
      <Tree>
        <SessionProvider
          authService={authService}
          tokenStorage={storage}
          lockPolicy={options.lockPolicy}
        >
          <Probe />
        </SessionProvider>
      </Tree>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    return {
      status: () => String(view.getByTestId('status').props.children),
      session: () => {
        if (captured === null) throw new Error('Session was not captured.');
        return captured;
      },
      storage,
      queryClient,
    };
  });
}

afterEach(() => {
  apiClient.setAccessToken(null);
  apiClient.setRefreshHandler(null);
  apiClient.setSessionLostHandler(null);
  jest.restoreAllMocks();
});

describe('cold start', () => {
  it('lands unauthenticated when the keychain is empty', async () => {
    const harness = await renderSession({});
    await waitFor(() => {
      expect(harness.status()).toBe('unauthenticated');
    });
  });

  it('restores a session from the stored refresh token', async () => {
    const authService = stubAuthService();
    const harness = await renderSession({ authService, storedRefreshToken: 'refresh-1' });

    await waitFor(() => {
      expect(harness.status()).toBe('authenticated');
    });
    expect(authService.refresh).toHaveBeenCalledWith('refresh-1');
  });

  it('clears the keychain when the stored token is rejected', async () => {
    const authService = stubAuthService({
      refresh: jest.fn(() => Promise.reject(Object.assign(new Error('x'), { kind: 'auth' }))),
    });
    const harness = await renderSession({ authService, storedRefreshToken: 'stale' });

    await waitFor(() => {
      expect(harness.status()).toBe('unauthenticated');
    });
    expect(await harness.storage.readRefreshToken()).toBeNull();
  });

  it('says the session expired rather than bouncing silently (D-12)', async () => {
    const authService = stubAuthService({
      refresh: jest.fn(() => Promise.reject(Object.assign(new Error('x'), { kind: 'auth' }))),
    });
    const harness = await renderSession({ authService, storedRefreshToken: 'stale' });

    await waitFor(() => {
      expect(harness.status()).toBe('unauthenticated');
    });
    const state = harness.session().state;
    expect(state.status === 'unauthenticated' && state.reason).toBe('session-expired');
  });
});

describe('sign in', () => {
  it('stores the refresh token and holds the access token in memory only (T-02)', async () => {
    const harness = await renderSession({});
    await waitFor(() => {
      expect(harness.status()).toBe('unauthenticated');
    });

    await act(async () => {
      await harness
        .session()
        .login({ email: 'sara@example.com', password: 'Password1!', rememberMe: true });
    });

    await waitFor(() => {
      expect(harness.status()).toBe('authenticated');
    });
    // The refresh token is on the device.
    expect(await harness.storage.readRefreshToken()).toBe('refresh-1');
    // The access token reached the transport, and nothing else.
    expect(apiClient.hasAccessToken()).toBe(true);
  });

  it('routes an OTP challenge to the step-up rather than a session', async () => {
    const authService = stubAuthService({
      login: jest.fn(() => Promise.resolve({ kind: 'otp-required', otpToken: 'otp-1' } as const)),
    });
    const harness = await renderSession({ authService });
    await waitFor(() => {
      expect(harness.status()).toBe('unauthenticated');
    });

    let outcome = '';
    await act(async () => {
      outcome = await harness
        .session()
        .login({ email: 'otp@example.com', password: 'Password1!', rememberMe: true });
    });

    expect(outcome).toBe('otp-required');
    expect(harness.status()).toBe('unauthenticated');
    expect(harness.session().pendingOtpToken).toBe('otp-1');
  });

  it('completes the step-up into a session', async () => {
    const authService = stubAuthService({
      login: jest.fn(() => Promise.resolve({ kind: 'otp-required', otpToken: 'otp-1' } as const)),
    });
    const harness = await renderSession({ authService });
    await waitFor(() => {
      expect(harness.status()).toBe('unauthenticated');
    });

    await act(async () => {
      await harness
        .session()
        .login({ email: 'otp@example.com', password: 'Password1!', rememberMe: true });
    });
    await act(async () => {
      await harness.session().completeOtp('123456');
    });

    await waitFor(() => {
      expect(harness.status()).toBe('authenticated');
    });
    expect(authService.verifyOtp).toHaveBeenCalledWith({ otpToken: 'otp-1', code: '123456' });
  });
});

describe('logout (D-11, T-08)', () => {
  it('revokes server-side and clears the device', async () => {
    const authService = stubAuthService();
    const harness = await renderSession({ authService, storedRefreshToken: 'refresh-1' });
    await waitFor(() => {
      expect(harness.status()).toBe('authenticated');
    });

    await act(async () => {
      await harness.session().logout();
    });

    expect(authService.logout).toHaveBeenCalled();
    expect(await harness.storage.readRefreshToken()).toBeNull();
    expect(apiClient.hasAccessToken()).toBe(false);
    expect(harness.status()).toBe('unauthenticated');
  });

  it('clears the device even when the server-side revocation fails', async () => {
    // A network failure on logout must not leave a refresh token behind.
    const authService = stubAuthService({
      logout: jest.fn(() => Promise.reject(Object.assign(new Error('x'), { kind: 'network' }))),
    });
    const harness = await renderSession({ authService, storedRefreshToken: 'refresh-1' });
    await waitFor(() => {
      expect(harness.status()).toBe('authenticated');
    });

    await act(async () => {
      await harness.session().logout();
    });

    expect(await harness.storage.readRefreshToken()).toBeNull();
    expect(harness.status()).toBe('unauthenticated');
  });
});

/**
 * Background timeout — checklist T-11.
 *
 * The rule itself is asserted in `lock-policy.test.ts`. What is asserted
 * here is the wiring: that an absence is measured across the real
 * `AppState` transitions a phone produces, and that each outcome leaves
 * the device in the state it claims to.
 */
describe('background timeout (T-11)', () => {
  const POLICY: SessionLockPolicy = {
    phiSweepAfterMs: 5 * 60_000,
    reauthenticateAfterMs: 15 * 60_000,
  };

  /**
   * A fake `AppState` whose `remove()` really removes — the provider
   * re-subscribes when the session status changes, and a stale listener
   * that kept firing would consume the absence before the live one saw
   * it.
   */
  function captureAppState() {
    const listeners: ((state: AppStateStatus) => void)[] = [];
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
      listeners.push(listener);
      return {
        remove: () => {
          const index = listeners.indexOf(listener);
          if (index >= 0) listeners.splice(index, 1);
        },
      };
    });

    return (state: AppStateStatus) => {
      for (const listener of [...listeners]) listener(state);
    };
  }

  /**
   * Freezes `Date.now` and hands back the only way to move it. Installed
   * *after* the session has settled — `waitFor` polls against a real
   * clock, and a frozen one there would hang rather than fail.
   */
  function freezeClock() {
    let now = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    return (deltaMs: number) => {
      now += deltaMs;
    };
  }

  function seedPhi(client: QueryClient) {
    for (const domain of PHI_QUERY_DOMAINS) {
      client.setQueryData([domain, 'list', {}], { cached: true });
    }
  }

  function cachedPhiDomains(client: QueryClient): string[] {
    return PHI_QUERY_DOMAINS.filter(
      (domain) => client.getQueryData([domain, 'list', {}]) !== undefined,
    );
  }

  async function signedIn() {
    const emit = captureAppState();
    const harness = await renderSession({
      storedRefreshToken: 'refresh-1',
      lockPolicy: POLICY,
    });
    await waitFor(() => {
      expect(harness.status()).toBe('authenticated');
    });
    seedPhi(harness.queryClient);
    return { harness, emit, advance: freezeClock() };
  }

  it('leaves a short absence alone', async () => {
    const { harness, emit, advance } = await signedIn();

    await act(async () => {
      emit('background');
      advance(60_000);
      emit('active');
    });

    expect(harness.status()).toBe('authenticated');
    expect(cachedPhiDomains(harness.queryClient)).toEqual([...PHI_QUERY_DOMAINS]);
  });

  it('sweeps the PHI cache but keeps the session past the first threshold', async () => {
    const { harness, emit, advance } = await signedIn();

    await act(async () => {
      emit('background');
      advance(6 * 60_000);
      emit('active');
    });

    expect(cachedPhiDomains(harness.queryClient)).toEqual([]);
    // A waiting room is not an abandoned phone: the patient is still
    // signed in and the next screen refetches.
    expect(harness.status()).toBe('authenticated');
    expect(apiClient.hasAccessToken()).toBe(true);
    expect(await harness.storage.readRefreshToken()).toBe('refresh-1');
  });

  it('ends the session and requires signing in again past the second threshold', async () => {
    const { harness, emit, advance } = await signedIn();

    await act(async () => {
      emit('background');
      advance(16 * 60_000);
      emit('active');
    });

    const state = harness.session().state;
    expect(state.status).toBe('unauthenticated');
    expect(state.status === 'unauthenticated' && state.reason).toBe('locked');
    // Everything a lost phone could be resumed from is gone.
    expect(apiClient.hasAccessToken()).toBe(false);
    expect(await harness.storage.readRefreshToken()).toBeNull();
    expect(cachedPhiDomains(harness.queryClient)).toEqual([]);
  });

  it('does not restart the clock on the second iOS transition of one absence', async () => {
    const { harness, emit, advance } = await signedIn();

    // iOS reports `inactive` before `background`, and `inactive` again on
    // the way back. Only the first one starts the clock.
    await act(async () => {
      emit('inactive');
      advance(16 * 60_000);
      emit('background');
      emit('active');
    });

    const state = harness.session().state;
    expect(state.status === 'unauthenticated' && state.reason).toBe('locked');
  });

  it('measures each absence separately', async () => {
    const { harness, emit, advance } = await signedIn();

    for (let i = 0; i < 4; i += 1) {
      await act(async () => {
        emit('background');
        advance(4 * 60_000);
        emit('active');
      });
    }

    // Sixteen minutes in total, never more than four in one go.
    expect(harness.status()).toBe('authenticated');
    expect(cachedPhiDomains(harness.queryClient)).toEqual([...PHI_QUERY_DOMAINS]);
  });

  it('does nothing when there was no session to protect', async () => {
    const emit = captureAppState();
    const harness = await renderSession({ lockPolicy: POLICY });
    await waitFor(() => {
      expect(harness.status()).toBe('unauthenticated');
    });
    const advance = freezeClock();

    await act(async () => {
      emit('background');
      advance(60 * 60_000);
      emit('active');
    });

    // Signed out already: no invented "locked" banner on a login screen
    // the patient walked to themselves.
    const state = harness.session().state;
    expect(state.status === 'unauthenticated' && state.reason).toBeUndefined();
  });
});

/**
 * The English rendering of what `authErrorKey` returns.
 *
 * Since C-09 the mapper returns a catalogue key rather than a sentence,
 * and the assertions below are about the sentence — what a patient
 * reads is where the anti-enumeration and wrong-password rules actually
 * bite. Resolving through the catalogue keeps every one of those claims
 * intact and adds one: a key that is not in the catalogue would not
 * compile.
 */
function authErrorMessage(error: unknown): string {
  const { key, params } = authErrorKey(error);
  return interpolate(catalogues.en[key], params);
}

describe('authErrorMessage (D-02, D-06)', () => {
  it('tells a wrong password from an expired session', () => {
    expect(authErrorMessage({ kind: 'auth', code: 'invalid_credentials' })).toMatch(/do not match/);
    expect(authErrorMessage({ kind: 'auth', code: 'email_unverified' })).toMatch(
      /Confirm your email/,
    );
  });

  it('never reveals whether an account exists', () => {
    const messages = [
      authErrorMessage({ kind: 'auth', code: 'invalid_credentials' }),
      authErrorMessage({ kind: 'not_found' }),
    ];
    for (const message of messages) {
      expect(message).not.toMatch(/no account/i);
      expect(message).not.toMatch(/not registered/i);
    }
  });

  it('surfaces a rate limit with its wait', () => {
    expect(authErrorMessage({ kind: 'rate_limited', retryAfterSeconds: 45 })).toContain('45');
  });

  it('handles a thrown value that is not an ApiError', () => {
    expect(authErrorMessage(new Error('boom'))).toBe('Something went wrong. Please try again.');
  });
});
