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
/**
 * What the lock took off disk: the locking user's id and their serialized
 * conversations, held in memory only. Lock moves the copy out of
 * localStorage, so a workstation left at the lock screen — or a tab closed
 * there — has nothing on disk; only that same user's unlock in this tab puts
 * it back. Every other transition drops it.
 */
let held: { readonly userId: string; readonly raw: string | null } | null = null;
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
  // Only an unlock gives held data back; any other hand-over drops it.
  held = null;
  owner = userId;
}

/**
 * Lock: move the owner's copy off disk into memory and detach the store
 * (nothing readable or writable while locked). Logout from the lock screen
 * drops it (`clearConversationsSession`).
 */
export function lockConversationsSession(): void {
  if (owner !== null) {
    const key = `${KEY_PREFIX}${owner}`;
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(key);
      window.localStorage.removeItem(key);
    } catch {
      // Storage unavailable — nothing persisted to move.
    }
    held = { userId: owner, raw };
  }
  owner = null;
  resetMemory?.();
}

/** Unlock: the user who locked gets their copy back; anyone else starts fresh. */
export function unlockConversationsSession(userId: string): void {
  if (held !== null && held.userId === userId) {
    const { raw } = held;
    held = null;
    owner = userId;
    if (raw !== null) {
      try {
        window.localStorage.setItem(`${KEY_PREFIX}${userId}`, raw);
      } catch {
        // Storage unavailable — the store falls back to the seed.
      }
    }
    return;
  }
  clearConversationsSession();
  setConversationsOwner(userId);
}

/** Drop the current owner's persisted mock conversations and reset the owner. */
export function clearConversationsSession(): void {
  const key = conversationsStorageKey();
  try {
    if (key !== null) window.localStorage.removeItem(key);
  } catch {
    // Storage unavailable — nothing persisted to clear.
  }
  held = null;
  removeLegacyConversationsStorage();
  owner = null;
  resetMemory?.();
}
