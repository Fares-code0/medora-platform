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
   * The account's current permission codes. Minted into the token at
   * issue; `AccessTokenGuard` replaces them with a fresh resolution when
   * the token's `pv` claim no longer matches `users.permission_version`,
   * so a permission change applies on the next request (G4, ADR-047).
   */
  readonly permissions: readonly string[];
  /**
   * `users.permission_version` (G4, ADR-047). From the token's `pv` claim
   * until `AccessTokenGuard` overwrites it with the value it read from the
   * database for this request; absent on a token minted before the claim
   * existed, which the guard treats as stale.
   */
  readonly permissionVersion?: number;
  /** `sessions.id` — ties the request to the session that minted it. */
  readonly sessionId: string;
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
