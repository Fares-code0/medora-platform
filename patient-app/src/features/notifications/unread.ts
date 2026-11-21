/**
 * The unread badge — the presentation half of checklist O-02 / F-07.
 *
 * Kept as pure functions and constants, away from the hook, so the two
 * rules the checklist actually states can be tested without an
 * `AppState` transition, a fake clock or a query client.
 */

/**
 * Above this, the badge shows `99+`.
 *
 * The cap is not cosmetic. A tab-bar badge grows the tab it sits on, and
 * a four-digit count pushes the label of a five-tab bar into truncation
 * at 375 pt — the width `AppTabs` already treats as the floor. It is also
 * the point past which the number stops being information: a patient with
 * 412 unread notifications and one with 99 do the same thing about it.
 */
export const UNREAD_BADGE_CAP = 99;

/**
 * How often the badge re-reads the count while the app is in front.
 *
 * The checklist asks for 10–15 s and this takes the top of that range on
 * purpose: the count is one small `GET` and there is no push provider
 * (BE-12) to make it event-driven, so the poll IS the delivery mechanism
 * and it runs on the patient's battery and data. Fifteen seconds is the
 * slowest interval that still feels immediate for the case that matters
 * — a patient watching the app for an appointment confirmation.
 *
 * **Foreground only.** A background poll would be a wake-up this app has
 * no permission for, no provider behind, and no reason to want: nothing
 * reads the badge while the app is not on screen, and `SessionProvider`
 * may well have ended the session by the time it comes back (T-11).
 */
export const UNREAD_POLL_INTERVAL_MS = 15_000;

/**
 * Whether to poll at all, and how often — the whole rule as a pure
 * function, following `lock-policy.ts`'s `decideOnForeground`: the two
 * conditions the checklist states are testable at their boundaries
 * without an `AppState` transition, a query client or a fake clock.
 *
 * `false` is React Query's own "do not poll", so this returns the value
 * `refetchInterval` takes rather than a boolean the hook then translates.
 */
export function unreadPollInterval(conditions: {
  readonly isForeground: boolean;
  readonly isOnline: boolean;
}): number | false {
  if (!conditions.isForeground) return false;
  if (!conditions.isOnline) return false;
  return UNREAD_POLL_INTERVAL_MS;
}

/**
 * The badge's text, or `null` for no badge at all.
 *
 * Zero is `null` rather than `'0'`: a badge reading zero is a permanent
 * decoration that trains the eye to ignore the badge, which is the one
 * thing a notification indicator must not do.
 *
 * A count this client cannot vouch for — the query has not answered yet,
 * or it failed — is also `null`. The badge fails quiet, like the
 * deprecation banner (W-07) and unlike the upgrade gate: a wrong number
 * on a tab bar is worse than no number, and there is nothing a patient
 * can do about a badge that could not load.
 */
export function formatUnreadBadge(count: number | undefined): string | null {
  if (count === undefined || !Number.isFinite(count) || count <= 0) return null;
  const whole = Math.floor(count);
  if (whole <= 0) return null;
  return whole > UNREAD_BADGE_CAP ? `${UNREAD_BADGE_CAP}+` : String(whole);
}

/**
 * What a screen reader announces for the tab carrying the badge.
 *
 * The badge is a visual affordance and `tabBarBadge` is not announced on
 * either platform, so without this the count is invisible to VoiceOver
 * and TalkBack — S-02 asks for a label on every control, and "Profile"
 * alone is a different control from "Profile, 3 unread notifications".
 *
 * It says the real number even when the badge says `99+`: the cap exists
 * because of tab width, and a screen reader has no tab width.
 *
 * ── Why it returns a description rather than a sentence (C-09) ──────
 *
 * The count and the plural form are the rule; the wording is the
 * catalogue's. Returning `null` for "no badge, so just the tab name"
 * keeps the caller's branch honest, and the one/many split is two keys
 * rather than one with a plural slot — the same reason `duration.ts`
 * exists, at one tenth the complexity, because a count of notifications
 * only ever needs the two English forms this app has keys for.
 */
export interface UnreadAnnouncement {
  readonly count: number;
}

export function unreadTabAnnouncement(count: number | undefined): UnreadAnnouncement | null {
  if (count === undefined || !Number.isFinite(count) || count <= 0) return null;
  const whole = Math.floor(count);
  return whole <= 0 ? null : { count: whole };
}
