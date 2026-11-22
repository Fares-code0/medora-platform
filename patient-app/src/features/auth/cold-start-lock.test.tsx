import NetInfo from '@react-native-community/netinfo';
import { NavigationContainer } from '@react-navigation/native';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';
import type * as ReactNative from 'react-native';

import { apiClient } from '@/api/client';
import { normalizeNetworkError } from '@/api/errors';
import { RootNavigator } from '@/navigation/RootNavigator';
import { NetworkProvider } from '@/network/NetworkProvider';
import type { SecureStore } from '@/storage/ports';
import { renderWithProviders } from '@/test/render';

import type { BiometricGate, BiometricOutcome } from './biometrics';
import { BiometricLockGate } from './components/BiometricLockGate';
import type { SessionLockPolicy } from './lock-policy';
import type { AuthService, SignInResult } from './model/types';
import { SESSION_GUARD_KEY, encodeSessionGuard, type SessionGuardRecord } from './session-guard';
import { SessionProvider, useSession } from './SessionProvider';
import { createTokenStorage } from './storage';

/**
 * The session guard through the real `SessionProvider` (D-15 / T-11 at
 * cold start).
 *
 * A "device" outlives the processes mounted on it: its map is the
 * keychain. `kill()` models process death honestly — a write still in
 * flight when the process dies never lands, which a plain `unmount()`
 * over an in-memory store cannot show (the queue keeps running).
 */

// The signed-in app, for the one test that mounts the real navigator.
jest.mock('@/navigation/AppTabs', () => {
  const { Text: MarkerText } = jest.requireActual<typeof ReactNative>('react-native');
  return { AppTabs: () => <MarkerText testID="app-tabs">signed in</MarkerText> };
});

const TOKEN_KEY = 'medora.refresh-token';
const MIN = 60_000;
const POLICY: SessionLockPolicy = { phiSweepAfterMs: 5 * MIN, reauthenticateAfterMs: 15 * MIN };

const SIGNED_IN: SignInResult = {
  tokens: { accessToken: 'access-1', refreshToken: 'refresh-2' },
  identity: {
    subjectId: 'subject-1',
    displayName: 'Sara Ahmed',
    email: 'sara@example.com',
    emailVerified: true,
  },
};

const SOMEONE_ELSE: SignInResult = {
  tokens: { accessToken: 'access-9', refreshToken: 'refresh-9' },
  identity: {
    subjectId: 'subject-9',
    displayName: 'Omar Hassan',
    email: 'omar@example.com',
    emailVerified: true,
  },
};

// ── The clock ────────────────────────────────────────────────────────
// An offset over the real clock rather than a frozen one, so `waitFor`
// still times out if an expectation never holds.
let offset = 0;
const advance = (ms: number) => {
  offset += ms;
};

beforeEach(() => {
  offset = 0;
  const realNow = Date.now.bind(Date);
  jest.spyOn(Date, 'now').mockImplementation(() => realNow() + offset);
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  apiClient.setAccessToken(null);
  jest.restoreAllMocks();
});

// ── The device ───────────────────────────────────────────────────────
function createDevice(seed: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(seed));
  const failGet = new Set<string>();
  const failGetOnce = new Set<string>();
  const failRemove = new Set<string>();
  const guardWrites: string[] = [];
  let guardReads = 0;
  let held: Promise<void> | null = null;

  return {
    map,
    failGet,
    failGetOnce,
    failRemove,
    guardWrites,
    guardReads: () => guardReads,
    guard(): unknown {
      const raw = map.get(SESSION_GUARD_KEY);
      return raw === undefined ? undefined : (JSON.parse(raw) as unknown);
    },
    /** Every keychain write waits until the returned function is called. */
    holdWrites(): () => void {
      let release: () => void = () => undefined;
      held = new Promise<void>((resolve) => {
        release = resolve;
      });
      return () => {
        held = null;
        release();
      };
    },
    /** A process: a view of the keychain that stops writing when it dies. */
    boot() {
      let dead = false;
      const land = async (apply: () => void) => {
        await Promise.resolve();
        if (held) await held;
        if (!dead) apply();
      };
      const store: SecureStore = {
        async getItem(key) {
          if (key === SESSION_GUARD_KEY) guardReads += 1;
          if (failGet.has(key)) throw new Error('keychain unavailable');
          if (failGetOnce.delete(key)) throw new Error('keychain busy');
          return map.get(key) ?? null;
        },
        async setItem(key, value) {
          await land(() => {
            map.set(key, value);
            if (key === SESSION_GUARD_KEY) guardWrites.push(value);
          });
        },
        async removeItem(key) {
          if (failRemove.has(key)) throw new Error('keychain unavailable');
          await land(() => map.delete(key));
        },
      };
      return {
        storage: createTokenStorage(store),
        kill: () => {
          dead = true;
        },
      };
    },
  };
}
type Device = ReturnType<typeof createDevice>;

const seeded = (guard?: SessionGuardRecord | string) =>
  createDevice({
    [TOKEN_KEY]: 'refresh-1',
    ...(guard === undefined
      ? {}
      : { [SESSION_GUARD_KEY]: typeof guard === 'string' ? guard : encodeSessionGuard(guard) }),
  });

// ── The app ──────────────────────────────────────────────────────────
/** `AppState` whose `remove()` really removes. */
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

/** A sensor that never answers unless the test says so. */
function pendingGate(): BiometricGate & { answer: (outcome: BiometricOutcome) => void } {
  let answer: (outcome: BiometricOutcome) => void = () => undefined;
  return {
    check: () => Promise.resolve({ usable: true, label: 'Face ID' as const }),
    authenticate: jest.fn(
      () =>
        new Promise<BiometricOutcome>((resolve) => {
          answer = resolve;
        }),
    ),
    answer: (outcome) => answer(outcome),
  };
}

const flush = () =>
  act(async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  });

function launch(
  device: Device,
  options: {
    readonly refresh?: jest.Mock;
    readonly optIn?: boolean;
    readonly gate?: BiometricGate;
    readonly signIn?: SignInResult;
  } = {},
) {
  const proc = device.boot();
  const refresh = options.refresh ?? jest.fn(() => Promise.resolve(SIGNED_IN));
  const authService = {
    refresh,
    logout: jest.fn(() => Promise.resolve()),
    login: jest.fn(() =>
      Promise.resolve({ kind: 'authenticated', result: options.signIn ?? SIGNED_IN } as const),
    ),
  } as unknown as AuthService & { logout: jest.Mock; login: jest.Mock };
  // The protected app: what `RootNavigator` renders once signed in. Its
  // render count while authenticated is the proof that no unlocked frame
  // of it was ever committed.
  const navigatorRenders = jest.fn();
  function Navigator() {
    const { state } = useSession();
    if (state.status !== 'authenticated') return null;
    navigatorRenders();
    return <Text testID="navigator">records</Text>;
  }
  let session: ReturnType<typeof useSession> | null = null;
  function Probe() {
    session = useSession();
    const { state } = session;
    return (
      <Text testID="status">
        {state.status === 'unauthenticated'
          ? `unauthenticated:${state.reason ?? ''}`
          : state.status}
      </Text>
    );
  }
  const view = renderWithProviders(
    <SessionProvider
      authService={authService}
      tokenStorage={proc.storage}
      lockPolicy={POLICY}
      isBiometricUnlockEnabled={() => options.optIn ?? true}
    >
      <Probe />
      <BiometricLockGate gate={options.gate ?? pendingGate()}>
        <Navigator />
      </BiometricLockGate>
    </SessionProvider>,
  );
  return {
    ...view,
    refresh,
    authService,
    navigatorRenders,
    status: () => String(view.getByTestId('status').props.children),
    session: () => {
      if (session === null) throw new Error('no session captured');
      return session;
    },
    /** Process death: in-flight writes are lost, memory is gone. */
    kill: () => {
      proc.kill();
      apiClient.setAccessToken(null);
      view.unmount();
    },
  };
}

async function settled(app: ReturnType<typeof launch>, status: string) {
  await waitFor(() => expect(app.status()).toBe(status));
  await flush();
}

// ── The scenarios ────────────────────────────────────────────────────

describe('a cold start reads the session guard first', () => {
  it('1. restores a normal cold start, unlocked, and records the foreground', async () => {
    const device = seeded({ v: 1, s: 'fg', lock: false });
    const app = launch(device);

    await settled(app, 'authenticated');
    expect(app.getByTestId('navigator')).toBeTruthy();
    expect(app.refresh).toHaveBeenCalledTimes(1);
    expect(device.guard()).toEqual({ v: 1, s: 'fg', lock: false });
  });

  it('2. comes back locked after a force-quit while the lock was up, without rendering the app', async () => {
    const emit = captureAppState();
    const device = seeded({ v: 1, s: 'fg', lock: false });
    const first = launch(device);
    await settled(first, 'authenticated');
    await act(async () => {
      emit('background');
      advance(6 * MIN);
      emit('active');
    });
    await flush();
    expect(first.getByTestId('biometric-lock-screen')).toBeTruthy();
    expect(device.guard()).toEqual({ v: 1, s: 'fg', lock: true });
    // Swiped away from the switcher with the lock still up.
    await act(async () => {
      emit('inactive');
    });
    await flush();
    first.kill();

    const second = launch(device);
    await settled(second, 'authenticated');
    expect(second.getByTestId('biometric-lock-screen')).toBeTruthy();
    expect(second.navigatorRenders).not.toHaveBeenCalled();
    expect(second.refresh).toHaveBeenCalledTimes(1);
  });

  it('2b. still comes back locked when the departure write was lost to the kill', async () => {
    const emit = captureAppState();
    const device = seeded({ v: 1, s: 'fg', lock: true });
    const first = launch(device);
    await settled(first, 'authenticated');
    expect(first.getByTestId('biometric-lock-screen')).toBeTruthy();
    const writes = device.guardWrites.length;
    act(() => emit('background'));
    first.kill(); // before the write could land
    expect(device.guardWrites).toHaveLength(writes);

    const second = launch(device);
    await settled(second, 'authenticated');
    expect(second.getByTestId('biometric-lock-screen')).toBeTruthy();
    expect(second.navigatorRenders).not.toHaveBeenCalled();
  });

  async function killedInBackground(device: Device, awayMs: number) {
    const emit = captureAppState();
    const first = launch(device);
    await settled(first, 'authenticated');
    act(() => emit('background'));
    await flush();
    first.kill();
    advance(awayMs);
  }

  it('3a. locks a restore after a kill in the background within the threshold, when opted in', async () => {
    const device = seeded({ v: 1, s: 'fg', lock: false });
    await killedInBackground(device, 8 * MIN);

    const second = launch(device, { optIn: true });
    await settled(second, 'authenticated');
    expect(second.getByTestId('biometric-lock-screen')).toBeTruthy();
    expect(second.navigatorRenders).not.toHaveBeenCalled();
    expect(device.guard()).toEqual({ v: 1, s: 'fg', lock: true });
  });

  it('3b. restores normally after the same kill when not opted in', async () => {
    const device = seeded({ v: 1, s: 'fg', lock: false });
    const emit = captureAppState();
    const first = launch(device, { optIn: false });
    await settled(first, 'authenticated');
    act(() => emit('background'));
    await flush();
    first.kill();
    advance(8 * MIN);

    const second = launch(device, { optIn: false });
    await settled(second, 'authenticated');
    expect(second.queryByTestId('biometric-lock-screen')).toBeNull();
    expect(second.getByTestId('navigator')).toBeTruthy();
  });

  it('3c. restores normally after a short absence, opted in', async () => {
    const device = seeded({ v: 1, s: 'fg', lock: false });
    await killedInBackground(device, 2 * MIN);

    const second = launch(device);
    await settled(second, 'authenticated');
    expect(second.queryByTestId('biometric-lock-screen')).toBeNull();
  });

  it('M2. still locks when the opt-in was lost with the preference store', async () => {
    const device = seeded({ v: 1, s: 'fg', lock: false });
    await killedInBackground(device, 8 * MIN); // opted in at background time

    const second = launch(device, { optIn: false }); // AsyncStorage wiped
    await settled(second, 'authenticated');
    expect(second.getByTestId('biometric-lock-screen')).toBeTruthy();
    expect(second.navigatorRenders).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    '4. ends the session after a kill past the threshold without sending the token (opt-in %s)',
    async (optIn) => {
      const device = seeded({ v: 1, s: 'fg', lock: false });
      const emit = captureAppState();
      const first = launch(device, { optIn });
      await settled(first, 'authenticated');
      act(() => emit('background'));
      await flush();
      first.kill();
      advance(2 * 60 * MIN);

      const second = launch(device, { optIn });
      await settled(second, 'unauthenticated:locked');
      expect(second.refresh).not.toHaveBeenCalled();
      expect(device.map.has(TOKEN_KEY)).toBe(false);
      expect(device.map.has(SESSION_GUARD_KEY)).toBe(false);

      // The way back is a password.
      await act(async () => {
        await second
          .session()
          .login({ email: 'sara@example.com', password: 'x', rememberMe: false });
      });
      expect(second.status()).toBe('authenticated');
      await flush();
      expect(device.guard()).toEqual({ v: 1, s: 'fg', lock: false });
      expect(second.refresh).not.toHaveBeenCalled();
    },
  );

  it('9. restores unlocked when there is no guard yet (first launch after the update)', async () => {
    const device = seeded();
    const app = launch(device);

    await settled(app, 'authenticated');
    expect(app.getByTestId('navigator')).toBeTruthy();
    expect(device.guard()).toEqual({ v: 1, s: 'fg', lock: false });
  });

  it('10. ends a session whose guard is corrupt, once, without a loop', async () => {
    const device = seeded('{"v":1,"s":"fg","lock":"yes"}');
    const second = launch(device);
    await settled(second, 'unauthenticated:session-expired');
    expect(second.refresh).not.toHaveBeenCalled();
    expect(device.map.size).toBe(0);
    second.kill();

    const third = launch(device);
    await settled(third, 'unauthenticated:');
    expect(third.refresh).not.toHaveBeenCalled();
  });

  it('14. ends a session whose departure is stamped in the future', async () => {
    const device = seeded({ v: 1, s: 'bg', at: Date.now() + 60 * MIN, lock: false, b: false });
    const app = launch(device);

    await settled(app, 'unauthenticated:session-expired');
    expect(app.refresh).not.toHaveBeenCalled();
    expect(device.map.has(TOKEN_KEY)).toBe(false);
  });

  it('15. finishes a teardown that left a tombstone beside the token', async () => {
    const device = seeded({ v: 1, s: 'ended' });
    const app = launch(device);

    await settled(app, 'unauthenticated:');
    expect(app.refresh).not.toHaveBeenCalled();
    expect(device.map.size).toBe(0);
  });

  it('11. lands signed out when the guard cannot be read, deleting nothing and retrying nothing', async () => {
    const device = seeded({ v: 1, s: 'bg', at: Date.now(), lock: true, b: true });
    device.failGet.add(SESSION_GUARD_KEY);
    const app = launch(device);

    await settled(app, 'unauthenticated:');
    // Time passes; nothing tries again on its own.
    await flush();
    await flush();
    expect(app.refresh).not.toHaveBeenCalled();
    expect(device.map.get(TOKEN_KEY)).toBe('refresh-1');
    expect(device.guardReads()).toBe(1);

    await act(async () => {
      await app.session().login({ email: 'sara@example.com', password: 'x', rememberMe: false });
    });
    await flush();
    expect(app.status()).toBe('authenticated');
    expect(device.guard()).toEqual({ v: 1, s: 'fg', lock: false });
  });

  it('H1. a token read that fails once applies the read-failure outcome, and the next launch still judges the guard', async () => {
    const device = seeded({ v: 1, s: 'bg', at: Date.now(), lock: true, b: true });
    device.failGetOnce.add(TOKEN_KEY);
    const first = launch(device);

    await settled(first, 'unauthenticated:');
    expect(first.refresh).not.toHaveBeenCalled();
    expect(first.navigatorRenders).not.toHaveBeenCalled();
    expect(device.map.get(TOKEN_KEY)).toBe('refresh-1');
    first.kill();

    const second = launch(device);
    await settled(second, 'authenticated');
    expect(second.getByTestId('biometric-lock-screen')).toBeTruthy();
    expect(second.navigatorRenders).not.toHaveBeenCalled();
  });
});

describe('the lock after a cold start', () => {
  it.each(['cancelled', 'failed'] as const)(
    '12. keeps the lock on %s, with the password path',
    async (outcome) => {
      const device = seeded({ v: 1, s: 'fg', lock: true });
      const gate: BiometricGate = {
        check: () => Promise.resolve({ usable: true, label: 'Face ID' as const }),
        authenticate: jest.fn(() => Promise.resolve(outcome)),
      };
      const app = launch(device, { gate });
      await settled(app, 'authenticated');

      expect(app.getByTestId('biometric-lock-screen')).toBeTruthy();
      expect(app.getByTestId('biometric-unlock')).toBeTruthy();
      expect(app.navigatorRenders).not.toHaveBeenCalled();
      expect(gate.authenticate).toHaveBeenCalledTimes(1);

      await act(async () => {
        fireEvent.press(app.getByTestId('biometric-use-password'));
      });
      await settled(app, 'unauthenticated:signed-out');
      expect(app.authService.logout).toHaveBeenCalled();
      expect(device.map.size).toBe(0);
      expect(app.navigatorRenders).not.toHaveBeenCalled();
    },
  );

  it('12b. offers only the password when the sensor cannot answer', async () => {
    const device = seeded({ v: 1, s: 'fg', lock: true });
    const app = launch(device, {
      gate: {
        check: () => Promise.resolve({ usable: false, label: null }),
        authenticate: jest.fn(() => Promise.resolve('unavailable' as const)),
      },
    });
    await settled(app, 'authenticated');

    expect(app.queryByTestId('biometric-unlock')).toBeNull();
    expect(app.getByTestId('biometric-use-password')).toBeTruthy();
  });

  it('keeps the lock through a restore that first gets no answer, then a retry', async () => {
    const device = seeded({ v: 1, s: 'fg', lock: true });
    const refresh = jest
      .fn<Promise<SignInResult>, [string]>()
      .mockRejectedValueOnce(normalizeNetworkError())
      .mockResolvedValue(SIGNED_IN);
    const app = launch(device, { refresh });
    await settled(app, 'unconfirmed');

    await act(async () => {
      await app.session().retryRestore();
    });
    await flush();
    expect(app.status()).toBe('authenticated');
    expect(app.getByTestId('biometric-lock-screen')).toBeTruthy();
    expect(app.navigatorRenders).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('judges a kill while unconfirmed on the next launch', async () => {
    const emit = captureAppState();
    const device = seeded({ v: 1, s: 'fg', lock: false });
    const first = launch(device, {
      refresh: jest.fn(() => Promise.reject(normalizeNetworkError())),
    });
    await settled(first, 'unconfirmed');
    act(() => emit('background'));
    await flush();
    first.kill();
    advance(8 * MIN);

    const second = launch(device);
    await settled(second, 'authenticated');
    expect(second.getByTestId('biometric-lock-screen')).toBeTruthy();
    expect(second.navigatorRenders).not.toHaveBeenCalled();
  });
});

describe('the warm path keeps the guard current', () => {
  it('5. records the lock on a return within the threshold, and its release on unlock', async () => {
    const emit = captureAppState();
    const device = seeded({ v: 1, s: 'fg', lock: false });
    const gate = pendingGate();
    const app = launch(device, { gate });
    await settled(app, 'authenticated');

    await act(async () => {
      emit('background');
      advance(8 * MIN);
      emit('active');
    });
    await flush();
    expect(app.getByTestId('biometric-lock-screen')).toBeTruthy();
    expect(device.guard()).toEqual({ v: 1, s: 'fg', lock: true });

    await act(async () => {
      gate.answer('success');
    });
    await flush();
    expect(app.getByTestId('navigator')).toBeTruthy();
    expect(device.guard()).toEqual({ v: 1, s: 'fg', lock: false });
  });

  it('5b. records a short return as an unlocked foreground', async () => {
    const emit = captureAppState();
    const device = seeded({ v: 1, s: 'fg', lock: false });
    const app = launch(device);
    await settled(app, 'authenticated');

    await act(async () => {
      emit('background');
      advance(2 * MIN);
      emit('active');
    });
    await flush();
    expect(app.queryByTestId('biometric-lock-screen')).toBeNull();
    expect(device.guard()).toEqual({ v: 1, s: 'fg', lock: false });
  });

  it('6. ends the session on a return past the threshold, guard and token gone', async () => {
    const emit = captureAppState();
    const device = seeded({ v: 1, s: 'fg', lock: false });
    const app = launch(device);
    await settled(app, 'authenticated');

    await act(async () => {
      emit('background');
      advance(2 * 60 * MIN);
      emit('active');
    });
    await settled(app, 'unauthenticated:locked');
    expect(device.map.size).toBe(0);
  });

  it('7. logout removes the guard and the token; the next launch is a plain login', async () => {
    const device = seeded({ v: 1, s: 'fg', lock: false });
    const app = launch(device);
    await settled(app, 'authenticated');

    await act(async () => {
      await app.session().logout();
    });
    await flush();
    expect(app.status()).toBe('unauthenticated:signed-out');
    expect(device.map.size).toBe(0);
    app.kill();

    const next = launch(device);
    await settled(next, 'unauthenticated:');
    expect(next.refresh).not.toHaveBeenCalled();
  });

  it('8. a different account signing in after the password path does not inherit the lock', async () => {
    const device = seeded({ v: 1, s: 'fg', lock: true });
    const app = launch(device, { signIn: SOMEONE_ELSE });
    await settled(app, 'authenticated');
    expect(app.getByTestId('biometric-lock-screen')).toBeTruthy();

    await act(async () => {
      fireEvent.press(app.getByTestId('biometric-use-password'));
    });
    await settled(app, 'unauthenticated:signed-out');
    await act(async () => {
      await app.session().login({ email: 'omar@example.com', password: 'x', rememberMe: false });
    });
    await flush();
    expect(device.guard()).toEqual({ v: 1, s: 'fg', lock: false });
    expect(device.map.get(TOKEN_KEY)).toBe('refresh-9');
    app.kill();

    const next = launch(device);
    await settled(next, 'authenticated');
    expect(next.queryByTestId('biometric-lock-screen')).toBeNull();
  });

  it('13. writes one departure per absence across repeated transitions, keeping the first leave time', async () => {
    const emit = captureAppState();
    const device = seeded({ v: 1, s: 'fg', lock: false });
    const app = launch(device);
    await settled(app, 'authenticated');
    const before = device.guardWrites.length;

    const beforeLeave = Date.now();
    await act(async () => {
      emit('inactive');
      advance(1_000);
      emit('background');
      advance(1_000);
      emit('inactive');
    });
    await flush();
    // The first departure's time, not the later ones (2 s were added after it).
    const departed = device.guard() as { at: number };
    expect(departed).toMatchObject({ v: 1, s: 'bg', lock: false, b: true });
    expect(departed.at - beforeLeave).toBeGreaterThanOrEqual(0);
    expect(departed.at - beforeLeave).toBeLessThan(1_000);

    await act(async () => {
      emit('active');
      emit('inactive');
      emit('active');
      emit('inactive');
      emit('background');
    });
    await flush();
    // bg, then (fg, bg) twice: one write per transition that matters.
    expect(device.guardWrites.length - before).toBe(5);
    expect(device.guard()).toMatchObject({ s: 'bg' });

    // Killed mid-sequence, past the threshold: the departure decides.
    app.kill();
    advance(2 * 60 * MIN);
    const next = launch(device);
    await settled(next, 'unauthenticated:locked');
    expect(next.refresh).not.toHaveBeenCalled();
  });

  it('R2 (accepted residual). a departure write lost to the kill leaves the last foreground record', async () => {
    const emit = captureAppState();
    const device = seeded({ v: 1, s: 'fg', lock: false });
    const first = launch(device);
    await settled(first, 'authenticated');
    act(() => emit('background'));
    first.kill(); // the write never landed
    advance(2 * 60 * MIN);
    expect(device.guard()).toEqual({ v: 1, s: 'fg', lock: false });

    // Documented, not desired: this launch restores (design R2).
    const second = launch(device);
    await settled(second, 'authenticated');
    expect(second.refresh).toHaveBeenCalledTimes(1);
  });
});

describe('races (M1, M3)', () => {
  it('M1. a write queued after a logout whose token removal failed does not overwrite the tombstone', async () => {
    const emit = captureAppState();
    const device = seeded({ v: 1, s: 'fg', lock: false });
    const app = launch(device);
    await settled(app, 'authenticated');
    device.failRemove.add(TOKEN_KEY);

    const release = device.holdWrites();
    let loggedOut: Promise<void> = Promise.resolve();
    await act(async () => {
      emit('background'); // queued, held in the keychain
      loggedOut = app.session().logout(); // its teardown queues behind
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
      emit('active'); // queued behind the teardown, under the old epoch
      emit('background');
    });
    await act(async () => {
      release();
      await loggedOut;
    });
    await flush();

    expect(app.status()).toBe('unauthenticated:signed-out');
    expect(device.map.get(TOKEN_KEY)).toBe('refresh-2'); // the rotated one, not removed
    expect(device.guard()).toEqual({ v: 1, s: 'ended' });
    app.kill();

    device.failRemove.clear();
    const next = launch(device);
    await settled(next, 'unauthenticated:');
    expect(next.refresh).not.toHaveBeenCalled();
    expect(device.map.size).toBe(0);
  });

  it('M1. a departure during boot does not replace a guard the launch could not read', async () => {
    const emit = captureAppState();
    const original = encodeSessionGuard({ v: 1, s: 'bg', at: Date.now(), lock: true, b: true });
    const device = seeded(original);
    device.failGet.add(SESSION_GUARD_KEY);
    const first = launch(device);
    act(() => emit('background')); // still booting: queued behind the verdict
    await settled(first, 'unauthenticated:');
    expect(device.map.get(SESSION_GUARD_KEY)).toBe(original);
    expect(first.refresh).not.toHaveBeenCalled();
    first.kill();

    const second = launch(device);
    await settled(second, 'unauthenticated:');
    expect(second.refresh).not.toHaveBeenCalled();
    second.kill();

    device.failGet.clear();
    const third = launch(device);
    await settled(third, 'authenticated');
    expect(third.getByTestId('biometric-lock-screen')).toBeTruthy();
  });

  it('16. a departure during boot keeps the owed lock in the record', async () => {
    const emit = captureAppState();
    const device = seeded({ v: 1, s: 'fg', lock: true });
    const first = launch(device);
    act(() => emit('background'));
    await settled(first, 'authenticated');
    expect(first.getByTestId('biometric-lock-screen')).toBeTruthy();
    expect(device.guard()).toMatchObject({ s: 'bg', lock: true });
  });

  /** NetInfo driven by hand, as in `session-restore.test.tsx`. */
  function captureNetInfo() {
    jest.spyOn(NetInfo, 'addEventListener').mockImplementation(() => () => undefined);
  }

  it('M3/17. a long absence while unconfirmed ends the session before the screen retry can send the token', async () => {
    const emit = captureAppState();
    captureNetInfo();
    const device = seeded({ v: 1, s: 'fg', lock: false });
    const proc = device.boot();
    const refresh = jest.fn(() => Promise.reject(normalizeNetworkError()));
    let status = '';
    function Probe() {
      const { state } = useSession();
      status =
        state.status === 'unauthenticated' ? `unauthenticated:${state.reason ?? ''}` : state.status;
      return null;
    }
    const view = renderWithProviders(
      <NetworkProvider>
        <SessionProvider
          authService={{ refresh, logout: jest.fn() } as unknown as AuthService}
          tokenStorage={proc.storage}
          lockPolicy={POLICY}
          isBiometricUnlockEnabled={() => true}
        >
          <Probe />
          <NavigationContainer>
            <RootNavigator />
          </NavigationContainer>
        </SessionProvider>
      </NetworkProvider>,
    );
    await waitFor(() => expect(view.getByTestId('session-unconfirmed-screen')).toBeTruthy());
    expect(refresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      emit('background');
      advance(2 * 60 * MIN);
      emit('active');
    });
    await flush();

    expect(status).toBe('unauthenticated:locked');
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(device.map.size).toBe(0);
    expect(view.queryByTestId('app-tabs')).toBeNull();
    view.unmount();
  });
});
