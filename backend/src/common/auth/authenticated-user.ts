/**
 * The authenticated principal (RM M6.2).
 *
 * ## Why this lives in `common/` and not in `modules/auth`
 *
 * Every module that guards a route needs this type, and M2.2's zone 1
 * forbids a module from importing a sibling — so a principal defined
 * inside `modules/auth` would be unreachable from `modules/patients`.
 * `common/` is the bottom of the stack and imported by everything, which
 * is exactly what a cross-cutting type needs. The *guard* stays in the
 * auth module; only the vocabulary is shared.
 *
 * ## Two ids, deliberately
 *
 * `id` is the database key and `publicId` is what the frontend shows
 * (`SessionUser.id` — `usr_doctor_amelia`). Repositories join on the
 * first; responses and audit metadata quote the second. Collapsing them
 * into one field is how a `usr_…` string ends up in a `WHERE id =` and
 * fails at runtime rather than at compile time.
 */
export interface AuthenticatedUser {
  /** `users.id` — the uuid. What every foreign key refers to. */
  readonly id: string;
  /** `users.public_id` — the client-facing `usr_…` identifier. */
  readonly publicId: string;
  /** Role **code** (`doctor`, `admin`), not the role row's uuid. */
  readonly role: string;
  /**
   * The permission codes resolved when the token was issued. Static for
   * the life of the access token by contract (API §1.11: "permissions
   * are static per session (changes apply at next issue)").
   */
  readonly permissions: readonly string[];
  /** `sessions.id` — ties the request to the session that minted it. */
  readonly sessionId: string;
  /**
   * `users.authz_version`, read from PostgreSQL with the session on every
   * request (never a token claim). Keys the permission cache.
   */
  readonly authzVersion?: number;
}

/**
 * Where the guard puts the principal on the request. A symbol rather
 * than `request.user`: Express's own typings already claim that
 * property, and a symbol cannot be reached by accident from a body or a
 * query string.
 */
export const AUTHENTICATED_USER = Symbol('AUTHENTICATED_USER');

/** The request shape the guard writes and `@CurrentUser()` reads. */
export interface RequestWithUser {
  [AUTHENTICATED_USER]?: AuthenticatedUser;
}
