/**
 * The account surface — API §2.1, §2.8.
 *
 * `AccountView` is the frontend's `AccountSettings`
 * (`features/doctor/settings/model/types.ts`) minus one field:
 * **`mockPassword` is deliberately absent.** The frontend's own comment
 * calls it a "demo-only mock credential the fake backend verifies
 * 'current password' against" and says "a real API owns this
 * server-side". This is that server side, and `POST /me/password` is
 * where the check happens — putting a password on the wire so a client
 * can pre-check it would be the single worst field in this codebase.
 *
 * `ActivityEntryView` is `ActivityEntry`, unchanged: the four fields the
 * Activity panel renders, with `kind` as the machine value it groups by.
 */

export interface AccountView {
  readonly email: string;
  /** Null until the user picks one — `users.username` is nullable. */
  readonly username: string | null;
  readonly phone: string;
  /** `user_credentials.password_updated_at`, ISO-8601. */
  readonly passwordUpdatedAt: string;
  /** Read-only here; changing it is `POST /me/2fa/*` (API §2.9). */
  readonly twoFactorEnabled: boolean;
  /** Null means unverified — M6.2 blocks sign-in on it. */
  readonly emailVerified: boolean;
}

export interface ActivityEntryView {
  readonly id: string;
  readonly at: string;
  /** One of the seven `ActivityKind` values. */
  readonly kind: string;
  readonly summary: string;
  readonly detail: string | null;
}

/**
 * Admin platform-users panel — API §2.10 (`PlatformUser`).
 *
 * `lastActiveAt` is nullable here where the frontend types it `string`.
 * The column is null for an account that has never signed in, and the
 * honest answer to "when was this person last active" for someone who
 * never has is not a fabricated timestamp — a widened client type is the
 * correct fix, the same call the security projections make.
 */
export interface PlatformUserView {
  /** `users.public_id` — the `usr_…` handle, never the uuid. */
  readonly id: string;
  readonly name: string;
  readonly email: string;
  /** Role **code**: `doctor`, `admin`, `patient`, `nurse`, … */
  readonly role: string;
  /** False for any non-ACTIVE status, and for a soft-deleted account. */
  readonly active: boolean;
  readonly lastActiveAt: string | null;
  readonly createdAt: string;
}
