import { env } from '@/configs/env';

/**
 * What happens after the app has been in the background (checklist T-11).
 *
 * ── The problem ──────────────────────────────────────────────────────
 * PHI is memory-only and memory survives backgrounding. A phone left on
 * a café table with Medora in the app switcher still holds an open
 * records screen, and the access token that would fetch more of them.
 * "No PHI on disk" (T-03) says nothing about the copy already in RAM.
 *
 * ── Two thresholds, not one ──────────────────────────────────────────
 * A single aggressive timeout is a gate patients defeat by never
 * backgrounding the app, so the response is graded:
 *
 * | Away for                   | Action           | Cost to the patient |
 * |----------------------------|------------------|---------------------|
 * | < `phiSweepAfterMs`        | nothing          | —                   |
 * | ≥ `phiSweepAfterMs`        | `sweep-phi`      | a refetch           |
 * | ≥ `reauthenticateAfterMs`  | `reauthenticate` | signing in again    |
 *
 * `sweep-phi` empties the query cache and leaves the session standing —
 * ten minutes in a waiting room should not sign a patient out. Past the
 * second threshold that reasoning stops holding, and the session ends:
 * tokens cleared from memory and from the keychain, cache swept, and the
 * login screen says why (`reason: 'locked'`).
 *
 * ── Why the session ENDS rather than being locked behind a screen ────
 * A lock screen that keeps the session alive has to remember who is
 * locked out of it, and `features/auth/storage.ts` refuses that in as
 * many words: *"a convenience field on a lock screen is a patient
 * identifier on a lost phone"*. Ending the session needs no such record,
 * and reuses the expired-session path that D-12 already builds and tests.
 * Ending it in the foreground handler alone did NOT survive a force-quit:
 * a process killed in the background never runs that handler, and its
 * refresh token is still stored. So the absence is also written to the
 * non-identifying session guard (`session-guard.ts`), and the cold start
 * applies this same decision before the stored token is presented.
 * Biometric app-unlock (D-15) is a different control layered on top, not
 * a replacement for this one.
 *
 * ── Configurable ─────────────────────────────────────────────────────
 * Both thresholds come from the validated environment, in minutes, with
 * production-safe defaults. `configs/env.ts` refuses a configuration
 * where re-authentication would fire before the sweep, which would make
 * the sweep unreachable.
 */

export interface SessionLockPolicy {
  /** Milliseconds in the background before the PHI cache is swept. */
  readonly phiSweepAfterMs: number;
  /** Milliseconds in the background before the session ends. */
  readonly reauthenticateAfterMs: number;
}

export type ForegroundAction = 'none' | 'sweep-phi' | 'reauthenticate';

/**
 * The whole decision, as a pure function — so the policy is testable at
 * its boundaries without an `AppState` transition or a fake clock.
 */
export function decideOnForeground(awayMs: number, policy: SessionLockPolicy): ForegroundAction {
  if (awayMs >= policy.reauthenticateAfterMs) return 'reauthenticate';
  if (awayMs >= policy.phiSweepAfterMs) return 'sweep-phi';
  return 'none';
}

// `describeMinutes` lived here and produced "15 minutes" for the sign-in
// screen's timeout notice. It was English-only, and C-09 replaced it with
// `i18n/duration.ts`'s `formatMinutes`, which knows that Arabic has four
// forms where English has two. Nothing in the lock policy formats prose
// any more — the policy decides, the i18n layer words it.

/** The configured policy. `SessionProvider` takes it as an injectable default. */
export const sessionLockPolicy: SessionLockPolicy = {
  phiSweepAfterMs: env.phiSweepAfterMs,
  reauthenticateAfterMs: env.reauthenticateAfterMs,
};
