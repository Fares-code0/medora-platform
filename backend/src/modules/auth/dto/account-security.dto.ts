/**
 * The account-security projections — API §2.4, §2.6, §2.7.
 *
 * Three shapes, all transcribed from the frontend's settings model
 * (`features/doctor/settings/model/types.ts`): `ActiveSession`,
 * `TrustedDevice` and `LoginEvent`. The Security section renders them
 * directly, so the field names here are the contract rather than a
 * convenience.
 *
 * ## What is deliberately absent
 *
 * `refreshTokenHash` and `previousTokenHash` — the session row's two
 * secrets. They are hashes, so they cannot mint a session, but a client
 * has no use for them and a value on the wire is a value in a log.
 *
 * `expiresAt` — the refresh TTL is a server policy (30 days vs 12
 * hours). Publishing it tells a caller how long a stolen cookie stays
 * useful, and the client never renders it.
 *
 * `failureCode` on a login event — the eight `AuthErrorCode` values name
 * *why* an attempt failed, including `email_unverified` and
 * `account_inactive`. The history page renders `success | failed` and
 * nothing finer (`LoginEvent.status`), and the finer answer belongs to
 * M28's audit surface where an administrator reads it with context.
 *
 * ## `null` rather than an empty string
 *
 * The frontend's `ActiveSession` types `browser`, `location` and
 * `ipAddress` as `string`, and the mock always fills them. The columns
 * are nullable and `location` is *always* null today — no geo-IP
 * provider is configured, and ADR-025 records that a guessed city on a
 * security page is worse than a blank one. So these are `string | null`
 * on the wire: widening the client's type is the honest fix, and
 * inventing `"Unknown"` server-side would put a fabricated location in
 * front of someone deciding whether to revoke a session.
 */

export interface ActiveSessionView {
  /** `sessions.id`. The handle `DELETE /me/sessions/{id}` takes. */
  readonly id: string;
  readonly device: string | null;
  readonly browser: string | null;
  readonly location: string | null;
  readonly ipAddress: string | null;
  readonly startedAt: string;
  readonly lastActiveAt: string;
  /** True for the session the calling access token was minted from. */
  readonly current: boolean;
}

export interface TrustedDeviceView {
  readonly id: string;
  readonly name: string;
  /** `windows | mac | ios | android | desktop | mobile | tablet`. */
  readonly platform: string;
  readonly addedAt: string;
  readonly lastSeenAt: string | null;
  readonly current: boolean;
}

export interface LoginEventView {
  readonly id: string;
  /** `LoginEvent.at` — the frontend's field name, not `occurredAt`. */
  readonly at: string;
  readonly device: string | null;
  readonly location: string | null;
  readonly ipAddress: string | null;
  readonly status: 'success' | 'failed';
}

/**
 * The page envelope every paginated list in this codebase returns
 * (`PaginatedNotifications` at M19 is the same four fields).
 */
export interface Paginated<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}
