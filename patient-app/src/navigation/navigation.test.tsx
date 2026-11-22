import type { ReactNode } from 'react';

import {
  createNavigationContainerRef,
  NavigationContainer,
  type NavigationContainerRefWithCurrent,
} from '@react-navigation/native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ToastProvider } from '@/components';
import type { AuthService, SignInResult } from '@/features/auth/model/types';
import { SessionProvider } from '@/features/auth/SessionProvider';
import { createTokenStorage } from '@/features/auth/storage';
import { forgetOnboarding, markOnboardingSeen } from '@/features/onboarding/seen';
import { LocaleProvider } from '@/i18n';
import { NetworkProvider } from '@/network/NetworkProvider';
import { createInMemorySecureStore } from '@/storage/secure-store';
import { ThemeProvider } from '@/theme';

import { linking } from './linking';
import { RootNavigator } from './RootNavigator';
import type { RootStackParamList } from './routes';

/**
 * Navigation tests.
 *
 * The load-bearing one is **"Emergency is reachable while signed out"**
 * (checklist U-03). It is the guarantee the whole Emergency feature
 * exists for, and it is exactly the kind of thing a routing refactor
 * breaks without anybody noticing until it matters.
 */

const SAFE_AREA_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

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

function renderApp(
  options: {
    authService?: AuthService;
    storedRefreshToken?: string;
    navigationRef?: NavigationContainerRefWithCurrent<RootStackParamList>;
  } = {},
) {
  const secureStore = createInMemorySecureStore();
  const tokenStorage = createTokenStorage(secureStore);
  const authService = options.authService ?? stubAuthService();

  const seed =
    options.storedRefreshToken === undefined
      ? Promise.resolve()
      : tokenStorage.writeRefreshToken(options.storedRefreshToken);

  function Tree({ children }: { children: ReactNode }) {
    return (
      <SafeAreaProvider initialMetrics={SAFE_AREA_METRICS}>
        {/* Above the theme, as in `App.tsx`: direction is a layout
            property, and the state components read their copy from the
            catalogue (C-09) so this tree must supply one. */}
        <LocaleProvider>
          <ThemeProvider initialMode="light">
            {/* `gcTime: 0` is not a detail: a cached query schedules a
              five-minute garbage-collection timer when it goes inactive,
              and that timer keeps Node's event loop alive long after the
              assertions finish — the suite passes and then hangs. */}
            <QueryClientProvider
              client={new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })}
            >
              <NetworkProvider>
                <SessionProvider authService={authService} tokenStorage={tokenStorage}>
                  <ToastProvider>{children}</ToastProvider>
                </SessionProvider>
              </NetworkProvider>
            </QueryClientProvider>
          </ThemeProvider>
        </LocaleProvider>
      </SafeAreaProvider>
    );
  }

  return seed.then(() =>
    render(
      <Tree>
        <NavigationContainer linking={linking} ref={options.navigationRef}>
          <RootNavigator />
        </NavigationContainer>
      </Tree>,
    ),
  );
}

describe('first launch', () => {
  beforeEach(forgetOnboarding);
  afterEach(markOnboardingSeen);

  it('lands on the onboarding carousel (E-02)', async () => {
    await renderApp();

    await waitFor(() => expect(screen.getByTestId('onboarding-screen')).toBeTruthy());
  });

  it('STILL reaches Emergency without signing in (U-03)', async () => {
    // The guarantee U-03 protects is about the person, not the screen:
    // putting a carousel in front of Welcome must not put it in front of
    // emergency guidance. The carousel carries its own Emergency button
    // for this reason.
    await renderApp();

    await waitFor(() => expect(screen.getByTestId('onboarding-screen')).toBeTruthy());
    fireEvent.press(screen.getByTestId('onboarding-emergency'));

    await waitFor(() => expect(screen.getByTestId('emergency-screen')).toBeTruthy());
  });

  it('reaches Welcome by skipping, and does not come back', async () => {
    await renderApp();

    await waitFor(() => expect(screen.getByTestId('onboarding-screen')).toBeTruthy());
    fireEvent.press(screen.getByTestId('onboarding-skip'));

    await waitFor(() => expect(screen.getByTestId('welcome-screen')).toBeTruthy());
    expect(screen.queryByTestId('onboarding-screen')).toBeNull();
  });
});

describe('the signed-out stack', () => {
  // A returning patient. First launch has its own block above.
  beforeEach(markOnboardingSeen);

  it('lands on Welcome when there is no stored session', async () => {
    await renderApp();
    await waitFor(() => {
      expect(screen.getByTestId('welcome-screen')).toBeTruthy();
    });
  });

  it('reaches Emergency without signing in (U-03)', async () => {
    await renderApp();
    await waitFor(() => {
      expect(screen.getByTestId('welcome-emergency-card')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('welcome-emergency-card'));

    await waitFor(() => {
      expect(screen.getByTestId('emergency-screen')).toBeTruthy();
    });
  });

  it('reaches Emergency from the sign-in screen too', async () => {
    await renderApp();
    await waitFor(() => {
      expect(screen.getByTestId('welcome-sign-in')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('welcome-sign-in'));
    await waitFor(() => {
      expect(screen.getByTestId('login-emergency')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('login-emergency'));
    await waitFor(() => {
      expect(screen.getByTestId('emergency-screen')).toBeTruthy();
    });
  });

  /**
   * N-12 — the affordance is on the signed-out header too.
   *
   * `Register` stands for the whole set. Until 2026-09-14 `AuthStack`
   * set no `headerRight`, so every screen past Welcome and Login —
   * registration, OTP, email confirmation, password reset, consent —
   * had no route to Emergency but the back button. The route existed;
   * reaching it took two taps and a decision.
   */
  it('keeps Emergency on the header of the signed-out stack (N-12)', async () => {
    await renderApp();
    await waitFor(() => {
      expect(screen.getByTestId('welcome-register')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('welcome-register'));
    await waitFor(() => {
      expect(screen.getByTestId('register-screen')).toBeTruthy();
    });

    // One tap, from a screen that carries no Emergency card of its own.
    fireEvent.press(screen.getByTestId('header-emergency'));
    await waitFor(() => {
      expect(screen.getByTestId('emergency-screen')).toBeTruthy();
    });
  });

  it('drops the header affordance on Emergency itself (N-12)', async () => {
    // A control pointing at the screen it is already on is a control
    // that teaches a patient the button does nothing.
    await renderApp();
    await waitFor(() => {
      expect(screen.getByTestId('welcome-emergency-card')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('welcome-emergency-card'));
    await waitFor(() => {
      expect(screen.getByTestId('emergency-screen')).toBeTruthy();
    });

    expect(screen.queryByTestId('header-emergency')).toBeNull();
  });

  it('reaches registration and password recovery', async () => {
    await renderApp();
    await waitFor(() => {
      expect(screen.getByTestId('welcome-register')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('welcome-register'));
    await waitFor(() => {
      expect(screen.getByTestId('register-screen')).toBeTruthy();
    });
  });
});

describe('the authentication gate', () => {
  it('shows the signed-in shell after a successful restore', async () => {
    await renderApp({ storedRefreshToken: 'refresh-1' });

    await waitFor(() => {
      expect(screen.getByTestId('home-screen')).toBeTruthy();
    });
  });

  it('falls back to the auth stack when the stored token is rejected', async () => {
    const authService = stubAuthService({
      refresh: jest.fn(() =>
        Promise.reject(Object.assign(new Error('x'), { kind: 'auth', code: 'unauthorized' })),
      ),
    });
    await renderApp({ authService, storedRefreshToken: 'stale' });

    await waitFor(() => {
      expect(screen.getByTestId('welcome-screen')).toBeTruthy();
    });
  });

  it('keeps Emergency on the header of the signed-in shell', async () => {
    await renderApp({ storedRefreshToken: 'refresh-1' });

    await waitFor(() => {
      expect(screen.getByTestId('header-emergency')).toBeTruthy();
    });
  });

  it('reaches Emergency in one tap from Home', async () => {
    await renderApp({ storedRefreshToken: 'refresh-1' });
    await waitFor(() => {
      expect(screen.getByTestId('home-emergency-card')).toBeTruthy();
    });

    fireEvent.press(screen.getByTestId('home-emergency-card'));
    await waitFor(() => {
      expect(screen.getByTestId('emergency-screen')).toBeTruthy();
    });
  });
});

describe('the deep-link table', () => {
  it('routes emergency at the root, so it resolves in either stack', () => {
    const screens = linking.config?.screens as Record<string, unknown>;
    expect(screens.Emergency).toBe('emergency');
  });

  it('uses the medora scheme', () => {
    expect(linking.prefixes).toEqual(['medora://']);
  });

  it('carries only ids in its paths — never a name or a value (O-05)', () => {
    const serialised = JSON.stringify(linking.config);
    // Every parameter is an :id-shaped segment.
    const parameters = serialised.match(/:[A-Za-z]+/g) ?? [];
    for (const parameter of parameters) {
      expect(parameter).toMatch(/Id$/);
    }
  });
});

describe('signed out, there is no discovery or booking (PA-1, DR-09)', () => {
  beforeEach(markOnboardingSeen);

  // DR-09: discovery requires sign-in. Signed out, the stack holds the
  // sign-in, registration and recovery screens, and Emergency — nothing
  // that browses doctors, clinics or slots, and nothing that books.
  const DISCOVERY_OR_BOOKING = [
    'Tabs',
    'Booking',
    'DiscoverTab',
    'DiscoverRoot',
    'DoctorProfile',
    'Clinic',
    'Department',
  ];

  it('declares none of those routes in the signed-out stack', async () => {
    const navigationRef = createNavigationContainerRef<RootStackParamList>();
    await renderApp({ navigationRef });
    await waitFor(() => expect(screen.getByTestId('welcome-screen')).toBeTruthy());

    const routeNames: readonly string[] = navigationRef.getRootState()?.routeNames ?? [];
    expect(routeNames).toEqual(
      expect.arrayContaining(['Welcome', 'Login', 'Register', 'ResetPassword', 'Emergency']),
    );
    for (const name of DISCOVERY_OR_BOOKING) {
      expect(routeNames).not.toContain(name);
    }
  });

  it.each([
    ['medora://doctors'],
    ['medora://doctors/doc-1'],
    ['medora://book'],
    ['medora://clinic'],
  ])('does not open %s while signed out', async (url) => {
    jest.spyOn(Linking, 'getInitialURL').mockResolvedValueOnce(url);
    await renderApp();

    await waitFor(() => expect(screen.getByTestId('welcome-screen')).toBeTruthy());
    expect(screen.queryByTestId('discover-search')).toBeNull();
    expect(screen.queryByTestId('booking-flow')).toBeNull();
  });
});

describe('the reset-password link (J-2)', () => {
  beforeEach(markOnboardingSeen);
  afterEach(() => jest.restoreAllMocks());

  it('opens the reset form with the token filled in, and submits nothing', async () => {
    jest
      .spyOn(Linking, 'getInitialURL')
      .mockResolvedValueOnce('medora://reset-password?token=RESET-abc_123');
    const authService = stubAuthService();
    await renderApp({ authService });

    await waitFor(() => expect(screen.getByTestId('reset-password-screen')).toBeTruthy());
    expect(screen.getByTestId('reset-token').props.value).toBe('RESET-abc_123');
    expect(authService.resetPassword).not.toHaveBeenCalled();
  });

  it('is ignored while signed in: the patient stays where they were', async () => {
    jest
      .spyOn(Linking, 'getInitialURL')
      .mockResolvedValueOnce('medora://reset-password?token=RESET-abc');
    const authService = stubAuthService();
    await renderApp({ authService, storedRefreshToken: 'refresh-1' });

    await waitFor(() => expect(screen.getByTestId('home-screen')).toBeTruthy());
    expect(screen.queryByTestId('reset-password-screen')).toBeNull();
    expect(authService.resetPassword).not.toHaveBeenCalled();
  });

  it('declares no verify-email link: no screen here consumes that token', () => {
    const screens = linking.config?.screens as Record<string, unknown>;
    expect(screens.ResetPassword).toBe('reset-password');
    expect(JSON.stringify(linking.config)).not.toContain('verify-email');
  });
});
