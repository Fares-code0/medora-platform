import AsyncStorage from '@react-native-async-storage/async-storage';

import { logger } from '@/utils/logger';

import type { PreferenceStore } from './ports';

/**
 * The durable non-PHI preference store — checklist E-02 and P-07.
 *
 * ── Why not MMKV, which the rows and the audit both name ─────────────
 *
 * `docs/ARCHITECTURE.md` §1 lists `react-native-mmkv` under *deliberately
 * absent* for a reason that is still true: it is a TurboModule, it needs
 * a development build, it cannot run in Expo Go, and it cannot run in
 * Jest without a native mock. B-07 and W-03 are the rows that would
 * produce a development build, and both are ⛔ blocked on credentials
 * and a device. Waiting for MMKV means waiting for those.
 *
 * AsyncStorage ships inside Expo Go, carries a maintained Jest mock, and
 * adds no vulnerability to the audit. It buys exactly the capability E-02
 * and P-07 name — three values that survive a cold start — and nothing
 * else. The port is unchanged, so if a development build ever arrives,
 * swapping this for MMKV is one file.
 *
 * ── The synchronous port over an asynchronous backend ────────────────
 *
 * `PreferenceStore` is synchronous by design, and `ports.ts` says why:
 * *"the theme has to resolve before the first paint or the app flashes
 * the wrong palette on every cold start"*. AsyncStorage is asynchronous.
 * The two are reconciled by hydrating once, before anything renders:
 *
 *   1. `hydrate()` reads the whole key vocabulary in one `multiGet`,
 *      into an in-memory mirror. `PreferenceGate` awaits it above
 *      `LocaleProvider`, so no provider ever reads an empty store.
 *   2. Every `get` afterwards is the mirror, and is genuinely
 *      synchronous — no promise, no first-paint flash.
 *   3. Every `set`/`remove` writes the mirror synchronously and the
 *      device in the background.
 *
 * ── Only the known keys are ever read ────────────────────────────────
 *
 * Hydration takes the key vocabulary as an argument and `multiGet`s
 * exactly it, rather than calling `getAllKeys`. A key this app does not
 * recognise — left by an older build, or by a library — cannot enter the
 * mirror, and `keys()`, which the logout sweep's assertion walks, cannot
 * come to report something the vocabulary does not define.
 *
 * ── A failed write is never a crash ──────────────────────────────────
 *
 * Storage is full, or the device refuses. That must not take the app
 * down, and it must not take the *preference* down either: the mirror is
 * already updated, so the app behaves correctly for this run and forgets
 * the choice on the next cold start. It is logged and swallowed.
 *
 * **PHI must never be written here**, whatever the adapter is.
 * `src/test/security.test.ts` is what holds that.
 */

/** The slice of AsyncStorage this needs — so a test can pass a fake. */
export interface AsyncKeyValueStore {
  multiGet(keys: readonly string[]): Promise<readonly (readonly [string, string | null])[]>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface DurablePreferenceStore extends PreferenceStore {
  /**
   * Loads the device's values into the mirror. Idempotent — a second
   * call is a no-op, so a re-mounted gate does not re-read the device.
   */
  hydrate(): Promise<void>;
  /** False until `hydrate()` has settled. */
  readonly isHydrated: boolean;
}

export function createDurablePreferenceStore(options: {
  /** The complete key vocabulary. Nothing outside it is read or kept. */
  readonly keys: readonly string[];
  readonly backend?: AsyncKeyValueStore;
}): DurablePreferenceStore {
  const backend = options.backend ?? AsyncStorage;
  const mirror = new Map<string, string>();
  let hydrated = false;
  let inFlight: Promise<void> | null = null;

  const swallow = (operation: string) => (error: unknown) => {
    // Logged through the redacting logger (T-04) like everything else,
    // though a preference key is not PHI by construction.
    logger.warn(`[preferences] ${operation} failed; the choice will not survive a restart`, {
      error: String(error),
    });
  };

  async function load(): Promise<void> {
    try {
      const entries = await backend.multiGet(options.keys);
      for (const [key, value] of entries) {
        if (value !== null) mirror.set(key, value);
      }
    } catch (error) {
      // An unreadable store is an empty one: the app starts on its
      // defaults rather than refusing to start.
      swallow('hydration')(error);
    } finally {
      hydrated = true;
    }
  }

  return {
    hydrate() {
      if (hydrated) return Promise.resolve();
      inFlight ??= load();
      return inFlight;
    },

    get isHydrated() {
      return hydrated;
    },

    get: (key) => mirror.get(key) ?? null,

    set: (key, value) => {
      mirror.set(key, value);
      void backend.setItem(key, value).catch(swallow(`writing ${key}`));
    },

    remove: (key) => {
      mirror.delete(key);
      void backend.removeItem(key).catch(swallow(`removing ${key}`));
    },

    keys: () => [...mirror.keys()],
  };
}
