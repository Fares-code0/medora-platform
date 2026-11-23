import { act, fireEvent, waitFor } from '@testing-library/react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { AppState, Text, type AppStateStatus } from 'react-native';

import { apiClient } from '@/api/client';
import { normalizeNetworkError } from '@/api/errors';
import { PREFERENCE_KEYS, preferenceStore } from '@/storage/preference-store';
import { createInMemorySecureStore } from '@/storage/secure-store';
import { renderWithProviders } from '@/test/render';

import {
  expoBiometricGate,
  isBiometricUnlockEnabled,
  setBiometricUnlockEnabled,
  shouldLockOnForeground,
  type BiometricGate,
  type BiometricOutcome,
} from './biometrics';
import { BiometricLockGate } from './components/BiometricLockGate';
import { BiometricUnlockSetting } from './components/BiometricUnlockSetting';
import type { SessionLockPolicy } from './lock-policy';
import type { AuthService, SignInResult } from './model/types';
import { SessionProvider, useSession } from './SessionProvider';
import { createTokenStorage } from './storage';

/**
 * D-15 — biometric app-unlock.
 *
 * Three claims are worth more than the rest and each has a test that
 * fails loudly if it stops holding:
 *
 * 1. It is **opt-in**. A patient who never opens Security is never
 *    locked out of anything.
 * 2. A **password path always remains**. Every failure mode reaches a
 *    control that ends the session and returns to Login, because a
 *    patient with a cut finger must never be one broken sensor away
 *    from an uninstall.
 * 3. It gates the **app**, not the token — so the lock is persisted only
 *    as a non-identifying guard beside the token, and the lock screen
 *    names nobody.
 */

/** A gate a test drives, in place of a sensor Jest cannot have. */
function stubGate(overrides: Partial<BiometricGate> = {}): BiometricGate {
  return {
    check: jest.fn(() => Promise.resolve({ usable: true, label: 'Face ID' as const })),
    authenticate: jest.fn(() => Promise.resolve('success' as BiometricOutcome)),
    ...overrides,
  };
}

beforeEach(() => {
  preferenceStore.remove(PREFERENCE_KEYS.biometricUnlock);
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  preferenceStore.remove(PREFERENCE_KEYS.biometricUnlock);
  apiClient.setAccessToken(null);
  jest.restoreAllMocks();
});

describe('the opt-in', () => {
  it('is off until the patient turns it on', () => {
    expect(isBiometricUnlockEnabled()).toBe(false);
  });

  it('reads back what was written', () => {
    setBiometricUnlockEnabled(true);
    expect(isBiometricUnlockEnabled()).toBe(true);
    setBiometricUnlockEnabled(false);
    expect(isBiometricUnlockEnabled()).toBe(false);
  });

  it('stores a boolean and nothing else', () => {
    setBiometricUnlockEnabled(true);
    // The lock itself is never a preference: a stored lock must not
    // remember who is locked out of it, and `storage.ts` refuses that.
    // What survives the process is the keychain's non-identifying guard.
    expect(preferenceStore.get(PREFERENCE_KEYS.biometricUnlock)).toBe('true');
    expect(preferenceStore.keys()).not.toContain('medora.biometric-locked');
  });
});

describe('when the lock is raised', () => {
  it('locks on the PHI-sweep return, which is the window it exists for', () => {
    expect(shouldLockOnForeground('sweep-phi', true)).toBe(true);
  });

  it('does not lock a patient who never opted in', () => {
    expect(shouldLockOnForeground('sweep-phi', false)).toBe(false);
  });

  it('does not lock a glance at a notification', () => {
    // The behaviour that makes people turn the feature off.
    expect(shouldLockOnForeground('none', true)).toBe(false);
  });

  it('does not lock in front of the login screen', () => {
    // Past the second threshold the session has already ended. Asking
    // for a fingerprint to reach a password field protects nothing.
    expect(shouldLockOnForeground('reauthenticate', true)).toBe(false);
  });
});

describe('the Expo adapter', () => {
  const sdk = LocalAuthentication as jest.Mocked<typeof LocalAuthentication>;

  it('reports unusable when there is hardware but nothing enrolled', async () => {
    sdk.hasHardwareAsync.mockResolvedValueOnce(true);
    sdk.isEnrolledAsync.mockResolvedValueOnce(false);

    await expect(expoBiometricGate.check()).resolves.toEqual({ usable: false, label: null });
  });

  it('names Face ID when the device does faces', async () => {
    sdk.hasHardwareAsync.mockResolvedValueOnce(true);
    sdk.isEnrolledAsync.mockResolvedValueOnce(true);
    sdk.supportedAuthenticationTypesAsync.mockResolvedValueOnce([
      LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION,
    ]);

    await expect(expoBiometricGate.check()).resolves.toEqual({ usable: true, label: 'Face ID' });
  });

  it('treats a module that throws as a device without the feature', async () => {
    sdk.hasHardwareAsync.mockRejectedValueOnce(new Error('no such module'));

    await expect(expoBiometricGate.check()).resolves.toEqual({ usable: false, label: null });
  });

  it('separates a cancellation from a rejection', async () => {
    sdk.authenticateAsync.mockResolvedValueOnce({ success: false, error: 'user_cancel' });
    await expect(expoBiometricGate.authenticate('x')).resolves.toBe('cancelled');

    sdk.authenticateAsync.mockResolvedValueOnce({ success: false, error: 'authentication_failed' });
    await expect(expoBiometricGate.authenticate('x')).resolves.toBe('failed');
  });

  // A retry can never succeed on these, so the lock screen must drop its
  // retry button and point at the password path instead.
  it.each(['not_enrolled', 'not_available', 'passcode_not_set'] as const)(
    'reports %s as unavailable, not as a failed attempt',
    async (error) => {
      sdk.authenticateAsync.mockResolvedValueOnce({ success: false, error });
      await expect(expoBiometricGate.authenticate('x')).resolves.toBe('unavailable');
    },
  );

  it('keeps a lockout as a failed attempt, and never unlocks on anything but success', async () => {
    sdk.authenticateAsync.mockResolvedValueOnce({ success: false, error: 'lockout' });
    await expect(expoBiometricGate.authenticate('x')).resolves.toBe('failed');

    sdk.authenticateAsync.mockResolvedValueOnce({ success: false, error: 'unknown' });
    await expect(expoBiometricGate.authenticate('x')).resolves.toBe('failed');
  });

  it('never offers the device passcode as a fallback', async () => {
    // The OS passcode unlocks the phone, and the phone is already
    // unlocked — offering it would let exactly the person this gate
    // exists to stop walk straight through it.
    sdk.authenticateAsync.mockResolvedValueOnce({ success: true });
    await expoBiometricGate.authenticate('Unlock Medora');

    expect(sdk.authenticateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ disableDeviceFallback: true }),
    );
  });

  it('hands the OS sheet the prompt and cancel label it was given, English by default', async () => {
    sdk.authenticateAsync.mockResolvedValueOnce({ success: true });
    await expoBiometricGate.authenticate('Unlock Medora');
    expect(sdk.authenticateAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ promptMessage: 'Unlock Medora', cancelLabel: 'Cancel' }),
    );

    sdk.authenticateAsync.mockResolvedValueOnce({ success: true });
    await expoBiometricGate.authenticate('افتح قفل ميدورا', 'إلغاء');
    expect(sdk.authenticateAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ promptMessage: 'افتح قفل ميدورا', cancelLabel: 'إلغاء' }),
    );
  });
});

describe('the setting on the Security screen', () => {
  it('shows nothing on a device that cannot do it', async () => {
    const check = jest.fn(() => Promise.resolve({ usable: false, label: null }));
    const { queryByTestId } = renderWithProviders(
      <BiometricUnlockSetting gate={stubGate({ check })} />,
    );

    await waitFor(() => expect(check).toHaveBeenCalled());
    expect(queryByTestId('biometric-unlock-toggle')).toBeNull();
  });

  it('offers the toggle, off, and names what the device actually has', async () => {
    const { getByTestId } = renderWithProviders(<BiometricUnlockSetting gate={stubGate()} />);

    const toggle = await waitFor(() => getByTestId('biometric-unlock-toggle'));
    // "Unlock with Face ID", not "Unlock with biometrics": the label
    // says the thing the patient will be shown by the OS.
    expect(toggle.props.accessibilityLabel).toBe('Unlock with Face ID');
    expect(toggle.props.accessibilityRole).toBe('checkbox');
    expect(isBiometricUnlockEnabled()).toBe(false);
  });

  it('names a fingerprint sensor in Arabic, and keeps "Face ID" as Apple names it', async () => {
    const fingerprint = jest.fn(() =>
      Promise.resolve({ usable: true, label: 'Fingerprint' as const }),
    );
    const arabic = renderWithProviders(
      <BiometricUnlockSetting gate={stubGate({ check: fingerprint })} />,
      { locale: 'ar' },
    );
    const toggle = await waitFor(() => arabic.getByTestId('biometric-unlock-toggle'));
    expect(toggle.props.accessibilityLabel).toBe('فتح القفل بواسطة \u2068بصمة الإصبع\u2069');
    arabic.unmount();

    const english = renderWithProviders(
      <BiometricUnlockSetting gate={stubGate({ check: fingerprint })} />,
    );
    const englishToggle = await waitFor(() => english.getByTestId('biometric-unlock-toggle'));
    expect(englishToggle.props.accessibilityLabel).toBe('Unlock with Fingerprint');
    english.unmount();

    const faceId = renderWithProviders(<BiometricUnlockSetting gate={stubGate()} />, {
      locale: 'ar',
    });
    const faceToggle = await waitFor(() => faceId.getByTestId('biometric-unlock-toggle'));
    expect(faceToggle.props.accessibilityLabel).toBe('فتح القفل بواسطة \u2068Face ID\u2069');
  });

  it('persists the choice', async () => {
    const { getByTestId } = renderWithProviders(<BiometricUnlockSetting gate={stubGate()} />);

    const toggle = await waitFor(() => getByTestId('biometric-unlock-toggle'));
    fireEvent.press(toggle);

    expect(isBiometricUnlockEnabled()).toBe(true);
  });

  it('says what it does not do, not only what it does', async () => {
    const { getByText } = renderWithProviders(<BiometricUnlockSetting gate={stubGate()} />);

    await waitFor(() =>
      expect(
        getByText(/does not encrypt anything, and it does not replace signing out/),
      ).toBeTruthy(),
    );
  });
});

/** Exposes the session status, so a test can wait for the restore. */
function StatusProbe() {
  const { state } = useSession();
  return <Text testID="session-status">{state.status}</Text>;
}

describe('the lock screen, over a real backgrounding', () => {
  const POLICY: SessionLockPolicy = {
    phiSweepAfterMs: 5 * 60_000,
    reauthenticateAfterMs: 15 * 60_000,
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

  /** Installed after the session settles: `waitFor` polls a real clock. */
  function freezeClock() {
    let now = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    return (deltaMs: number) => {
      now += deltaMs;
    };
  }

  async function backgroundedApp(
    gate: BiometricGate,
    options: {
      readonly enabled?: boolean;
      readonly awayMs?: number;
      readonly locale?: 'en' | 'ar';
    } = {},
  ) {
    const emit = captureAppState();
    const logout = jest.fn(() => Promise.resolve());
    const storage = createTokenStorage(createInMemorySecureStore());
    await storage.writeRefreshToken('refresh-1');

    const view = renderWithProviders(
      <SessionProvider
        authService={
          {
            refresh: jest.fn(() => Promise.resolve(SIGNED_IN)),
            logout,
          } as unknown as AuthService
        }
        tokenStorage={storage}
        lockPolicy={POLICY}
        isBiometricUnlockEnabled={() => options.enabled ?? true}
      >
        <StatusProbe />
        <BiometricLockGate gate={gate}>
          <Text testID="navigator">records</Text>
        </BiometricLockGate>
      </SessionProvider>,
      { locale: options.locale ?? 'en' },
    );

    // The foreground handler ignores an absence while the status is
    // still `booting`, so the restore has to have landed before the
    // backgrounding is emitted — otherwise this tests nothing.
    await waitFor(() =>
      expect(view.getByTestId('session-status').props.children).toBe('authenticated'),
    );

    const advance = freezeClock();
    await act(async () => {
      emit('background');
      advance(options.awayMs ?? 6 * 60_000);
      emit('active');
    });

    return { ...view, logout, storage };
  }

  it('replaces the navigator rather than covering it', async () => {
    // An overlay leaves the records screen mounted, and the OS
    // photographs what is mounted on the way to the task switcher —
    // the same reason `PhiPrivacyShield` exists (T-09).
    const view = await backgroundedApp(stubGate({ authenticate: () => new Promise(() => {}) }));

    expect(view.getByTestId('biometric-lock-screen')).toBeTruthy();
    expect(view.queryByTestId('navigator')).toBeNull();
  });

  // A request still in flight across the backgrounding comes back 401 —
  // the access token expired while the phone was away — and the transport
  // refreshes. Refreshing renews the tokens; it is not the patient proving
  // who they are, so it must not take the lock down.
  it('stays up when a request refreshes the session behind it', async () => {
    const view = await backgroundedApp(stubGate({ authenticate: () => new Promise(() => {}) }));
    expect(view.getByTestId('biometric-lock-screen')).toBeTruthy();
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: 'Unauthorized', code: 'unauthorized' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: { ok: true } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    await act(async () => {
      await expect(apiClient.get('me/appointments')).resolves.toEqual({ data: { ok: true } });
    });

    expect(view.getByTestId('biometric-lock-screen')).toBeTruthy();
    expect(view.queryByTestId('navigator')).toBeNull();
  });

  it('does not raise for a patient who never opted in', async () => {
    const view = await backgroundedApp(stubGate(), { enabled: false });

    expect(view.queryByTestId('biometric-lock-screen')).toBeNull();
    expect(view.getByTestId('navigator')).toBeTruthy();
  });

  it('does not raise for a short absence', async () => {
    const view = await backgroundedApp(stubGate(), { awayMs: 60_000 });

    expect(view.queryByTestId('biometric-lock-screen')).toBeNull();
  });

  it('prompts on its own, and returns the navigator on success', async () => {
    const gate = stubGate();
    const view = await backgroundedApp(gate);

    // Prompted without the patient pressing anything: someone returning
    // to a locked app expects the sensor, not a button that summons it.
    // The OS sheet's prompt and cancel button are this app's words.
    expect(gate.authenticate).toHaveBeenCalledWith('Unlock Medora', 'Cancel');
    await waitFor(() => expect(view.getByTestId('navigator')).toBeTruthy());
    expect(view.queryByTestId('biometric-lock-screen')).toBeNull();
  });

  it('prompts in Arabic when the app is in Arabic (C-09)', async () => {
    const gate = stubGate();
    await backgroundedApp(gate, { locale: 'ar' });

    expect(gate.authenticate).toHaveBeenCalledWith('افتح قفل ميدورا', 'إلغاء');
  });

  it('names nobody', async () => {
    // A lock screen that greets the patient by name is a patient
    // identifier readable by whoever is holding the phone — which is
    // the person this screen exists to stop.
    const view = await backgroundedApp(stubGate({ authenticate: () => new Promise(() => {}) }));

    expect(view.queryByText(/Sara/)).toBeNull();
    expect(view.queryByText(/sara@example.com/)).toBeNull();
    expect(view.getByText('Medora is locked')).toBeTruthy();
  });

  it('keeps the password path after a rejection, and offers another attempt', async () => {
    const gate = stubGate({ authenticate: jest.fn(() => Promise.resolve('failed' as const)) });
    const view = await backgroundedApp(gate);

    await waitFor(() => expect(view.getByText(/That was not recognised/)).toBeTruthy());
    expect(view.getByTestId('biometric-unlock')).toBeTruthy();
    expect(view.getByTestId('biometric-use-password')).toBeTruthy();
  });

  it('drops the retry button when the sensor cannot answer at all', async () => {
    // The lock-out this feature must not create: a patient who enrolled
    // a fingerprint, turned the setting on, then removed it in the OS.
    const gate = stubGate({ authenticate: jest.fn(() => Promise.resolve('unavailable' as const)) });
    const view = await backgroundedApp(gate);

    await waitFor(() => expect(view.getByText(/Sign in with your password/)).toBeTruthy());
    expect(view.queryByTestId('biometric-unlock')).toBeNull();
    expect(view.getByTestId('biometric-use-password')).toBeTruthy();
  });

  /**
   * The bypass: the absence ends while the session is still `unconfirmed`
   * (no signal at launch), so there is nothing to lock yet — and the
   * restore that lands afterwards used to open the app unprompted.
   */
  async function unconfirmedThenAway(
    gate: BiometricGate,
    options: { readonly enabled?: boolean; readonly awayMs: number },
  ) {
    const emit = captureAppState();
    const storage = createTokenStorage(createInMemorySecureStore());
    await storage.writeRefreshToken('refresh-1');
    const refresh = jest
      .fn<Promise<SignInResult>, [string]>()
      .mockRejectedValueOnce(normalizeNetworkError())
      .mockResolvedValue(SIGNED_IN);
    let session: ReturnType<typeof useSession> | null = null;
    function Capture() {
      session = useSession();
      return null;
    }

    const view = renderWithProviders(
      <SessionProvider
        authService={{ refresh, logout: jest.fn() } as unknown as AuthService}
        tokenStorage={storage}
        lockPolicy={POLICY}
        isBiometricUnlockEnabled={() => options.enabled ?? true}
      >
        <Capture />
        <StatusProbe />
        <BiometricLockGate gate={gate}>
          <Text testID="navigator">records</Text>
        </BiometricLockGate>
      </SessionProvider>,
    );
    await waitFor(() =>
      expect(view.getByTestId('session-status').props.children).toBe('unconfirmed'),
    );

    const advance = freezeClock();
    await act(async () => {
      emit('background');
      advance(options.awayMs);
      emit('active');
    });
    await act(async () => {
      await (session as unknown as ReturnType<typeof useSession>).retryRestore();
    });
    // No `waitFor` past this point: the clock is frozen.
    expect(view.getByTestId('session-status').props.children).toBe('authenticated');
    return view;
  }

  it('raises the lock when a restore lands after a long absence spent unconfirmed', async () => {
    const view = await unconfirmedThenAway(
      stubGate({ authenticate: () => new Promise(() => {}) }),
      { awayMs: 6 * 60_000 },
    );

    expect(view.getByTestId('biometric-lock-screen')).toBeTruthy();
    expect(view.queryByTestId('navigator')).toBeNull();
  });

  it('does not raise it after a short absence spent unconfirmed', async () => {
    const view = await unconfirmedThenAway(stubGate(), { awayMs: 60_000 });

    expect(view.queryByTestId('biometric-lock-screen')).toBeNull();
    expect(view.getByTestId('navigator')).toBeTruthy();
  });

  it('does not raise it for a patient who never opted in', async () => {
    const view = await unconfirmedThenAway(stubGate(), { enabled: false, awayMs: 6 * 60_000 });

    expect(view.queryByTestId('biometric-lock-screen')).toBeNull();
  });

  it('ends the session when the patient chooses the password path', async () => {
    const gate = stubGate({ authenticate: jest.fn(() => Promise.resolve('cancelled' as const)) });
    const view = await backgroundedApp(gate);

    await waitFor(() => expect(view.getByTestId('biometric-use-password')).toBeTruthy());
    await act(async () => {
      fireEvent.press(view.getByTestId('biometric-use-password'));
    });

    // Not a bypass: the same `logout()` the profile screen calls, so
    // the keychain goes with it.
    expect(view.logout).toHaveBeenCalled();
    await waitFor(() => expect(view.storage.readRefreshToken()).resolves.toBeNull());
    expect(view.queryByTestId('biometric-lock-screen')).toBeNull();
  });
});
