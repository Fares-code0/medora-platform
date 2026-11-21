 
import * as ExpoSecureStore from 'expo-secure-store';

import type { SecureStore } from './ports';

/**
 * The refresh token's home: iOS Keychain / Android Keystore, via
 * `expo-secure-store`.
 *
 * This is the only module in the tree allowed to import
 * `expo-secure-store` — the ESLint config enforces it — because a second
 * caller is a second place a token can be written, and the guarantee
 * T-02 makes ("refresh token in the keychain, access token in memory,
 * nothing else on disk") is only checkable if there is one door.
 *
 * `WHEN_UNLOCKED_THIS_DEVICE_ONLY` is deliberate: the refresh token must
 * not travel in an iCloud Keychain backup to another device, and it must
 * not be readable while the phone is locked.
 */
const OPTIONS: ExpoSecureStore.SecureStoreOptions = {
  keychainAccessible: ExpoSecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const secureStore: SecureStore = {
  async getItem(key) {
    return ExpoSecureStore.getItemAsync(key, OPTIONS);
  },
  async setItem(key, value) {
    await ExpoSecureStore.setItemAsync(key, value, OPTIONS);
  },
  async removeItem(key) {
    await ExpoSecureStore.deleteItemAsync(key, OPTIONS);
  },
};

/**
 * An in-memory `SecureStore` for tests and for the fixture build. It is a
 * test double, not a fallback: shipping it would put the refresh token in
 * a JS variable, so nothing in `src/` outside a test may import it.
 */
export function createInMemorySecureStore(): SecureStore {
  const map = new Map<string, string>();
  return {
    async getItem(key) {
      return map.get(key) ?? null;
    },
    async setItem(key, value) {
      map.set(key, value);
    },
    async removeItem(key) {
      map.delete(key);
    },
  };
}
