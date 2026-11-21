import { PREFERENCE_KEYS, preferenceStore } from '@/storage/preference-store';

/**
 * "Shown once" — checklist E-02.
 *
 * A single boolean in the non-sensitive preference tier. It is not PHI,
 * it is not a session fact, and it must never become either: whether a
 * patient has seen three slides says nothing about their health, and the
 * value deliberately does not record *when* or *how far they got*, which
 * would start to.
 *
 * ── The limit that used to be stated here is gone ────────────────────
 *
 * This paragraph used to say that `preferenceStore` was in memory, so
 * "never shown twice" held within a run and **not across a cold start**:
 * a patient who force-quit saw the carousel again. That was the whole of
 * why E-02 was 🟨.
 *
 * `storage/durable-preference-store.ts` closed it. The flag survives a
 * cold start, and `bootstrap/PreferenceGate.tsx` guarantees it is in
 * memory before the navigator asks. Nothing in this file changed for it,
 * which is what the port was for.
 *
 * This module exists rather than the screen reading the store directly so
 * that the flag has one reader and one writer, and so the navigator can
 * ask the question without importing a screen.
 */

const SEEN = 'true';

export function hasSeenOnboarding(): boolean {
  return preferenceStore.get(PREFERENCE_KEYS.onboardingSeen) === SEEN;
}

/**
 * Called when the carousel is finished OR skipped — the two are the same
 * decision as far as this flag is concerned. Skipping is a choice, and an
 * app that re-asks after a skip has not accepted the answer.
 */
export function markOnboardingSeen(): void {
  preferenceStore.set(PREFERENCE_KEYS.onboardingSeen, SEEN);
}

/** Test seam, and the reset a "show me again" affordance would use. */
export function forgetOnboarding(): void {
  preferenceStore.remove(PREFERENCE_KEYS.onboardingSeen);
}
