import type { SecureStore } from '@/storage/ports';
import { secureStore } from '@/storage/secure-store';

/**
 * Token storage.
 *
 * ── The whole rule, in three lines ───────────────────────────────────
 * - The **refresh token** goes in the platform keychain, and nowhere else.
 * - The **access token** lives in `ApiClient`'s private field, in memory,
 *   and is never handed to any store.
 * - **Nothing else** is stored by this module. Not the email, not the
 *   subject id, not "remember me". A convenience field on a lock screen
 *   is a patient identifier on a lost phone.
 *
 * `tokenStorage` is constructed around an injectable `SecureStore` so a
 * test can prove the rule without a device — `storage.test.ts` asserts
 * that after `clear()` the store holds no keys at all, and that the
 * access token never reaches it.
 */

const REFRESH_TOKEN_KEY = 'medora.refresh-token';

export interface TokenStorage {
  readRefreshToken(): Promise<string | null>;
  writeRefreshToken(token: string): Promise<void>;
  clear(): Promise<void>;
}

export function createTokenStorage(store: SecureStore): TokenStorage {
  return {
    readRefreshToken: () => store.getItem(REFRESH_TOKEN_KEY),
    writeRefreshToken: (token) => store.setItem(REFRESH_TOKEN_KEY, token),
    clear: () => store.removeItem(REFRESH_TOKEN_KEY),
  };
}

export const tokenStorage: TokenStorage = createTokenStorage(secureStore);
