/**
 * Jest setup.
 *
 * The mocks below stand in for native modules that cannot run in
 * Node. Each one is a *fake of the platform*, never a fake of Medora's
 * own logic — the point of a unit test here is to exercise this app's
 * code, so anything mocked is something outside it.
 */

import { onlineManager } from '@tanstack/react-query';
import { AccessibilityInfo } from 'react-native';

// The keychain. `secure-store.ts` is the only module that imports this,
// and `storage.test.ts` asserts on what reaches it.
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    getItemAsync: jest.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    setItemAsync: jest.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
    deleteItemAsync: jest.fn((key: string) => {
      store.delete(key);
      return Promise.resolve();
    }),
  };
});

/**
 * Durable preferences (E-02, P-07).
 *
 * The library's own Jest mock, not a hand-rolled one: it is maintained
 * alongside the module and it is a fake of the *platform*, which is the
 * rule this file follows. `durable-preference-store.test.ts` passes its
 * own fake backend where it needs to control failure.
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Connectivity. Defaults to online; a test that cares drives the listener.
/**
 * Biometrics (D-15).
 *
 * A native module with no JS fallback: every call rejects under Jest.
 * Mocked to the honest default for a test device — no hardware — so a
 * test that does not care about biometrics sees the feature switched
 * off, and the ones that do care inject a `BiometricGate` instead of
 * reaching for this.
 */
jest.mock('expo-local-authentication', () => ({
  __esModule: true,
  hasHardwareAsync: jest.fn(() => Promise.resolve(false)),
  isEnrolledAsync: jest.fn(() => Promise.resolve(false)),
  supportedAuthenticationTypesAsync: jest.fn(() => Promise.resolve([])),
  authenticateAsync: jest.fn(() => Promise.resolve({ success: false, error: 'not_available' })),
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 },
}));

/**
 * The font loader.
 *
 * `@expo/vector-icons` asks `expo-font` whether its glyph font is
 * loaded, and `expo-font` answers by calling into `ExpoFontLoader`, a
 * native module. jest-expo auto-mocks that to an object whose
 * `getLoadedFonts()` returns `undefined`, and the `.forEach` on the next
 * line throws inside every component that renders an `Icon` — which is
 * most of them.
 *
 * Fonts are loaded by the platform at startup and there is nothing of
 * Medora's in this answer, so the fake says yes. The same rule as the
 * mocks above: this fakes the platform, never this app's logic.
 */
jest.mock('expo-font', () => ({
  __esModule: true,
  isLoaded: () => true,
  loadAsync: jest.fn(() => Promise.resolve()),
  unloadAsync: jest.fn(() => Promise.resolve()),
  useFonts: () => [true, null],
}));

/**
 * `onlineManager` is a module singleton, and `NetworkProvider` sets it
 * from NetInfo. A test that drives NetInfo offline therefore leaves the
 * *next* test's cache believing the device has no signal — a leak with
 * no visible cause, since nothing in the second test mentions the
 * network. Reset it, the way `clearMocks` resets a spy.
 */
afterEach(() => {
  onlineManager.setOnline(true);
});

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: {
    addEventListener: jest.fn(() => () => undefined),
    fetch: jest.fn(() => Promise.resolve({ isConnected: true, isInternetReachable: true })),
  },
}));

/**
 * Reduce-motion.
 *
 * `AccessibilityInfo.isReduceMotionEnabled()` is a promise, and its
 * resolution is a state update outside `act()` in every synchronous test
 * that happens to render a skeleton. Left unresolved here, so
 * `useReducedMotion()` stays in its "unknown, so do not animate" state
 * and no looping animation outlives a test.
 *
 * A test that needs the resolved value overrides this locally:
 *   jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true)
 */
jest
  .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
  .mockImplementation(() => new Promise<boolean>(() => undefined));

// Environment. Metro inlines these at build time; Node does not.
process.env.EXPO_PUBLIC_API_BASE_URL = 'http://localhost:3000/api/v1';
process.env.EXPO_PUBLIC_APP_ENV = 'development';
process.env.EXPO_PUBLIC_ENABLE_MOCKS = 'true';
