import { createDurablePreferenceStore } from './durable-preference-store';
import type { PreferenceStore } from './ports';

/**
 * The non-sensitive preference store.
 *
 * ── It is durable now, and it was not ────────────────────────────────
 *
 * This file used to hold a `Map` and a paragraph explaining that the
 * durability was waiting on MMKV. That was honest and it was also the
 * reason E-02 could not close: "never shown twice" held within a run and
 * not across a cold start, so an app that had been told *skip* asked
 * again the next morning. P-07's theme and locale forgot themselves the
 * same way.
 *
 * The adapter is `durable-preference-store.ts` and its docblock carries
 * the argument for AsyncStorage over MMKV. The short version: MMKV needs
 * a development build, B-07 and W-03 are what would produce one, and both
 * are blocked on credentials and a device — so waiting for MMKV meant
 * waiting for those. The port did not change, which is the whole point of
 * having had one.
 *
 * `createMemoryPreferenceStore` stays, and is not dead code: it is what
 * `src/test/security.test.ts` walks to prove nothing PHI-shaped reaches a
 * preference store, and a test that needs an isolated store uses it
 * rather than the singleton.
 *
 * PHI must never be written here whatever the adapter is.
 */
export function createMemoryPreferenceStore(): PreferenceStore {
  const map = new Map<string, string>();
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => {
      map.set(key, value);
    },
    remove: (key) => {
      map.delete(key);
    },
    keys: () => [...map.keys()],
  };
}

/** The complete key vocabulary. A key not listed here does not exist. */
export const PREFERENCE_KEYS = {
  themeMode: 'medora.theme-mode',
  locale: 'medora.locale',
  onboardingSeen: 'medora.onboarding-seen',
  /**
   * Biometric app-unlock (D-15). A boolean, and nothing more: the lock
   * itself is not kept here. Only a non-identifying session guard is, in
   * the keychain beside the refresh token (`features/auth/session-guard.ts`),
   * because a stored lock must not remember who is locked out of it. See
   * `features/auth/biometrics.ts`.
   */
  biometricUnlock: 'medora.biometric-unlock',
} as const;

export const preferenceStore = createDurablePreferenceStore({
  keys: Object.values(PREFERENCE_KEYS),
});

/**
 * Loads the stored preferences before the first paint.
 *
 * `bootstrap/PreferenceGate.tsx` awaits this above `LocaleProvider`, and
 * that ordering is load-bearing: `ThemeProvider` and `LocaleProvider`
 * both read the store in a `useState` initialiser, so a hydration that
 * finished after they mounted would show the wrong palette and the wrong
 * language for one frame and then correct itself.
 */
export function hydratePreferences(): Promise<void> {
  return preferenceStore.hydrate();
}
