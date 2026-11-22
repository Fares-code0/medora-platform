/**
 * The AI assistant's session boundary (S1) — what `AuthProvider` calls on
 * sign-in, logout, lock, a refused refresh and first load.
 *
 * Deliberately tiny and import-free. `AuthProvider` is in the entry chunk
 * that `/login` loads, so anything it imports ships to every visitor; the
 * conversation store carries the seeded demo conversations, and importing
 * it here put them in that chunk. Instead the store registers its reset with
 * this module when it loads. If it never loaded, there is nothing in memory
 * to drop.
 */

/**
 * The global keys the assistant wrote before S1. Never written again;
 * removed on first load and at every session boundary.
 */
export const LEGACY_AI_STORAGE_KEYS: readonly string[] = [
  'medora.ai.conversations.v1',
  'medora.ai.settings.v1',
];

let resetMemory: (() => void) | null = null;

/** Called once by the conversation store, to be reset at a session boundary. */
export function registerAiSessionReset(reset: () => void): void {
  resetMemory = reset;
}

/** Deletes the pre-S1 global keys, which may hold a patient name. */
export function removeLegacyAiStorage(): void {
  try {
    LEGACY_AI_STORAGE_KEYS.forEach((key) => {
      window.localStorage.removeItem(key);
    });
  } catch {
    // Storage unavailable — nothing to remove.
  }
}

/**
 * Ends the assistant's session data: drops the in-memory conversations (the
 * next read re-seeds the demo set) and removes the legacy global keys.
 */
export function clearAiSessionData(): void {
  resetMemory?.();
  removeLegacyAiStorage();
}
