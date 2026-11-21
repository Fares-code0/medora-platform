import { createKeyFactory } from '@/api/query-keys';

/**
 * The profile query keys, in one place.
 *
 * ── Why they moved out of a screen ───────────────────────────────────
 *
 * `profileKeys` was exported from `ProfileScreen` and imported by
 * `EditProfileScreen` and `PrivacyScreen`, and `SecurityScreen` had
 * given up and called `createKeyFactory('profile')` again. That second
 * call is the failure `notifications/keys.ts` describes in its own
 * docblock: two factories over one domain produce keys that *look*
 * identical and invalidate correctly **by accident rather than by
 * construction** — the day one of them is given a different string, the
 * two screens stop seeing each other's writes and nothing fails.
 *
 * There is a second reason, and it is the one that reaches a patient.
 * `PHI_QUERY_DOMAINS` is the list `clearPhiCache` sweeps explicitly on
 * logout, on session loss and on the background timeout. A domain string
 * that exists in two places is a domain string that can be mistyped in
 * one of them, and a mistyped one is a cache entry that is not on the
 * list. (The sweep also calls `clear()` afterwards, which is the belt to
 * this brace — but the explicit pass is what makes the guarantee
 * testable per domain, and it only tests what it knows about.)
 *
 * ── The named sub-keys ───────────────────────────────────────────────
 *
 * Three queries share the `profile` prefix and hold three shapes: the
 * profile itself, the device list, and the privacy request state. They
 * are kept off `lists()` and under `all` for the reason the notification
 * count is: the prefix is what the logout sweep removes, and a rewrite
 * scoped to `lists()` must never meet an object that is not a list.
 */
const base = createKeyFactory('profile');

export const profileKeys = {
  ...base,
  /** The signed-in devices (P-06). */
  sessions: () => [...base.all, 'sessions'] as const,
  /** Export and deactivation request state (P-09, P-10). */
  privacy: () => [...base.all, 'privacy'] as const,
};
