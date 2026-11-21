/**
 * The user-facing activity feed contract (RM M8.6, API §2.8).
 *
 * ## Why this is a kernel and not a service inside `modules/users`
 *
 * M8.6 asks for "writer hooks (profile/password/settings/security/
 * integration/privacy)", and those six kinds are written from six
 * different modules: auth changes a password, users edits an account,
 * settings saves a slice, and M22.3 connects an integration. M2.2's
 * zone 1 forbids any of them importing another, so the recorder has to
 * sit below all of them — the same reasoning that put the mailer and the
 * audit dispatcher here (ADR-025, RM M2.3).
 *
 * ## Not `audit_events`, and the distinction is load-bearing
 *
 * `user_activity_log` is what a user sees *about their own account* in
 * Settings → Activity. `audit_events` is the platform ledger: immutable,
 * administrator-read-only, retained per policy. They answer different
 * questions for different audiences, and `03-identity.prisma` keeps them
 * apart on purpose. A security-relevant change writes **both** — one row
 * so the user can see "your password changed on Tuesday", one event so
 * an administrator investigating an incident can correlate it.
 *
 * ## `summary` is for a human, `kind` is for the client
 *
 * The frontend's `ActivityEntry` (settings `model/types.ts`) renders
 * `summary` verbatim and groups by `kind` through `ACTIVITY_KIND_LABELS`.
 * So `kind` is a stable machine value — the seven members of the
 * `ActivityKind` enum — and `summary` is prose that may be reworded.
 *
 * **No PHI, and no secrets.** The same rule the audit metadata carries:
 * a summary names *what changed*, never the value it changed to. "Phone
 * number updated" is a summary; the phone number is not.
 */

/** The seven kinds, as the wire and the frontend union spell them. */
export const ACTIVITY_KINDS = [
  'profile',
  'password',
  'login',
  'settings',
  'security',
  'integration',
  'privacy',
] as const;

export type ActivityKindWire = (typeof ACTIVITY_KINDS)[number];

export interface ActivityEntryInput {
  /** `users.id` — the account the entry belongs to, never a public id. */
  readonly userId: string;
  readonly kind: ActivityKindWire;
  /** ≤200 chars (the column width). Human prose, no PHI, no secrets. */
  readonly summary: string;
  /** Optional longer line. Same content rules as `summary`. */
  readonly detail?: string | undefined;
  /** Defaults to now at write time; set it when replaying. */
  readonly occurredAt?: Date | undefined;
}

/**
 * Implemented by `PrismaActivityRecorder`.
 *
 * `record()` resolves rather than throwing when the write fails, for the
 * reason `LoginEventService` states about its own table: a password
 * change that 500s because a feed insert failed has made an
 * observability dependency into an availability one. The feed is a
 * convenience; the mutation it describes is the thing that matters.
 */
export interface ActivityRecorder {
  record(entry: ActivityEntryInput): Promise<void>;
}

/** DI token — inject the interface, never the concrete class. */
export const ACTIVITY_RECORDER = Symbol('ACTIVITY_RECORDER');
