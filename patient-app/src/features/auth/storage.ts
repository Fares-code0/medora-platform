import type { SecureStore } from '@/storage/ports';
import { secureStore } from '@/storage/secure-store';

import {
  decodeSessionGuard,
  encodeSessionGuard,
  SESSION_GUARD_KEY,
  type SessionGuardRead,
  type SessionGuardRecord,
} from './session-guard';

/**
 * Token storage.
 *
 * ── The whole rule, in three lines ───────────────────────────────────
 * - The **refresh token** goes in the platform keychain, and nowhere else.
 * - The **access token** lives in `ApiClient`'s private field, in memory,
 *   and is never handed to any store.
 * - **Nothing else** is stored by this module, except the non-identifying
 *   session guard (`session-guard.ts`) that lives and dies with the
 *   refresh token. Not the email, not the subject id, not "remember me".
 *   A convenience field on a lock screen is a patient identifier on a
 *   lost phone.
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
  /** Throws on a platform failure; never on bad content (that is `corrupt`). */
  readSessionGuard(): Promise<SessionGuardRead>;
  writeSessionGuard(record: SessionGuardRecord): Promise<void>;
  /**
   * Tombstone first, then the token, then the guard. A token removal
   * that fails still throws, and leaves the tombstone beside the token,
   * so the next cold start discards it instead of restoring past the end.
   */
  clear(): Promise<void>;
}

export function createTokenStorage(store: SecureStore): TokenStorage {
  return {
    readRefreshToken: () => store.getItem(REFRESH_TOKEN_KEY),
    writeRefreshToken: (token) => store.setItem(REFRESH_TOKEN_KEY, token),
    readSessionGuard: async () => decodeSessionGuard(await store.getItem(SESSION_GUARD_KEY)),
    writeSessionGuard: (record) => store.setItem(SESSION_GUARD_KEY, encodeSessionGuard(record)),
    clear: async () => {
      try {
        await store.setItem(SESSION_GUARD_KEY, encodeSessionGuard({ v: 1, s: 'ended' }));
      } catch {
        // Best effort. The token removal below is what matters.
      }
      await store.removeItem(REFRESH_TOKEN_KEY);
      try {
        await store.removeItem(SESSION_GUARD_KEY);
      } catch {
        // A tombstone left with no token is harmless: nothing is restored,
        // and the next sign-in overwrites it.
      }
    },
  };
}

export const tokenStorage: TokenStorage = createTokenStorage(secureStore);
