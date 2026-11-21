import type { ReactNode } from 'react';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react-native';
import { Text } from 'react-native';

import { apiClient } from '@/api/client';
import { createInMemorySecureStore } from '@/storage/secure-store';

import { fixtureAuthService } from '../fixtures/fixture-auth-service';
import type { AuthService } from '../model/types';
import { SessionProvider, useSession } from '../SessionProvider';
import { createTokenStorage, type TokenStorage } from '../storage';

import { DEMO_PATIENT_REFRESH_TOKEN, DEMO_PATIENT_SESSION, withDemoAccess } from './demo-session';

/**
 * "Continue as Demo Patient", end to end through the real session machine.
 *
 * The unit tests next door prove `withDemoAccess` in isolation. This one
 * proves the thing the feature was actually asked for — that the session
 * survives an app restart — by doing what a restart does: mount a fresh
 * `SessionProvider` over the token the previous one left in the keychain.
 *
 * The last case is the important one. It restarts with the *same* stored
 * token against the bare adapter, which is what a release build runs
 * (`service.ts` applies `withDemoAccess` only under `__DEV__`). It must
 * come back signed out. A guard that also passes when it is absent is not
 * a guard.
 */

interface Harness {
  readonly status: () => string;
  readonly session: () => ReturnType<typeof useSession>;
  readonly storage: TokenStorage;
}

/** Mirrors `session.test.tsx`'s harness, with an injectable token store. */
function renderSession(options: {
  authService: AuthService;
  storage: TokenStorage;
}): Promise<Harness> {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let captured: ReturnType<typeof useSession> | null = null;

  function Probe() {
    const session = useSession();
    captured = session;
    return <Text testID="status">{session.state.status}</Text>;
  }

  function Tree({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  const view = render(
    <Tree>
      <SessionProvider authService={options.authService} tokenStorage={options.storage}>
        <Probe />
      </SessionProvider>
    </Tree>,
  );

  return Promise.resolve({
    status: () => String(view.getByTestId('status').props.children),
    session: () => {
      if (captured === null) throw new Error('Session was not captured.');
      return captured;
    },
    storage: options.storage,
  });
}

afterEach(() => {
  apiClient.setAccessToken(null);
  apiClient.setRefreshHandler(null);
  apiClient.setSessionLostHandler(null);
  jest.restoreAllMocks();
});

describe('pressing "Continue as Demo Patient"', () => {
  it('authenticates the demo patient and leaves its token on the device', async () => {
    const storage = createTokenStorage(createInMemorySecureStore());
    const harness = await renderSession({
      authService: withDemoAccess(fixtureAuthService),
      storage,
    });
    await waitFor(() => expect(harness.status()).toBe('unauthenticated'));

    // Exactly what the button does.
    await act(async () => {
      await harness.session().adoptSession(DEMO_PATIENT_SESSION);
    });

    await waitFor(() => expect(harness.status()).toBe('authenticated'));
    await expect(storage.readRefreshToken()).resolves.toBe(DEMO_PATIENT_REFRESH_TOKEN);
  });

  it('survives a restart in development, so a reload does not throw the developer out', async () => {
    const store = createInMemorySecureStore();
    const storage = createTokenStorage(store);
    const service = withDemoAccess(fixtureAuthService);

    const first = await renderSession({ authService: service, storage });
    await waitFor(() => expect(first.status()).toBe('unauthenticated'));
    await act(async () => {
      await first.session().adoptSession(DEMO_PATIENT_SESSION);
    });
    await waitFor(() => expect(first.status()).toBe('authenticated'));

    // A cold start: a new provider over the same keychain.
    const restarted = await renderSession({
      authService: service,
      storage: createTokenStorage(store),
    });

    await waitFor(() => expect(restarted.status()).toBe('authenticated'));
    expect(restarted.session().state).toMatchObject({
      status: 'authenticated',
      identity: { displayName: 'Demo Patient' },
    });
  });

  it('does not survive a logout', async () => {
    const store = createInMemorySecureStore();
    const storage = createTokenStorage(store);
    const service = withDemoAccess(fixtureAuthService);

    const first = await renderSession({ authService: service, storage });
    await waitFor(() => expect(first.status()).toBe('unauthenticated'));
    await act(async () => {
      await first.session().adoptSession(DEMO_PATIENT_SESSION);
    });
    await act(async () => {
      await first.session().logout();
    });

    await expect(storage.readRefreshToken()).resolves.toBeNull();

    const restarted = await renderSession({
      authService: service,
      storage: createTokenStorage(store),
    });
    await waitFor(() => expect(restarted.status()).toBe('unauthenticated'));
  });
});

describe('the same stored token in a release build', () => {
  it('restores nothing, because nothing outside development honours it', async () => {
    // The production-safety assertion. `withDemoAccess` is absent here
    // exactly as `__DEV__ ? withDemoAccess(selected) : selected` leaves it
    // absent in a release build — so even a device that somehow carried
    // the demo token from a development install lands on the login screen.
    const store = createInMemorySecureStore();
    const storage = createTokenStorage(store);
    await storage.writeRefreshToken(DEMO_PATIENT_REFRESH_TOKEN);

    const harness = await renderSession({ authService: fixtureAuthService, storage });

    await waitFor(() => expect(harness.status()).toBe('unauthenticated'));
    expect(harness.session().state).toMatchObject({
      status: 'unauthenticated',
      reason: 'session-expired',
    });
    // The rejected token is cleared rather than left to be retried.
    await expect(storage.readRefreshToken()).resolves.toBeNull();
  });
});
