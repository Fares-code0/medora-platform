/**
 * The auth failure contract — the codes every auth page branches on.
 *
 * These strings are the *shared* half of the mock↔HTTP seam: the
 * backend's `AUTH_ERROR_CODES` are transcribed verbatim from what used to
 * be `mock/types.ts`'s `MockAuthErrorCode`, so both adapters already speak
 * the same vocabulary and neither side has to translate.
 *
 * Lives in `model/` rather than `mock/` because the pages branch on it on
 * *both* paths. While it lived under `mock/`, importing it was the same
 * thing as importing the mock — which is precisely how `AuthProvider`
 * ended up hard-wired to the fake backend.
 *
 * ADR-012 governs edits here: a code is a stable machine identifier and
 * may never be reworded once shipped. The first eight are the original
 * contract; the last three arrived with ADR-035 and are listed separately
 * only so their provenance stays legible.
 */
export type AuthErrorCode =
  | 'invalid_credentials'
  | 'email_unverified'
  | 'otp_required'
  | 'otp_invalid'
  | 'email_taken'
  | 'token_invalid'
  | 'weak_password'
  | 'rate_limited'
  /** ADR-035 §6 — the account exists and the password was right, but its
   *  `status` is not ACTIVE (suspended, locked or deactivated). */
  | 'account_inactive'
  /** ADR-035 §7 — an administrator account with no enrolled second
   *  factor. A refusal, not a challenge: there is no secret to challenge
   *  against, so the account holder must be re-provisioned. */
  | 'two_factor_required'
  /** ADR-035 §4 — the professional registration number offered at doctor
   *  signup is already on another `doctors` row. */
  | 'professional_number_taken';

/** Typed error so callers can `switch (err.code)` without string matching. */
export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'AuthError';
    this.code = code;
  }
}

/**
 * A sign-in the server accepted for a role this client cannot place
 * (DEC-013). The route tree is chosen by role, and a custom role (API §15.4)
 * arrives as a code the client has never heard of; the session does not say
 * which base role it copies, so there is no workspace to open. An
 * `AuthError` so every existing caller treats it as a refused sign-in, but
 * not a new `AuthErrorCode`: those codes are the server's contract
 * (`backend/src/common/errors/error-codes.ts` transcribes them), and this
 * refusal is the client's own.
 */
export class UnsupportedRoleError extends AuthError {
  readonly role: string;

  constructor(role: string) {
    super('invalid_credentials', `Unsupported role from API: ${role}`);
    this.name = 'UnsupportedRoleError';
    this.role = role;
  }
}

/**
 * The lock screen's re-authentication reached the sign-in lockout
 * (`POST /me/password/verify` answered 429). The server has **revoked the
 * session being unlocked** at that moment (`ReauthenticationService`), so
 * there is nothing left to unlock: the screen must stop offering the
 * password field and send the user to sign in again. A `rate_limited`
 * `AuthError` so a caller that does not know this class still names the
 * throttle; not a new `AuthErrorCode`, for `UnsupportedRoleError`'s reason —
 * the codes are the server's, and "this session is gone" is the client's
 * reading of what the server did.
 */
export class ReauthLockoutError extends AuthError {
  constructor() {
    super('rate_limited', 'Too many failed attempts; the locked session was signed out');
    this.name = 'ReauthLockoutError';
  }
}

export function isAuthError(error: unknown): error is AuthError {
  return error instanceof AuthError;
}
