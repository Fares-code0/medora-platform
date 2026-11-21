import type { SessionUser } from './index';

/**
 * The auth port — FRONTEND_CHECKLIST §2 A-12 / §6 DP-04.
 *
 * The one interface `AuthProvider` depends on. `mockAuthService` and
 * `httpAuthService` both implement it, and `features/auth/service.ts`
 * picks between them on `env.enableMocks`.
 *
 * Lives in `types/` and not in `features/auth/` because the HTTP adapter
 * is `api/endpoints/auth.ts`, and a platform layer may not import from a
 * feature (§1.2, enforced by `import/no-restricted-paths`). Every seam
 * that follows this pattern puts its port here for the same reason.
 *
 * ## Typed against the backend, not against the mock
 *
 * Every shape here is transcribed from `backend/src/modules/auth`
 * (controllers + DTOs), because that is the contract that cannot be
 * negotiated. Where the mock disagreed, the mock was changed — see the
 * seam notes in `docs/handoff/auth-seam.md`. The mock adapter is now the
 * one doing the adapting, which is the right way round: a mock shaped
 * like the fake backend is a mock you have to rewrite on integration day.
 *
 * ## What is deliberately NOT here
 *
 * Nothing on this interface may exist only to please the mock.
 *
 *  · **`reauthenticate`** (A-07 lock screen) is `POST /me/password/verify`
 *    on an API built from `backend`; against one without the route it
 *    falls back to spending a real `POST /auth/login`. See its doc comment
 *    in the HTTP adapter.
 *  · **Idle auto-lock** (A-11) is a pure client concern and stays in
 *    `AuthProvider`, on both paths. The server's own session timeout is
 *    a separate, longer clock.
 */

/** A live session. `accessToken` is memory-only (FE §6.2) — never stored. */
export interface AuthSession {
  readonly user: SessionUser;
  /** Bearer token for `ApiClient`. Empty string on the mock path. */
  readonly accessToken: string;
  /** Access-token lifetime in seconds (backend `JWT_ACCESS_TTL`, 900). */
  readonly expiresIn: number;
}

/**
 * `POST /auth/login` answers in one of two shapes, and the second is a
 * **success**, not a failure: the password was right and the account
 * needs a second factor. The `otpToken` is the handle that completes it.
 */
export type LoginOutcome =
  | { readonly kind: 'session'; readonly session: AuthSession }
  | { readonly kind: 'otp'; readonly otpToken: string };

/** A sign-in suspended awaiting a second factor or an email verification. */
export interface PendingSignIn {
  readonly email: string;
  readonly rememberMe: boolean;
  /**
   * The backend's step-up handle. `null` on the mock path, which has no
   * such token — the mock completes a pending sign-in from the email.
   */
  readonly otpToken: string | null;
}

/** `POST /auth/login` body (`backend/.../dto/login.schema.ts`). */
export interface LoginInput {
  readonly email: string;
  readonly password: string;
  /**
   * Chooses the refresh-token TTL server-side (30 days vs 12 hours). The
   * mock path uses it to choose a storage medium instead.
   */
  readonly rememberMe: boolean;
}

/**
 * `POST /auth/register` body (`backend/.../dto/register.schema.ts`).
 *
 * A discriminated union on `role`, mirroring the server's, and **`admin`
 * is not a member of it** (ADR-035 §5). Public administrator
 * self-registration is gone: the role carries `roles.manage` and
 * `settings.manageSystem`, so it is conferred by invitation from someone
 * who already holds `roles.manage`, never by filling in a form.
 *
 * The union is not merely cosmetic here. It makes an admin registration
 * *unrepresentable in the type system*, so a caller cannot construct one
 * to pass to `AuthService.register` — the compiler refuses before the
 * server has to.
 *
 * `acceptTerms`/`acceptPrivacy` are `z.literal(true)` server-side;
 * `users.terms_accepted_at` is NOT NULL, so a registration without them
 * cannot be recorded. `confirmPassword` stays on the client — the server
 * holds one password and has nothing to compare it against.
 */
interface RegisterAccountFields {
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone: string;
  readonly password: string;
  readonly acceptTerms: true;
  readonly acceptPrivacy: true;
}

/**
 * A doctor registration carries the professional block, all of it
 * required (ADR-035 §4).
 *
 * `professionalRegistrationNumber` replaces the old optional
 * `licenseNumber`. The rename is the point rather than tidying: it is a
 * professional identifier used for verification, and calling it a
 * "licence number" next to a password field invited exactly the confusion
 * ADR-035 §3 forbids. It is never a login credential — `LoginInput` below
 * has no field for it, and nothing on the server resolves an account by
 * it.
 */
export interface DoctorRegisterInput extends RegisterAccountFields {
  readonly role: 'doctor';
  readonly professionalRegistrationNumber: string;
  readonly professionalCategory: string;
  readonly specialty: string;
  /** `YYYY-MM-DD`. Optional — not every register issues a dated certificate. */
  readonly registrationExpiresOn?: string | undefined;
}

/** A patient registration is the account fields and nothing else (ADR-030 §4). */
export interface PatientRegisterInput extends RegisterAccountFields {
  readonly role: 'patient';
}

export type RegisterInput = DoctorRegisterInput | PatientRegisterInput;

/** `POST /auth/register` 201 body. Never a session — the address is unverified. */
export interface RegisterResult {
  readonly nextStep: 'verify-email';
  readonly email: string;
}

export interface AuthService {
  /**
   * Restore a session on boot, or `null` when there is none.
   * Mock: the persisted `localStorage`/`sessionStorage` snapshot.
   * HTTP: `POST /auth/refresh` against the httpOnly cookie — the silent
   * refresh the shell has always been specified to do (FE §6.3).
   */
  restore(): Promise<AuthSession | null>;

  login(input: LoginInput): Promise<LoginOutcome>;

  /** `POST /auth/otp/verify`. Resolves the session that completes the sign-in. */
  verifyOtp(code: string, pending: PendingSignIn | null): Promise<AuthSession | null>;

  /**
   * `POST /auth/otp/recovery` (owner decision R1) — completes the same
   * pending challenge with one single-use recovery code instead of the six
   * digits. Same success payload as `verifyOtp`; a wrong code is
   * `otp_invalid` and spends from the same attempt budget.
   */
  redeemRecoveryCode(
    recoveryCode: string,
    pending: PendingSignIn | null,
  ): Promise<AuthSession | null>;

  /** `POST /auth/otp/resend` — buys more time on the challenge. */
  resendOtp(pending: PendingSignIn | null): Promise<void>;

  /**
   * `POST /auth/verify-email`. Resolves a session ONLY on the mock path,
   * which signs the user straight in. The backend deliberately does not:
   * verification returns 204 and the user signs in afterwards, which is
   * what `VerifyEmailPage`'s "Continue to sign in" already renders.
   */
  verifyEmail(token: string, pending: PendingSignIn | null): Promise<AuthSession | null>;

  /** `POST /auth/verification/resend` — needs the address, not a token. */
  resendVerification(pending: PendingSignIn | null): Promise<void>;

  register(input: RegisterInput): Promise<RegisterResult>;

  /** Always resolves — never reveals whether an account exists. */
  forgotPassword(email: string): Promise<void>;

  resetPassword(token: string, password: string): Promise<void>;

  /**
   * Re-verify the signed-in user's password to leave the lock screen (A-07).
   *
   * Resolves with a session when the check produced a fresh one (the
   * `/auth/login` fallback), or `null` when it merely verified the password
   * for the held session. Rejects with `invalid_credentials` on a wrong
   * password, and with `ReauthLockoutError` when the guess reached the
   * lockout and the server revoked the session being unlocked.
   */
  reauthenticate(email: string, password: string): Promise<AuthSession | null>;

  /** `POST /auth/logout` — revokes the session and clears the cookie. */
  logout(): Promise<void>;

  /**
   * Make a session durable across reloads, honouring Remember Me.
   * Mock: writes the snapshot to local/session storage.
   * HTTP: a no-op — the httpOnly refresh cookie already is the durable
   * half, and `rememberMe` was sent to the server in the login body.
   */
  persist(session: AuthSession, rememberMe: boolean): void;

  /** Drop every trace of the session held on this client. */
  clear(): void;
}
