/**
 * The HTTP adapters' session boundary — what `AuthProvider` calls on sign-in
 * and at every session end (logout, a refused refresh, an account switched
 * in another tab).
 *
 * Some live adapters hold session state in module memory rather than on the
 * server: unsaved record and prescription drafts, which name patients and
 * carry clinical text; the formulary; a reviewer's unsubmitted ticks. The
 * module outlives the session, so without this a second account signing in
 * on the same tab listed the first one's drafts.
 *
 * Deliberately tiny and import-free, like the AI assistant's
 * `session-storage.ts`: `AuthProvider` is in the entry chunk, and importing
 * the adapters here would put them in it. Each adapter registers its reset
 * when it loads. If it never loaded, there is nothing in memory to drop.
 *
 * Not called on lock: the same user's unlock resumes their unsaved work, and
 * the lock screen replaces every view that would show it.
 */

const resets = new Set<() => void>();

/** Called once by each adapter, to drop its in-memory state at a boundary. */
export function registerSessionMemoryReset(reset: () => void): void {
  resets.add(reset);
}

/** Drops every registered adapter's in-memory session state. */
export function clearSessionMemory(): void {
  resets.forEach((reset) => {
    reset();
  });
}
