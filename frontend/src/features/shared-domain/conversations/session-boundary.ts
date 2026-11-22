/**
 * The mock messaging store's session boundary — what `AuthProvider` calls on
 * sign-in, session restore, logout, lock and first load.
 *
 * Deliberately tiny and import-free, like the AI assistant's
 * `session-storage.ts`: `AuthProvider` is in the entry chunk, and the mock
 * boundary check forbids that chunk from carrying `store.ts` or the seed.
 * The owner and the key names live here; the store reads them and registers
 * its in-memory reset when it loads. If it never loaded, there is no memory
 * to drop — only a persisted key, which this module removes itself.
 */

/** Pre-isolation global key. Never read or written; removed at boot and at session boundaries. */
export const LEGACY_CONVERSATIONS_KEY = 'medora.messaging.v1';
const KEY_PREFIX = 'medora.messaging.v1.';

let owner: string | null = null;
let resetMemory: (() => void) | null = null;

/** Called once by the store, to drop its in-memory copy at a boundary. */
export function registerConversationsMemoryReset(reset: () => void): void {
  resetMemory = reset;
}

/** The storage key for the current owner, or `null` when there is none. */
export function conversationsStorageKey(): string | null {
  return owner === null ? null : `${KEY_PREFIX}${owner}`;
}

/** Remove the legacy global key. */
export function removeLegacyConversationsStorage(): void {
  try {
    window.localStorage.removeItem(LEGACY_CONVERSATIONS_KEY);
  } catch {
    // Storage unavailable — nothing to remove.
  }
}

/** Point the store at `userId`'s data, or at nothing (`null`) when signed out. */
export function setConversationsOwner(userId: string | null): void {
  if (owner !== userId) resetMemory?.();
  owner = userId;
}

/** Drop the current owner's persisted mock conversations and reset the owner. */
export function clearConversationsSession(): void {
  const key = conversationsStorageKey();
  try {
    if (key !== null) window.localStorage.removeItem(key);
  } catch {
    // Storage unavailable — nothing persisted to clear.
  }
  removeLegacyConversationsStorage();
  owner = null;
  resetMemory?.();
}
