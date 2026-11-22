import NetInfo from '@react-native-community/netinfo';
import { createNavigationContainerRef, NavigationContainer } from '@react-navigation/native';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';
import type * as ReactNative from 'react-native';

import { apiClient } from '@/api/client';
import { normalizeHttpError, normalizeNetworkError, normalizeTimeoutError } from '@/api/errors';
import { PHI_QUERY_DOMAINS } from '@/api/query-keys';
import { RootNavigator } from '@/navigation/RootNavigator';
import { NetworkProvider } from '@/network/NetworkProvider';
import { ResponseContractError } from '@/schemas/envelope';
import { createInMemorySecureStore } from '@/storage/secure-store';
import { renderWithProviders } from '@/test/render';
import { addLogSink, clearLogSinks } from '@/utils/logger';

import { httpAuthService } from './http-auth-service';
import type { AuthService, SignInResult } from './model/types';
import { isSessionRejection } from './refresh-outcome';
import { SessionProvider, SessionStorageError, useSession } from './SessionProvider';
import { createTokenStorage, type TokenStorage } from './storage';

/**
 * Session restore, refresh and sign-out — the audit's H1 and M2–M5.
 *
 * The rule under test throughout: only the server can end a session, it
 * says so with a 401, and nothing that started before a sign-out may undo
 * it. Responses are the backend's own (`GUARD_401`, `REFRESH_REFUSED_401`),
 * copied from source rather than invented.
 */

// The signed-in app is a marker here. These tests are about which side of
// the gate the patient lands on, and a marker makes "the tabs are NOT
// showing" an assertion rather than an absence.
jest.mock('@/navigation/AppTabs', () => {
  const { Text: MarkerText } = jest.requireActual<typeof ReactNative>('react-native');
  return { AppTabs: () => <MarkerText testID="app-tabs">signed in</MarkerText> };
});

const GUARD_401 = { message: 'Unauthorized', code: 'unauthorized' } as const;
const REFRESH_REFUSED_401 = { message: 'Session expired', code: 'unauthorized' } as const;

const SIGNED_IN: SignInResult = {
  tokens: { accessToken: 'access-1', refreshToken: 'refresh-2' },
  identity: {
    subjectId: 'subject-1',
    displayName: 'Sara Ahmed',
    email: 'sara@example.com',
    emailVerified: true,
  },
};

const ROTATED_AGAIN: SignInResult = {
  ...SIGNED_IN,
  tokens: { accessToken: 'access-2', refreshToken: 'refresh-3' },
};

function authServiceStub(overrides: Partial<AuthService> = {}): AuthService {
  return {
    login: jest.fn(() => Promise.resolve({ kind: 'authenticated', result: SIGNED_IN } as const)),
    verifyOtp: jest.fn(),
    resendOtp: jest.fn(),
    refresh: jest.fn(() => Promise.resolve(SIGNED_IN)),
    logout: jest.fn(() => Promise.resolve()),
    forgotPassword: jest.fn(),
    resetPassword: jest.fn(),
    changePassword: jest.fn(),
    setupTwoFactor: jest.fn(),
    enableTwoFactor: jest.fn(),
    disableTwoFactor: jest.fn(),
    redeemRecoveryCode: jest.fn(),
    twoFactorStatus: jest.fn(() => Promise.resolve(null)),
    startTwoFactorReenrollment: jest.fn(),
    confirmTwoFactorReenrollment: jest.fn(),
    verifyEmail: jest.fn(),
    resendVerification: jest.fn(),
    register: jest.fn(),
    ...overrides,
  };
}

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function httpError(status: number, body: unknown = {}) {
  return normalizeHttpError(response(status, body));
}

const refused = () => httpError(401, REFRESH_REFUSED_401);

async function storageWith(token: string | null): Promise<TokenStorage> {
  const storage = createTokenStorage(createInMemorySecureStore());
  if (token !== null) await storage.writeRefreshToken(token);
  return storage;
}

/** A keychain that holds `token` and refuses every write after that. */
async function refusingStorageWith(token: string): Promise<TokenStorage> {
  const inner = await storageWith(token);
  return {
    readRefreshToken: () => inner.readRefreshToken(),
    writeRefreshToken: () => Promise.reject(new Error('keychain unavailable')),
    readSessionGuard: () => inner.readSessionGuard(),
    writeSessionGuard: (record) => inner.writeSessionGuard(record),
    clear: () => inner.clear(),
  };
}

/** A promise the test settles by hand. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: Error) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/**
 * Fails, rather than hangs, when `promise` has not settled within `ms`.
 * A bound on a deadlock, not a wait: a settled promise wins at once.
 */
function within<T>(promise: Promise<T>, ms = 2_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`did not settle within ${ms} ms`)), ms);
  });
  return Promise.race([promise, bound]).finally(() => clearTimeout(timer));
}

afterEach(() => {
  apiClient.setAccessToken(null);
  apiClient.setRefreshHandler(null);
  apiClient.setSessionLostHandler(null);
  clearLogSinks();
  jest.restoreAllMocks();
});

describe('isSessionRejection (M3)', () => {
  it('reads the refresh route 401 as the server refusing the token', async () => {
    expect(isSessionRejection(await refused())).toBe(true);
  });

  it.each([
    ['no signal', (): Promise<Error> => Promise.resolve(normalizeNetworkError())],
    ['a timeout', (): Promise<Error> => Promise.resolve(normalizeTimeoutError())],
    ['a 502', (): Promise<Error> => httpError(502)],
    ['a 503', (): Promise<Error> => httpError(503)],
    ['a 429', (): Promise<Error> => httpError(429)],
    ['a 403 from something in front of the API', (): Promise<Error> => httpError(403)],
    ['a 400', (): Promise<Error> => httpError(400)],
    ['a 422', (): Promise<Error> => httpError(422)],
    // 401s the refresh route's contract does not produce: no body, a
    // proxy's page, or a code that route never sends.
    ['a 401 with an empty body', (): Promise<Error> => httpError(401)],
    [
      'a 401 with a non-JSON body',
      (): Promise<Error> =>
        normalizeHttpError(new Response('<html>Sign in to the Wi-Fi</html>', { status: 401 })),
    ],
    [
      'a 401 with another code',
      (): Promise<Error> => httpError(401, { message: 'Nope', code: 'invalid_credentials' }),
    ],
    [
      'a captive portal page',
      (): Promise<Error> =>
        Promise.resolve(new ResponseContractError('auth/refresh', ['(body): not JSON'])),
    ],
    ['something that is not an ApiError', (): Promise<Error> => Promise.resolve(new Error('x'))],
  ])('reads %s as no answer about the token', async (_label, make) => {
    expect(isSessionRejection(await make())).toBe(false);
  });
});

/** Mounts the provider with a probe that exposes the session. */
async function renderProvider(authService: AuthService, storage: TokenStorage) {
  let captured: ReturnType<typeof useSession> | null = null;
  function Probe() {
    captured = useSession();
    const { state } = captured;
    return (
      <Text testID="status">
        {state.status === 'unauthenticated'
          ? `unauthenticated:${state.reason ?? ''}`
          : state.status}
      </Text>
    );
  }
  const view = renderWithProviders(
    <SessionProvider authService={authService} tokenStorage={storage}>
      <Probe />
    </SessionProvider>,
  );
  await act(async () => undefined);
  return {
    ...view,
    status: () => String(view.getByTestId('status').props.children),
    session: () => {
      if (captured === null) throw new Error('no session captured');
      return captured;
    },
  };
}

describe('cold start without an answer', () => {
  it.each([
    ['no signal', (): Promise<Error> => Promise.resolve(normalizeNetworkError())],
    ['a timeout', (): Promise<Error> => Promise.resolve(normalizeTimeoutError())],
    ['a 503', (): Promise<Error> => httpError(503)],
    ['a 429', (): Promise<Error> => httpError(429)],
    ['a WAF 403', (): Promise<Error> => httpError(403)],
    ['a 422', (): Promise<Error> => httpError(422)],
    ['a 401 with no code', (): Promise<Error> => httpError(401)],
    [
      'a captive portal page',
      (): Promise<Error> =>
        Promise.resolve(new ResponseContractError('auth/refresh', ['(body): not JSON'])),
    ],
  ])('keeps the token and lands unconfirmed on %s', async (_label, make) => {
    const error = await make();
    const storage = await storageWith('refresh-1');
    const view = await renderProvider(
      authServiceStub({ refresh: jest.fn(() => Promise.reject(error)) }),
      storage,
    );

    await waitFor(() => expect(view.status()).toBe('unconfirmed'));
    expect(await storage.readRefreshToken()).toBe('refresh-1');
    expect(apiClient.hasAccessToken()).toBe(false);
  });

  it('ends the session when the refresh route answers 401', async () => {
    const error = await refused();
    const storage = await storageWith('refresh-1');
    const view = await renderProvider(
      authServiceStub({ refresh: jest.fn(() => Promise.reject(error)) }),
      storage,
    );

    await waitFor(() => expect(view.status()).toBe('unauthenticated:session-expired'));
    expect(await storage.readRefreshToken()).toBeNull();
  });

  it('logs the kind of failure and never the token', async () => {
    const lines: string[] = [];
    addLogSink((entry) => lines.push(JSON.stringify(entry)));
    const view = await renderProvider(
      authServiceStub({ refresh: jest.fn(() => Promise.reject(normalizeNetworkError())) }),
      await storageWith('refresh-secret-value'),
    );

    await waitFor(() => expect(view.status()).toBe('unconfirmed'));
    const joined = lines.join('\n');
    expect(joined).toContain('network');
    expect(joined).not.toContain('refresh-secret-value');
  });
});

describe('a keychain that refuses the new session (M2)', () => {
  it('ends the session on a cold start, with nothing half-installed', async () => {
    const refresh = jest.fn(() => Promise.resolve(SIGNED_IN));
    const storage = await refusingStorageWith('refresh-1');
    const view = await renderProvider(authServiceStub({ refresh }), storage);

    await waitFor(() => expect(view.status()).toBe('unauthenticated:session-expired'));
    expect(apiClient.hasAccessToken()).toBe(false);
    // The superseded token is gone, so it can never be presented again.
    expect(await storage.readRefreshToken()).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('ends the session on a retry the same way', async () => {
    const refresh = jest
      .fn<Promise<SignInResult>, [string]>()
      .mockRejectedValueOnce(normalizeNetworkError())
      .mockResolvedValueOnce(SIGNED_IN);
    const storage = await refusingStorageWith('refresh-1');
    const view = await renderProvider(authServiceStub({ refresh }), storage);
    await waitFor(() => expect(view.status()).toBe('unconfirmed'));

    let outcome: string | undefined;
    await act(async () => {
      outcome = await view.session().retryRestore();
    });

    expect(outcome).toBe('settled');
    expect(view.status()).toBe('unauthenticated:session-expired');
    expect(apiClient.hasAccessToken()).toBe(false);
    expect(await storage.readRefreshToken()).toBeNull();
  });

  it('ends the session mid-session and stops the waiting request quietly', async () => {
    const refresh = jest
      .fn<Promise<SignInResult>, [string]>()
      .mockResolvedValueOnce(SIGNED_IN)
      .mockResolvedValueOnce(ROTATED_AGAIN);
    let writes = 0;
    const inner = await storageWith('refresh-1');
    const storage: TokenStorage = {
      readRefreshToken: () => inner.readRefreshToken(),
      // The cold start's write succeeds; the mid-session one is refused.
      writeRefreshToken: (token) => {
        writes += 1;
        return writes === 1 ? inner.writeRefreshToken(token) : Promise.reject(new Error('no'));
      },
      readSessionGuard: () => inner.readSessionGuard(),
      writeSessionGuard: (record) => inner.writeSessionGuard(record),
      clear: () => inner.clear(),
    };
    const view = await renderProvider(authServiceStub({ refresh }), storage);
    await waitFor(() => expect(view.status()).toBe('authenticated'));
    jest.spyOn(global, 'fetch').mockResolvedValue(response(401, GUARD_401));

    await act(async () => {
      await expect(apiClient.get('me/appointments')).rejects.toMatchObject({ kind: 'cancelled' });
    });

    expect(view.status()).toBe('unauthenticated:session-expired');
    expect(apiClient.hasAccessToken()).toBe(false);
    expect(await storage.readRefreshToken()).toBeNull();
  });

  it('refuses a sign-in it cannot store, and leaves no session behind', async () => {
    const view = await renderProvider(authServiceStub(), await refusingStorageWith('old'));
    await waitFor(() => expect(view.status()).toBe('unauthenticated:session-expired'));

    await act(async () => {
      await expect(
        view.session().login({ email: 'sara@example.com', password: 'x', rememberMe: false }),
      ).rejects.toBeInstanceOf(SessionStorageError);
    });

    expect(view.status()).toBe('unauthenticated:session-expired');
    expect(apiClient.hasAccessToken()).toBe(false);
  });
});

describe('retryRestore', () => {
  it('restores the session once the server answers', async () => {
    const refresh = jest
      .fn<Promise<SignInResult>, [string]>()
      .mockRejectedValueOnce(normalizeNetworkError())
      .mockResolvedValueOnce(SIGNED_IN);
    const storage = await storageWith('refresh-1');
    const view = await renderProvider(authServiceStub({ refresh }), storage);
    await waitFor(() => expect(view.status()).toBe('unconfirmed'));

    await act(async () => {
      await view.session().retryRestore();
    });

    expect(view.status()).toBe('authenticated');
    expect(await storage.readRefreshToken()).toBe('refresh-2');
    expect(apiClient.hasAccessToken()).toBe(true);
  });

  it('reports a second silence as no-answer, and keeps the token', async () => {
    const storage = await storageWith('refresh-1');
    const view = await renderProvider(
      authServiceStub({ refresh: jest.fn(() => Promise.reject(normalizeNetworkError())) }),
      storage,
    );
    await waitFor(() => expect(view.status()).toBe('unconfirmed'));

    let outcome: string | undefined;
    await act(async () => {
      outcome = await view.session().retryRestore();
    });

    expect(outcome).toBe('no-answer');
    expect(view.status()).toBe('unconfirmed');
    expect(await storage.readRefreshToken()).toBe('refresh-1');
  });

  it('ends the session when the retry is refused', async () => {
    const rejected = await refused();
    const refresh = jest
      .fn<Promise<SignInResult>, [string]>()
      .mockRejectedValueOnce(normalizeNetworkError())
      .mockRejectedValueOnce(rejected);
    const storage = await storageWith('refresh-1');
    const view = await renderProvider(authServiceStub({ refresh }), storage);
    await waitFor(() => expect(view.status()).toBe('unconfirmed'));

    await act(async () => {
      await view.session().retryRestore();
    });

    expect(view.status()).toBe('unauthenticated:session-expired');
    expect(await storage.readRefreshToken()).toBeNull();
  });

  // Two retries presenting one token is a replay to the backend, which
  // revokes the whole session family (ADR-026).
  it('presents the token once however many retries race', async () => {
    const second = deferred<SignInResult>();
    const refresh = jest
      .fn<Promise<SignInResult>, [string]>()
      .mockRejectedValueOnce(normalizeNetworkError())
      .mockImplementationOnce(() => second.promise);
    const view = await renderProvider(authServiceStub({ refresh }), await storageWith('r-1'));
    await waitFor(() => expect(view.status()).toBe('unconfirmed'));

    let outcomes: string[] = [];
    await act(async () => {
      const first = view.session().retryRestore();
      const other = view.session().retryRestore();
      await Promise.resolve();
      second.resolve(SIGNED_IN);
      outcomes = await Promise.all([first, other]);
    });

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(outcomes.sort()).toEqual(['settled', 'skipped']);
    expect(view.status()).toBe('authenticated');
  });

  it('does nothing outside the unconfirmed state', async () => {
    const refresh = jest.fn(() => Promise.resolve(SIGNED_IN));
    const view = await renderProvider(authServiceStub({ refresh }), await storageWith('r-1'));
    await waitFor(() => expect(view.status()).toBe('authenticated'));

    let outcome: string | undefined;
    await act(async () => {
      outcome = await view.session().retryRestore();
    });

    expect(outcome).toBe('skipped');
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("a mid-session refresh, on the backend's own 401 (H1)", () => {
  it('refreshes on the guard 401 and replays the request', async () => {
    const refresh = jest
      .fn<Promise<SignInResult>, [string]>()
      .mockResolvedValueOnce(SIGNED_IN)
      .mockResolvedValueOnce(ROTATED_AGAIN);
    const storage = await storageWith('refresh-1');
    const view = await renderProvider(authServiceStub({ refresh }), storage);
    await waitFor(() => expect(view.status()).toBe('authenticated'));
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(response(401, GUARD_401))
      .mockResolvedValueOnce(response(200, { data: { ok: true } }));

    await act(async () => {
      await expect(apiClient.get('me/appointments')).resolves.toEqual({ data: { ok: true } });
    });

    expect(refresh).toHaveBeenCalledTimes(2);
    expect(view.status()).toBe('authenticated');
    expect(await storage.readRefreshToken()).toBe('refresh-3');
  });

  it('fails the request as unreachable and keeps the session when the refresh gets no answer', async () => {
    const refresh = jest
      .fn<Promise<SignInResult>, [string]>()
      .mockResolvedValueOnce(SIGNED_IN)
      .mockRejectedValueOnce(normalizeNetworkError());
    const storage = await storageWith('refresh-1');
    const view = await renderProvider(authServiceStub({ refresh }), storage);
    await waitFor(() => expect(view.status()).toBe('authenticated'));
    jest.spyOn(global, 'fetch').mockResolvedValue(response(401, GUARD_401));

    await act(async () => {
      await expect(apiClient.get('me/appointments')).rejects.toMatchObject({ kind: 'network' });
    });

    expect(view.status()).toBe('authenticated');
    expect(await storage.readRefreshToken()).toBe('refresh-2');
  });

  it('ends the session once when the refresh is refused', async () => {
    const rejected = await refused();
    const refresh = jest
      .fn<Promise<SignInResult>, [string]>()
      .mockResolvedValueOnce(SIGNED_IN)
      .mockRejectedValueOnce(rejected);
    const storage = await storageWith('refresh-1');
    const view = await renderProvider(authServiceStub({ refresh }), storage);
    await waitFor(() => expect(view.status()).toBe('authenticated'));
    jest.spyOn(global, 'fetch').mockResolvedValue(response(401, GUARD_401));

    await act(async () => {
      await expect(apiClient.get('me/appointments')).rejects.toMatchObject({ kind: 'auth' });
    });

    await waitFor(() => expect(view.status()).toBe('unauthenticated:session-expired'));
    expect(await storage.readRefreshToken()).toBeNull();
  });

  // Through the real HTTP adapter, not a stub: the refresh route's own
  // `401 unauthorized` must end the session, not trigger a refresh of the
  // refresh — which would wait on itself for ever.
  it('ends the session through the real adapter without the refresh refreshing itself', async () => {
    let refreshCalls = 0;
    jest.spyOn(global, 'fetch').mockImplementation((input) => {
      const url = String(input);
      if (url.endsWith('/auth/refresh')) {
        refreshCalls += 1;
        return Promise.resolve(
          refreshCalls === 1
            ? response(200, {
                data: {
                  accessToken: 'access-1',
                  refreshToken: 'refresh-2',
                  user: { id: 'u-1', email: 'sara@example.com' },
                },
              })
            : response(401, REFRESH_REFUSED_401),
        );
      }
      return Promise.resolve(response(401, GUARD_401));
    });
    const storage = await storageWith('refresh-1');
    const view = await renderProvider(httpAuthService, storage);
    await waitFor(() => expect(view.status()).toBe('authenticated'));

    await act(async () => {
      // Bounded: a refresh that refreshed itself would wait on its own
      // promise for ever, and that must fail here, not hang the suite.
      await expect(within(apiClient.get('me/appointments'))).rejects.toMatchObject({
        kind: 'auth',
      });
    });

    await waitFor(() => expect(view.status()).toBe('unauthenticated:session-expired'));
    expect(refreshCalls).toBe(2);
    expect(await storage.readRefreshToken()).toBeNull();
  }, 10_000);

  // A proxy's 502 whose body is the JSON literal `null` is no answer about
  // the token. Its body used to escape `normalizeHttpError` as a TypeError,
  // which `refreshOnce` reads as a broken handler — and so as a lost session.
  it('keeps the session when the refresh gets a 502 with a JSON null body', async () => {
    let refreshCalls = 0;
    jest.spyOn(global, 'fetch').mockImplementation((input) => {
      if (String(input).endsWith('/auth/refresh')) {
        refreshCalls += 1;
        return Promise.resolve(
          refreshCalls === 1
            ? response(200, {
                data: {
                  accessToken: 'access-1',
                  refreshToken: 'refresh-2',
                  user: { id: 'u-1', email: 'sara@example.com' },
                },
              })
            : response(502, null),
        );
      }
      return Promise.resolve(response(401, GUARD_401));
    });
    const storage = await storageWith('refresh-1');
    const view = await renderProvider(httpAuthService, storage);
    await waitFor(() => expect(view.status()).toBe('authenticated'));

    await act(async () => {
      await expect(within(apiClient.get('me/appointments'))).rejects.toMatchObject({
        kind: 'server',
      });
    });

    expect(view.status()).toBe('authenticated');
    expect(await storage.readRefreshToken()).toBe('refresh-2');
  });

  // Signed out, there is no session for a late 401 to end. It used to end
  // one anyway — the keychain was empty, so the handler answered "over" —
  // and the sign-in form said the session had expired after a sign-out.
  it('does not let a 401 that lands after signing out rewrite why the session ended', async () => {
    const refresh = jest.fn(() => Promise.resolve(SIGNED_IN));
    const view = await renderProvider(authServiceStub({ refresh }), await storageWith('r-1'));
    await waitFor(() => expect(view.status()).toBe('authenticated'));
    await act(async () => {
      await view.session().logout();
    });
    expect(view.status()).toBe('unauthenticated:signed-out');
    jest.spyOn(global, 'fetch').mockResolvedValue(response(401, GUARD_401));

    await act(async () => {
      await expect(within(apiClient.get('me/appointments'))).rejects.toMatchObject({
        kind: 'cancelled',
      });
    });

    expect(view.status()).toBe('unauthenticated:signed-out');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  // In `unconfirmed`, `retryRestore` owns the stored token: single-flight,
  // and held while Emergency is open. A tokenless request's 401 exchanging
  // it as well would present it twice (a replay, ADR-026) and sign the
  // patient in behind the hold.
  it('does not exchange the stored token on a 401 while unconfirmed', async () => {
    const refresh = jest
      .fn<Promise<SignInResult>, [string]>()
      .mockRejectedValueOnce(normalizeNetworkError())
      .mockResolvedValue(SIGNED_IN);
    const storage = await storageWith('refresh-1');
    const view = await renderProvider(authServiceStub({ refresh }), storage);
    await waitFor(() => expect(view.status()).toBe('unconfirmed'));
    jest.spyOn(global, 'fetch').mockResolvedValue(response(401, GUARD_401));

    await act(async () => {
      await expect(within(apiClient.get('me/appointments'))).rejects.toMatchObject({
        kind: 'cancelled',
      });
    });

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(view.status()).toBe('unconfirmed');
    expect(await storage.readRefreshToken()).toBe('refresh-1');
  });
});

describe('sign-out against work still in flight (M5)', () => {
  it('discards a retry that lands after signing out of an unconfirmed session', async () => {
    const second = deferred<SignInResult>();
    const logout = jest.fn(() => Promise.resolve());
    const refresh = jest
      .fn<Promise<SignInResult>, [string]>()
      .mockRejectedValueOnce(normalizeNetworkError())
      .mockImplementationOnce(() => second.promise);
    const storage = await storageWith('refresh-1');
    const view = await renderProvider(authServiceStub({ refresh, logout }), storage);
    await waitFor(() => expect(view.status()).toBe('unconfirmed'));

    let retry: Promise<string> = Promise.resolve('');
    await act(async () => {
      retry = view.session().retryRestore();
      await Promise.resolve();
      await view.session().logout();
    });
    await act(async () => {
      second.resolve(SIGNED_IN);
      await retry;
    });

    expect(view.status()).toBe('unauthenticated:signed-out');
    expect(apiClient.hasAccessToken()).toBe(false);
    expect(await storage.readRefreshToken()).toBeNull();
    // No access token, so nothing the server could act on: it is not asked.
    expect(logout).not.toHaveBeenCalled();
  });

  it('discards a mid-session refresh that lands after signing out', async () => {
    const pending = deferred<SignInResult>();
    const refresh = jest
      .fn<Promise<SignInResult>, [string]>()
      .mockResolvedValueOnce(SIGNED_IN)
      .mockImplementationOnce(() => pending.promise);
    const logout = jest.fn(() => Promise.resolve());
    const storage = await storageWith('refresh-1');
    const view = await renderProvider(authServiceStub({ refresh, logout }), storage);
    await waitFor(() => expect(view.status()).toBe('authenticated'));
    jest.spyOn(global, 'fetch').mockResolvedValue(response(401, GUARD_401));

    let request: Promise<unknown> = Promise.resolve();
    await act(async () => {
      request = apiClient.get('me/appointments').catch((error: unknown) => error);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await view.session().logout();
    });
    await act(async () => {
      pending.resolve(ROTATED_AGAIN);
      await expect(request).resolves.toMatchObject({ kind: 'cancelled' });
    });

    expect(logout).toHaveBeenCalledTimes(1);
    expect(view.status()).toBe('unauthenticated:signed-out');
    expect(apiClient.hasAccessToken()).toBe(false);
    expect(await storage.readRefreshToken()).toBeNull();
  });

  // A 401 that lands while the sign-out is still clearing the keychain: the
  // epoch has already moved on, but the screen still says `authenticated`.
  // A refresh started in that gap belonged to the new epoch, read the token
  // the clear had not yet removed, and signed the patient back in.
  it('does not let a refresh that starts while signing out sign the patient back in', async () => {
    const clearing = deferred<undefined>();
    const refresh = jest
      .fn<Promise<SignInResult>, [string]>()
      .mockResolvedValueOnce(SIGNED_IN)
      .mockResolvedValueOnce(ROTATED_AGAIN);
    const inner = await storageWith('refresh-1');
    let holdClear = false;
    const storage: TokenStorage = {
      readRefreshToken: () => inner.readRefreshToken(),
      writeRefreshToken: (token) => inner.writeRefreshToken(token),
      readSessionGuard: () => inner.readSessionGuard(),
      writeSessionGuard: (record) => inner.writeSessionGuard(record),
      clear: async () => {
        if (holdClear) await clearing.promise;
        await inner.clear();
      },
    };
    const view = await renderProvider(authServiceStub({ refresh }), storage);
    await waitFor(() => expect(view.status()).toBe('authenticated'));
    jest.spyOn(global, 'fetch').mockResolvedValue(response(401, GUARD_401));

    holdClear = true;
    let signingOut: Promise<void> = Promise.resolve();
    let request: Promise<unknown> = Promise.resolve();
    await act(async () => {
      signingOut = view.session().logout();
      await new Promise((resolve) => setTimeout(resolve, 0));
      request = apiClient.get('me/appointments').catch((error: unknown) => error);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      clearing.resolve(undefined);
      await signingOut;
      await within(request);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(view.status()).toBe('unauthenticated:signed-out');
    expect(apiClient.hasAccessToken()).toBe(false);
    expect(await storage.readRefreshToken()).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not let a refusal that lands after signing out rewrite why the session ended', async () => {
    const pending = deferred<SignInResult>();
    const refresh = jest
      .fn<Promise<SignInResult>, [string]>()
      .mockResolvedValueOnce(SIGNED_IN)
      .mockImplementationOnce(() => pending.promise);
    const view = await renderProvider(authServiceStub({ refresh }), await storageWith('r-1'));
    await waitFor(() => expect(view.status()).toBe('authenticated'));
    jest.spyOn(global, 'fetch').mockResolvedValue(response(401, GUARD_401));

    let request: Promise<unknown> = Promise.resolve();
    await act(async () => {
      request = apiClient.get('me/appointments').catch((error: unknown) => error);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await view.session().logout();
    });
    const rejection = await refused();
    await act(async () => {
      pending.reject(rejection);
      await request;
    });

    expect(view.status()).toBe('unauthenticated:signed-out');
  });
});

/** A NetInfo whose listener the test drives, as `network.test.tsx` does. */
function captureNetInfo() {
  const listeners: ((state: { isConnected: boolean; isInternetReachable: boolean }) => void)[] = [];
  jest.spyOn(NetInfo, 'addEventListener').mockImplementation(((listener: (s: unknown) => void) => {
    listeners.push(listener);
    return () => undefined;
  }) as unknown as typeof NetInfo.addEventListener);
  return (isOnline: boolean) => {
    for (const listener of [...listeners]) {
      listener({ isConnected: isOnline, isInternetReachable: isOnline });
    }
  };
}

/** `AppState` transitions a test emits by hand; `remove()` really removes. */
function captureAppState() {
  const listeners: ((state: ReactNative.AppStateStatus) => void)[] = [];
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_event, listener) => {
    listeners.push(listener);
    return {
      remove: () => {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      },
    };
  });
  return (state: ReactNative.AppStateStatus) => {
    for (const listener of [...listeners]) listener(state);
  };
}

/** The real gate: provider, network, `RootNavigator`, and the session. */
async function renderGate(authService: AuthService, storage: TokenStorage) {
  const setOnline = captureNetInfo();
  const navigation = createNavigationContainerRef();
  let status = '';
  function Probe() {
    status = useSession().state.status;
    return null;
  }
  const view = renderWithProviders(
    <NetworkProvider>
      <SessionProvider authService={authService} tokenStorage={storage}>
        <Probe />
        <NavigationContainer ref={navigation}>
          <RootNavigator />
        </NavigationContainer>
      </SessionProvider>
    </NetworkProvider>,
  );
  await act(async () => undefined);
  return { ...view, setOnline, navigation, status: () => status };
}

async function openEmergency(view: Awaited<ReturnType<typeof renderGate>>) {
  fireEvent.press(view.getByTestId('header-emergency'));
  await waitFor(() => expect(view.getByTestId('emergency-screen')).toBeTruthy());
}

async function leaveEmergency(view: Awaited<ReturnType<typeof renderGate>>) {
  await act(async () => {
    view.navigation.goBack();
  });
}

describe('the unconfirmed screen', () => {
  it('replaces the app, not the sign-in form, and keeps Emergency one tap away', async () => {
    const view = await renderGate(
      authServiceStub({ refresh: jest.fn(() => Promise.reject(normalizeNetworkError())) }),
      await storageWith('refresh-1'),
    );
    act(() => view.setOnline(false));

    await waitFor(() => expect(view.getByTestId('session-unconfirmed-screen')).toBeTruthy());
    expect(view.queryByTestId('app-tabs')).toBeNull();
    expect(view.queryByTestId('login-screen')).toBeNull();
    expect(
      view.getByText('This phone is offline. We will try again when the connection comes back.'),
    ).toBeTruthy();

    await openEmergency(view);
    expect(view.queryByTestId('app-tabs')).toBeNull();
  });

  it('says so when a retry still gets no answer', async () => {
    const refresh = jest.fn(() => Promise.reject(normalizeNetworkError()));
    const view = await renderGate(authServiceStub({ refresh }), await storageWith('refresh-1'));
    await waitFor(() => expect(view.getByTestId('session-unconfirmed-screen')).toBeTruthy());

    fireEvent.press(view.getByTestId('session-unconfirmed-retry'));

    await waitFor(() => expect(view.getByTestId('session-unconfirmed-still')).toBeTruthy());
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('leaves for the sign-in form when a retry is refused', async () => {
    const rejected = await refused();
    const refresh = jest
      .fn<Promise<SignInResult>, [string]>()
      .mockRejectedValueOnce(normalizeNetworkError())
      .mockRejectedValueOnce(rejected);
    const storage = await storageWith('refresh-1');
    const view = await renderGate(authServiceStub({ refresh }), storage);
    await waitFor(() => expect(view.getByTestId('session-unconfirmed-screen')).toBeTruthy());

    fireEvent.press(view.getByTestId('session-unconfirmed-retry'));

    await waitFor(() => expect(view.queryByTestId('session-unconfirmed-screen')).toBeNull());
    expect(view.queryByTestId('app-tabs')).toBeNull();
    expect(await storage.readRefreshToken()).toBeNull();
  });

  it('retries by itself when the phone comes back online, and not before', async () => {
    const refresh = jest.fn(() => Promise.reject(normalizeNetworkError()));
    const view = await renderGate(authServiceStub({ refresh }), await storageWith('refresh-1'));
    act(() => view.setOnline(false));
    await waitFor(() => expect(view.getByTestId('session-unconfirmed-screen')).toBeTruthy());
    expect(refresh).toHaveBeenCalledTimes(1);

    act(() => view.setOnline(false));
    expect(refresh).toHaveBeenCalledTimes(1);

    act(() => view.setOnline(true));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
  });

  it('retries by itself when the app returns to the foreground, once per return', async () => {
    const emit = captureAppState();
    const refresh = jest.fn(() => Promise.reject(normalizeNetworkError()));
    const view = await renderGate(authServiceStub({ refresh }), await storageWith('refresh-1'));
    await waitFor(() => expect(view.getByTestId('session-unconfirmed-screen')).toBeTruthy());
    expect(refresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      emit('background');
      emit('active');
    });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));

    // `active` again with no departure in between is not a return.
    await act(async () => {
      emit('active');
    });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('holds a foreground retry while Emergency is open', async () => {
    const emit = captureAppState();
    const refresh = jest
      .fn<Promise<SignInResult>, [string]>()
      .mockRejectedValueOnce(normalizeNetworkError())
      .mockResolvedValueOnce(SIGNED_IN);
    const view = await renderGate(authServiceStub({ refresh }), await storageWith('refresh-1'));
    await waitFor(() => expect(view.getByTestId('session-unconfirmed-screen')).toBeTruthy());
    await openEmergency(view);

    await act(async () => {
      emit('background');
      emit('active');
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('emergency-screen')).toBeTruthy();

    await leaveEmergency(view);
    await waitFor(() => expect(view.getByTestId('app-tabs')).toBeTruthy());
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('ignores a reconnect that arrives while a tapped retry is still waiting', async () => {
    const second = deferred<SignInResult>();
    const refresh = jest
      .fn<Promise<SignInResult>, [string]>()
      .mockRejectedValueOnce(normalizeNetworkError())
      .mockImplementationOnce(() => second.promise);
    const view = await renderGate(authServiceStub({ refresh }), await storageWith('refresh-1'));
    act(() => view.setOnline(false));
    await waitFor(() => expect(view.getByTestId('session-unconfirmed-screen')).toBeTruthy());

    fireEvent.press(view.getByTestId('session-unconfirmed-retry'));
    // The tapped retry reaches the server only after its keychain read.
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));

    act(() => view.setOnline(true));
    await act(async () => undefined);

    // Still one exchange in flight, and no verdict shown while it waits.
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(view.queryByTestId('session-unconfirmed-still')).toBeNull();

    await act(async () => second.reject(normalizeNetworkError()));
    await waitFor(() => expect(view.getByTestId('session-unconfirmed-still')).toBeTruthy());
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('says the sign-out is this phone only, and never asks the server', async () => {
    const logout = jest.fn(() => Promise.resolve());
    const storage = await storageWith('refresh-1');
    const view = await renderGate(
      authServiceStub({ refresh: jest.fn(() => Promise.reject(normalizeNetworkError())), logout }),
      storage,
    );
    await waitFor(() => expect(view.getByTestId('session-unconfirmed-screen')).toBeTruthy());

    fireEvent.press(view.getByTestId('session-unconfirmed-sign-out'));
    expect(view.getByText(/only this phone will be signed out/, { exact: false })).toBeTruthy();
    expect(await storage.readRefreshToken()).toBe('refresh-1');

    fireEvent.press(view.getByTestId('session-unconfirmed-sign-out-confirm-confirm'));

    await waitFor(() => expect(view.queryByTestId('session-unconfirmed-screen')).toBeNull());
    expect(logout).not.toHaveBeenCalled();
    expect(view.status()).toBe('unauthenticated');
    expect(await storage.readRefreshToken()).toBeNull();
  });

  it('lets the patient sign out during a retry, and the retry cannot sign them back in', async () => {
    const second = deferred<SignInResult>();
    const refresh = jest
      .fn<Promise<SignInResult>, [string]>()
      .mockRejectedValueOnce(normalizeNetworkError())
      .mockImplementationOnce(() => second.promise);
    const storage = await storageWith('refresh-1');
    const view = await renderGate(authServiceStub({ refresh }), storage);
    await waitFor(() => expect(view.getByTestId('session-unconfirmed-screen')).toBeTruthy());

    fireEvent.press(view.getByTestId('session-unconfirmed-retry'));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    fireEvent.press(view.getByTestId('session-unconfirmed-sign-out'));
    fireEvent.press(view.getByTestId('session-unconfirmed-sign-out-confirm-confirm'));
    await waitFor(() => expect(view.status()).toBe('unauthenticated'));

    await act(async () => second.resolve(SIGNED_IN));

    expect(view.status()).toBe('unauthenticated');
    expect(view.queryByTestId('app-tabs')).toBeNull();
    expect(apiClient.hasAccessToken()).toBe(false);
    expect(await storage.readRefreshToken()).toBeNull();
  });
});

describe('Emergency is never closed by a retry (M4)', () => {
  it('holds a reconnect until the patient leaves Emergency', async () => {
    const refresh = jest
      .fn<Promise<SignInResult>, [string]>()
      .mockRejectedValueOnce(normalizeNetworkError())
      .mockResolvedValueOnce(SIGNED_IN);
    const view = await renderGate(authServiceStub({ refresh }), await storageWith('refresh-1'));
    act(() => view.setOnline(false));
    await waitFor(() => expect(view.getByTestId('session-unconfirmed-screen')).toBeTruthy());
    await openEmergency(view);

    act(() => view.setOnline(true));
    await act(async () => undefined);

    expect(refresh).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('emergency-screen')).toBeTruthy();

    await leaveEmergency(view);
    await waitFor(() => expect(view.getByTestId('app-tabs')).toBeTruthy());
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('holds a successful retry until the patient leaves Emergency, storing the token at once', async () => {
    const second = deferred<SignInResult>();
    const refresh = jest
      .fn<Promise<SignInResult>, [string]>()
      .mockRejectedValueOnce(normalizeNetworkError())
      .mockImplementationOnce(() => second.promise);
    const storage = await storageWith('refresh-1');
    const view = await renderGate(authServiceStub({ refresh }), storage);
    await waitFor(() => expect(view.getByTestId('session-unconfirmed-screen')).toBeTruthy());

    fireEvent.press(view.getByTestId('session-unconfirmed-retry'));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    await openEmergency(view);
    await act(async () => second.resolve(SIGNED_IN));

    // Still reading the guidance; the rotated token is already stored.
    expect(view.getByTestId('emergency-screen')).toBeTruthy();
    expect(view.queryByTestId('app-tabs')).toBeNull();
    expect(view.status()).toBe('unconfirmed');
    expect(await storage.readRefreshToken()).toBe('refresh-2');

    await leaveEmergency(view);
    await waitFor(() => expect(view.getByTestId('app-tabs')).toBeTruthy());
  });

  it('holds a refused retry until the patient leaves Emergency', async () => {
    const second = deferred<SignInResult>();
    const refresh = jest
      .fn<Promise<SignInResult>, [string]>()
      .mockRejectedValueOnce(normalizeNetworkError())
      .mockImplementationOnce(() => second.promise);
    const view = await renderGate(authServiceStub({ refresh }), await storageWith('refresh-1'));
    await waitFor(() => expect(view.getByTestId('session-unconfirmed-screen')).toBeTruthy());

    fireEvent.press(view.getByTestId('session-unconfirmed-retry'));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(2));
    await openEmergency(view);
    const rejection = await refused();
    await act(async () => second.reject(rejection));

    expect(view.getByTestId('emergency-screen')).toBeTruthy();
    expect(view.status()).toBe('unconfirmed');

    await leaveEmergency(view);
    await waitFor(() => expect(view.status()).toBe('unauthenticated'));
    expect(view.queryByTestId('session-unconfirmed-screen')).toBeNull();
  });
});

/**
 * A keychain that throws (S1). SecureStore surfaces a Keystore that lost
 * its key, or an entry it cannot decrypt, as a rejected promise; neither
 * may leave the patient on the boot screen, or a session on the screen.
 */
function throwingStorage(overrides: Partial<TokenStorage>): TokenStorage {
  const inner = createTokenStorage(createInMemorySecureStore());
  return {
    readRefreshToken: () => inner.readRefreshToken(),
    writeRefreshToken: (token) => inner.writeRefreshToken(token),
    readSessionGuard: () => inner.readSessionGuard(),
    writeSessionGuard: (record) => inner.writeSessionGuard(record),
    clear: () => inner.clear(),
    ...overrides,
  };
}

describe('a keychain that throws (S1)', () => {
  it('lands signed out, not booting, when the read throws on a cold start', async () => {
    const refresh = jest.fn(() => Promise.resolve(SIGNED_IN));
    const storage = throwingStorage({
      readRefreshToken: () => Promise.reject(new Error('keystore key invalidated')),
    });
    const view = await renderProvider(authServiceStub({ refresh }), storage);

    await waitFor(() => expect(view.status()).toBe('unauthenticated:'));
    expect(refresh).not.toHaveBeenCalled();
    expect(apiClient.hasAccessToken()).toBe(false);
  });

  it('lands signed out when the read throws on a retry', async () => {
    let reads = 0;
    const storage = throwingStorage({
      readRefreshToken: () => {
        reads += 1;
        return reads === 1
          ? Promise.resolve('refresh-1')
          : Promise.reject(new Error('keystore key invalidated'));
      },
    });
    const refresh = jest.fn(() => Promise.reject(normalizeNetworkError()));
    const view = await renderProvider(authServiceStub({ refresh }), storage);
    await waitFor(() => expect(view.status()).toBe('unconfirmed'));

    let outcome: string | undefined;
    await act(async () => {
      outcome = await view.session().retryRestore();
    });

    expect(outcome).toBe('settled');
    expect(view.status()).toBe('unauthenticated:');
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('still sweeps PHI and signs out when the keychain delete throws on logout', async () => {
    const lines: string[] = [];
    addLogSink((entry) => lines.push(JSON.stringify(entry)));
    const inner = await storageWith('refresh-secret-value');
    const storage = throwingStorage({
      readRefreshToken: () => inner.readRefreshToken(),
      clear: () => Promise.reject(new Error('keychain unavailable')),
    });
    const view = await renderProvider(authServiceStub(), storage);
    await waitFor(() => expect(view.status()).toBe('authenticated'));
    view.queryClient.setQueryData(['profile', 'me'], { fullName: 'Sara Ahmed' });

    await act(async () => {
      await within(view.session().logout());
    });

    expect(view.status()).toBe('unauthenticated:signed-out');
    expect(apiClient.hasAccessToken()).toBe(false);
    expect(view.queryClient.getQueryCache().getAll()).toHaveLength(0);
    const joined = lines.join('\n');
    expect(joined).toContain('could not be cleared');
    expect(joined).not.toContain('refresh-secret-value');
    expect(joined).not.toContain('refresh-2');
  });
});

describe('the PHI sweep at the end of a session (PA-10)', () => {
  it.each([
    ['signing out', 'unauthenticated:signed-out'],
    ['losing the session', 'unauthenticated:session-expired'],
  ])('leaves no patient data in the query cache after %s', async (label, expected) => {
    const refusal = await refused();
    const refresh = jest
      .fn<Promise<SignInResult>, [string]>()
      .mockResolvedValueOnce(SIGNED_IN)
      .mockRejectedValue(refusal);
    const view = await renderProvider(authServiceStub({ refresh }), await storageWith('r-1'));
    await waitFor(() => expect(view.status()).toBe('authenticated'));
    for (const domain of PHI_QUERY_DOMAINS) {
      view.queryClient.setQueryData([domain, 'list', {}], [{ patient: 'Sara Ahmed' }]);
      view.queryClient.setQueryData([domain, 'detail', 'id-1'], { patient: 'Sara Ahmed' });
    }
    // A domain nobody listed: the trailing `clear()` is what covers it.
    view.queryClient.setQueryData(['unlisted-domain'], { patient: 'Sara Ahmed' });
    expect(view.queryClient.getQueryCache().getAll().length).toBeGreaterThan(0);

    await act(async () => {
      if (label === 'signing out') {
        await view.session().logout();
        return;
      }
      // The guard answers 401 and the refresh is refused: the transport
      // ends the session.
      jest.spyOn(global, 'fetch').mockResolvedValue(response(401, GUARD_401));
      await apiClient.get('me/appointments').catch(() => undefined);
    });

    await waitFor(() => expect(view.status()).toBe(expected));
    expect(view.queryClient.getQueryCache().getAll()).toHaveLength(0);
    for (const domain of PHI_QUERY_DOMAINS) {
      expect(view.queryClient.getQueryData([domain, 'list', {}])).toBeUndefined();
      expect(view.queryClient.getQueryData([domain, 'detail', 'id-1'])).toBeUndefined();
    }
  });
});

describe('a keychain that throws mid-session (S1)', () => {
  it('keeps the session and the entry when the read throws during a refresh', async () => {
    const lines: string[] = [];
    addLogSink((entry) => lines.push(JSON.stringify(entry)));
    let reads = 0;
    const clear = jest.fn(() => Promise.resolve());
    const storage = throwingStorage({
      readRefreshToken: () => {
        reads += 1;
        return reads === 1
          ? Promise.resolve('refresh-secret-value')
          : Promise.reject(new Error('keystore busy'));
      },
      clear,
    });
    const refresh = jest.fn(() => Promise.resolve(SIGNED_IN));
    const view = await renderProvider(authServiceStub({ refresh }), storage);
    await waitFor(() => expect(view.status()).toBe('authenticated'));
    jest.spyOn(global, 'fetch').mockResolvedValue(response(401, GUARD_401));

    await act(async () => {
      await expect(within(apiClient.get('me/appointments'))).rejects.toMatchObject({
        kind: 'cancelled',
      });
    });

    expect(view.status()).toBe('authenticated');
    expect(clear).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledTimes(1);
    const joined = lines.join('\n');
    expect(joined).toContain('mid-session refresh');
    expect(joined).not.toContain('refresh-secret-value');
  });
});
