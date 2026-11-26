/**
 * The authentication port.
 *
 * ── The rule this file is written to obey ────────────────────────────
 *
 * ADR-018 §3 says patients are records, not users. The patient app needs
 * authenticated patients. The backend team is resolving that separately
 * (proposed ADR-030), and §3 of the brief forbids this tree from deciding
 * it. So **nothing below assumes how patient identity is modelled.**
 *
 * Concretely, `AuthenticatedIdentity` has:
 *
 * - a `subjectId`, not a `userId` and not a `patientId`. Whether the
 *   subject is a `User`, a `Patient`, or a `User` linked to a `Patient`
 *   (options A/B/C of audit §4.1) is the backend's decision and changes
 *   nothing here;
 * - a `displayName`, because a greeting needs one, and NOT a full name
 *   split, a date of birth, an MRN or any other identifier — none of
 *   which the login response's shape is settled enough to promise;
 * - a `role`, read for ONE decision only: whether this app may be used
 *   at all (C-11, eligibility). A non-patient account never reaches a
 *   patient screen — `eligibility.ts`. It is not an authorization input
 *   for anything else, and there are no `permissions`: the client makes
 *   no per-action authorization decision (checklist T-07); hiding a
 *   button is presentation, and the server refuses the call regardless.
 *
 * When ADR-030 lands, `AuthenticatedIdentity` gains whatever the contract
 * actually returns. The screens do not move.
 */

/** Who is signed in. Deliberately minimal — see the file header. */
export interface AuthenticatedIdentity {
  /** Opaque. Never parsed, never displayed, never used as a claim. */
  readonly subjectId: string;
  /** For the greeting and the profile header. */
  readonly displayName: string;
  readonly email: string;
  readonly emailVerified: boolean;
  /**
   * The server's role literal (`SessionUserPayload.role`), or `null` when
   * the payload did not name one. Only `'patient'` is eligible for this
   * app; anything else — `null` included — is refused (`eligibility.ts`).
   */
  readonly role: string | null;
}

/**
 * The session machine.
 *
 * `booting` is a real state and not a boolean: a cold start restores from
 * the keychain, and rendering the login screen for the 300ms that takes
 * is the "login flash" checklist D-05 forbids.
 *
 * `reason` is what the login screen says instead of nothing. The three
 * ways out of a session are distinguishable because they read
 * differently to the patient: `signed-out` was their own doing,
 * `session-expired` was the server's, and `locked` was this app's own
 * background timeout (checklist T-11).
 *
 * `ineligible` (C-11) is a fourth, and it is not a sign-in failure: the
 * server accepted the credentials, but the account is not a patient
 * account. The session was ended (server-side and locally) and the
 * navigator shows the "patients only" screen instead of the sign-in form.
 */
export type SessionEndReason = 'signed-out' | 'session-expired' | 'locked' | 'ineligible';

export type SessionState =
  | { readonly status: 'booting' }
  /**
   * A refresh token is in the keychain and the server could not be
   * reached to exchange it — no signal, a timeout, a 5xx (see
   * `refresh-outcome.ts`). Not signed in: there is no access token and
   * no identity, so nothing clinical can be shown. Not signed out
   * either: the token is kept, because nothing has said it is dead.
   */
  | { readonly status: 'unconfirmed' }
  | { readonly status: 'unauthenticated'; readonly reason?: SessionEndReason }
  | { readonly status: 'authenticated'; readonly identity: AuthenticatedIdentity };

/** What a successful sign-in yields. */
export interface AuthTokens {
  /** Memory only. Never written to any store (checklist T-02). */
  readonly accessToken: string;
  /**
   * Keychain / keystore only.
   *
   * Present in the BODY rather than a cookie because this client sends
   * `X-Client-Type: mobile`, which the backend already honours
   * (`auth.controller.ts:285`).
   */
  readonly refreshToken: string;
}

export interface SignInResult {
  readonly tokens: AuthTokens;
  readonly identity: AuthenticatedIdentity;
}

/** `POST /auth/login` can end in a step-up rather than a session. */
export type LoginOutcome =
  | { readonly kind: 'authenticated'; readonly result: SignInResult }
  | { readonly kind: 'otp-required'; readonly otpToken: string };

export interface LoginInput {
  readonly email: string;
  readonly password: string;
  readonly rememberMe: boolean;
}

export interface OtpVerifyInput {
  readonly otpToken: string;
  readonly code: string;
}

export interface RecoveryCodeInput {
  readonly otpToken: string;
  readonly recoveryCode: string;
}

/** `GET /me/2fa` (owner decision R2). */
export interface TwoFactorStatus {
  readonly enabled: boolean;
  readonly recoveryCodesRemaining: number;
}

/** `POST /me/2fa/reenroll` — the new key; nothing has changed yet. */
export interface TwoFactorReenrollment {
  readonly secret: string;
  readonly otpauthUrl: string;
  /** Binds step 2 to this session and to the factor being replaced. */
  readonly enrolmentToken: string;
}

export interface ResetPasswordInput {
  readonly token: string;
  readonly password: string;
}

/**
 * Changing a password from inside a session (checklist P-05).
 *
 * `currentPassword` is sent, not checked here: the server verifies it
 * against the stored hash. A client that compared strings would be
 * asserting something it cannot know, and would tell a patient their
 * password was wrong before the only party that can say so was asked.
 *
 * `confirmNewPassword` is deliberately absent — it exists on the FORM
 * (`changePasswordFormSchema`) and never on the wire, for the same reason
 * the backend's own schema drops it: the server holds one password and
 * has nothing to compare a second against.
 */
export interface ChangePasswordInput {
  readonly currentPassword: string;
  readonly newPassword: string;
}

/**
 * What `POST /me/2fa/setup` yields (checklist D-16, API §2.9).
 *
 * `recoveryCodes` arrives exactly once. The server stores them encrypted
 * and never reads them back, so a patient who loses them has to run
 * setup again — which is what makes the one screen that shows them the
 * only place they exist outside the server.
 *
 * None of this is ever written to a store. It lives in component state
 * for the length of the enrolment and goes with the screen (T-03).
 */
export interface TwoFactorEnrolment {
  /** base32, for a patient entering the key by hand. */
  readonly secret: string;
  /** `otpauth://totp/…` — handed to the authenticator app via `Linking`. */
  readonly otpauthUrl: string;
  readonly recoveryCodes: readonly string[];
}

/**
 * Registration input.
 *
 * `role` is **absent, and stays absent** — but the reason has changed
 * with ADR-035 and is worth stating, because it inverted.
 *
 * It used to be absent because sending `patient` would have been
 * inventing a contract the backend did not offer. ADR-030 removed that
 * objection and ADR-035 §4 made the patient branch a first-class member
 * of the register union. It is absent now because the HTTP adapter
 * supplies it as a **constant**: this client registers patients, and a
 * caller-supplied role would be a way for a modified app to ask for a
 * clinician account. Keeping the field off this interface means no
 * caller in this codebase can express the request.
 *
 * No `licenseNumber` and no professional block, for the reason that has
 * not changed: they are clinician fields with no business on a patient
 * form.
 */
export interface RegisterInput {
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone: string;
  readonly password: string;
  /** `users.terms_accepted_at` is NOT NULL by design. */
  readonly acceptTerms: true;
  readonly acceptPrivacy: true;
}

/**
 * What registration resolves to — **not** a session (ADR-035 §4).
 *
 * `POST /auth/register` answers 201 with `{ nextStep, email }` and
 * deliberately no tokens: the account exists but cannot sign in until the
 * address is verified, and `LoginService` blocks it with
 * `email_unverified` until then.
 *
 * This return type used to be `SignInResult`, which the fixture adapter
 * satisfied by inventing an access token and a refresh token. The screen
 * then branched on `identity.emailVerified` being false and navigated to
 * the verify screen — the right destination reached through a fiction. A
 * type that cannot express the fiction is the fix.
 */
export interface RegisterResult {
  readonly nextStep: 'verify-email';
  readonly email: string;
}

/**
 * The port. One interface, two adapters, one selection in `service.ts`.
 *
 * Every method that talks to a route which exists today is implemented by
 * the HTTP adapter. Every method that does not is `EndpointNotImplementedError`
 * with its blocking dependency named — never a plausible-looking path.
 */
export interface AuthService {
  login(input: LoginInput): Promise<LoginOutcome>;
  verifyOtp(input: OtpVerifyInput): Promise<SignInResult>;
  resendOtp(otpToken: string): Promise<void>;
  /** Exchanges a stored refresh token for a new pair. */
  refresh(refreshToken: string): Promise<SignInResult>;
  /**
   * `POST /auth/logout`. `skipRefresh` is set by the eligibility gate
   * alone: it revokes a session it is about to discard, sometimes from
   * inside the transport's own refresh, and a 401 there must not start a
   * second refresh that waits on the first (`ApiClient` `skipRefresh`).
   */
  logout(options?: { readonly skipRefresh?: boolean }): Promise<void>;
  forgotPassword(email: string): Promise<void>;
  resetPassword(input: ResetPasswordInput): Promise<void>;
  /**
   * `POST /me/password` — live today, unlike almost everything else this
   * app needs. Signed-in change, as distinct from `resetPassword`, which
   * is the signed-out recovery path and ends every session rather than
   * every other one.
   */
  changePassword(input: ChangePasswordInput): Promise<void>;
  /**
   * `POST /me/2fa/setup` — live today (checklist D-16). Begins an
   * enrolment; nothing is switched on until `enableTwoFactor` succeeds.
   * Takes the CURRENT password (owner decision D2): nothing secret is
   * issued until the server has accepted it.
   */
  setupTwoFactor(password: string): Promise<TwoFactorEnrolment>;
  /** `POST /me/2fa/enable` — six digits from the authenticator. */
  enableTwoFactor(code: string): Promise<void>;
  /**
   * `POST /me/2fa/disable` — the account PASSWORD, not a code. Someone
   * holding the phone but not the password is exactly who must not be
   * able to remove the second factor. Ends every other session.
   */
  disableTwoFactor(password: string): Promise<void>;
  /**
   * `POST /auth/otp/recovery` (owner decision R1) — completes a pending
   * step-up with one recovery code instead of the six digits.
   */
  redeemRecoveryCode(input: RecoveryCodeInput): Promise<SignInResult>;
  /**
   * `GET /me/2fa` (R2). `null` when the server does not serve it (an older
   * API that predates R2 answers 404): the client then does not know, and
   * says nothing about the state rather than guessing.
   */
  twoFactorStatus(): Promise<TwoFactorStatus | null>;
  /** `POST /me/2fa/reenroll` (Q7 / R4): the password and a current-app code. */
  startTwoFactorReenrollment(input: {
    readonly password: string;
    readonly code: string;
  }): Promise<TwoFactorReenrollment>;
  /** `POST /me/2fa/reenroll/confirm`: a new-app code; resolves the new recovery codes. */
  confirmTwoFactorReenrollment(input: {
    readonly enrolmentToken: string;
    readonly code: string;
  }): Promise<readonly string[]>;
  verifyEmail(token: string): Promise<void>;
  resendVerification(email: string): Promise<void>;
  /**
   * `POST /auth/register` with `role: 'patient'`, live since ADR-035 §4.
   *
   * Resolves to the next step, never to a session — see `RegisterResult`.
   */
  register(input: RegisterInput): Promise<RegisterResult>;
}
