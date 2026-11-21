/**
 * The administrator invitation port (ADR-035 §5).
 *
 * A second port beside `AuthService` rather than two more methods on it,
 * because these calls are not session operations: neither returns a
 * session, neither touches the refresh cookie, and `AuthProvider` has no
 * reason to know they exist. Adding them to `AuthService` would make
 * every adapter of that interface — including the mock — responsible for
 * a flow that has nothing to do with signing in.
 *
 * Lives in `types/` for the same reason `auth-service.ts` does: the HTTP
 * adapter is `api/endpoints/`, and a platform layer may not import from a
 * feature (§1.2, enforced by `import/no-restricted-paths`).
 *
 * ## Two phases, and why the page cannot merge them
 *
 * The backend creates the account INACTIVE at `accept` and only makes it
 * ACTIVE at `activate`, after a code from the secret `accept` issued has
 * verified. That is what makes an administrator's second factor
 * structurally mandatory rather than merely policy — so the client shows
 * two steps because there genuinely are two, not as a UI flourish.
 */

/** What phase 1 returns: everything needed to enrol, and no session. */
export interface InvitationEnrolment {
  readonly nextStep: 'configure-mfa';
  readonly email: string;
  /** base32, for a user who cannot scan a QR. */
  readonly secret: string;
  /** `otpauth://totp/…` — what a client renders as a QR. */
  readonly otpauthUrl: string;
  /**
   * Shown exactly once. They are stored encrypted server-side and never
   * read back out, so a user who loses them needs a new invitation.
   */
  readonly recoveryCodes: readonly string[];
}

/** What phase 2 returns. Still no session — the invitee signs in normally. */
export interface InvitationActivated {
  readonly nextStep: 'login';
  readonly email: string;
}

export interface InvitationService {
  /**
   * `POST /auth/admin-invitations/accept` — sets the password, creates
   * the account INACTIVE, returns the enrolment material.
   *
   * Rejects with `token_invalid` for every failure mode there is:
   * unknown, expired, revoked, or already accepted.
   */
  accept(token: string, password: string): Promise<InvitationEnrolment>;

  /**
   * `POST /auth/admin-invitations/activate` — proves a code from the
   * secret, turns the second factor on and makes the account ACTIVE.
   *
   * Rejects with `otp_invalid` for a wrong code and `token_invalid` if
   * the invitation is no longer in the state phase 1 left it in.
   */
  activate(token: string, code: string): Promise<InvitationActivated>;
}
