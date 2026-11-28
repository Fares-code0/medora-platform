import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

import { formatMinutes } from '@/i18n/duration';
import type { AuthStackParamList } from '@/navigation/routes';
import { createInMemorySecureStore } from '@/storage/secure-store';
import { renderWithProviders } from '@/test/render';

import { sessionLockPolicy, type SessionLockPolicy } from './lock-policy';
import type { AuthService, SignInResult } from './model/types';
import { LoginScreen } from './screens/LoginScreen';
import { SessionProvider } from './SessionProvider';
import { createTokenStorage } from './storage';

/**
 * What the sign-in screen says about why you are here — T-11, D-12.
 *
 * `session.test.tsx` proves the session ends with the right *reason*.
 * Nothing proved a patient is ever told it. That is the half T-11's row
 * is actually about — "the login screen says why" — and it is the
 * difference between a patient who understands they were signed out for
 * being away and one who thinks the app lost their account.
 *
 * The notice is also the case where two messages could collide: a
 * background timeout puts a notice on the screen, and a failed sign-in
 * puts an error on it. Both at once would be two explanations for one
 * screen, so the error wins and the notice goes.
 */

const SIGNED_IN: SignInResult = {
  tokens: { accessToken: 'access-1', refreshToken: 'refresh-1' },
  identity: {
    subjectId: 'subject-1',
    role: 'patient',
    displayName: 'Sara Ahmed',
    email: 'sara@example.com',
    emailVerified: true,
  },
};

const POLICY: SessionLockPolicy = {
  phiSweepAfterMs: 5 * 60_000,
  reauthenticateAfterMs: 15 * 60_000,
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

function screenProps(navigation: object): NativeStackScreenProps<AuthStackParamList, 'Login'> {
  return {
    navigation,
    route: { key: 'Login-1', name: 'Login', params: undefined },
  } as unknown as NativeStackScreenProps<AuthStackParamList, 'Login'>;
}

/** `AppState` whose `remove()` really removes — the provider resubscribes. */
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

async function signedInThenAwayFor(awayMs: number, overrides: Partial<AuthService> = {}) {
  const emit = captureAppState();
  const storage = createTokenStorage(createInMemorySecureStore());
  await storage.writeRefreshToken('refresh-1');
  const authService = authServiceStub(overrides);

  const view = renderWithProviders(
    <SessionProvider authService={authService} tokenStorage={storage} lockPolicy={POLICY}>
      <LoginScreen {...screenProps({ navigate: jest.fn() })} />
    </SessionProvider>,
  );

  // The restore has to land before the absence is measured, or the
  // foreground handler ignores it as "no session".
  await waitFor(() => expect(view.queryByTestId('login-screen')).toBeTruthy());
  await act(async () => undefined);

  let now = Date.now();
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  await act(async () => {
    emit('background');
    now += awayMs;
    emit('active');
  });

  return { ...view, authService };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('after a background timeout (T-11)', () => {
  it('says the app signed you out, and how long it waited', async () => {
    const view = await signedInThenAwayFor(20 * 60_000);

    await waitFor(() => expect(view.getByTestId('login-session-notice')).toBeTruthy());
    // The number in the sentence is the configured threshold, not a
    // constant typed into the copy: a notice naming a different window
    // from the one the gate used is worse than no notice.
    expect(view.getByText(/Medora signed you out after/)).toBeTruthy();
    expect(
      view.getByText(new RegExp(formatMinutes('en', POLICY.reauthenticateAfterMs))),
    ).toBeTruthy();
    expect(view.getByText(/for your security/)).toBeTruthy();
  });

  it('quotes the configured window rather than a hardcoded number', async () => {
    // The threshold is an environment variable. A notice naming a
    // different number from the one the gate used is worse than none.
    //
    // `formatMinutes` replaced `describeMinutes` when the notice had to
    // exist in two languages: Arabic has four forms where English has
    // two, and a catalogue slot taking a bare number gets three of them
    // wrong (`i18n/duration.ts`).
    expect(formatMinutes('en', sessionLockPolicy.reauthenticateAfterMs)).toMatch(/minutes?$/);
  });

  it('says nothing when the absence was short enough to keep the session', async () => {
    const view = await signedInThenAwayFor(60_000);

    expect(view.queryByTestId('login-session-notice')).toBeNull();
  });
});

describe('after a session the server rejected (D-12)', () => {
  it('explains the ending rather than showing a blank sign-in screen', async () => {
    const storage = createTokenStorage(createInMemorySecureStore());
    await storage.writeRefreshToken('stale');
    const authService = authServiceStub({
      refresh: jest.fn(() =>
        Promise.reject(
          Object.assign(new Error('API error: auth'), { kind: 'auth', code: 'unauthorized' }),
        ),
      ),
    });

    const view = renderWithProviders(
      <SessionProvider authService={authService} tokenStorage={storage}>
        <LoginScreen {...screenProps({ navigate: jest.fn() })} />
      </SessionProvider>,
    );

    await waitFor(() => expect(view.getByTestId('login-session-notice')).toBeTruthy());
    expect(view.getByText(/ended for your security/)).toBeTruthy();
  });

  it('shows nothing for a cold start with no stored session at all', async () => {
    // Nobody was signed out; there is nothing to explain.
    const view = renderWithProviders(
      <SessionProvider
        authService={authServiceStub()}
        tokenStorage={createTokenStorage(createInMemorySecureStore())}
      >
        <LoginScreen {...screenProps({ navigate: jest.fn() })} />
      </SessionProvider>,
    );

    await act(async () => undefined);

    expect(view.queryByTestId('login-session-notice')).toBeNull();
  });
});

describe('one screen, one explanation', () => {
  it('replaces the notice with the error when a sign-in then fails', async () => {
    // Both at once would be two answers to "why am I looking at this
    // screen?", and the one the patient just caused is the live one.
    const view = await signedInThenAwayFor(20 * 60_000, {
      login: jest.fn(() =>
        Promise.reject(
          Object.assign(new Error('API error: auth'), {
            kind: 'auth',
            code: 'invalid_credentials',
          }),
        ),
      ),
    });

    await waitFor(() => expect(view.getByTestId('login-session-notice')).toBeTruthy());

    fireEvent.changeText(view.getByTestId('login-email'), 'sara@example.com');
    fireEvent.changeText(view.getByTestId('login-password'), 'wrong');
    await act(async () => {
      fireEvent.press(view.getByTestId('login-submit'));
    });

    await waitFor(() => expect(view.getByTestId('login-error')).toBeTruthy());
    expect(view.queryByTestId('login-session-notice')).toBeNull();
  });
});
