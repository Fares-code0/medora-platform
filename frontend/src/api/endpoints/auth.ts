import { ApiClient, apiClient } from '@/api/client';
import { env } from '@/configs/env';
import { isApiError } from '@/types/api';
import { AuthError, ReauthLockoutError, ROLES, UnsupportedRoleError } from '@/types/auth';
import type {
  AuthErrorCode,
  AuthService,
  AuthSession,
  LoginInput,
  LoginOutcome,
  Permission,
  PendingSignIn,
  RegisterInput,
  RegisterResult,
  Role,
  SessionUser,
} from '@/types/auth';

/**
 * The auth service over HTTP — FRONTEND_CHECKLIST §2 A-12, §6 DP-04.
 *
 * The live half of the seam, against `backend/src/modules/auth`. Read
 * `docs/handoff/auth-seam.md` for the contract mismatches this file
 * absorbs; the three that shape the code here are:
 *
 *  1. **The success envelope.** Every 2xx body is `{ data: … }` (the
 *     backend's `ResponseInterceptor`), and `ApiClient` does *not*
 *     unwrap it — `client.test.ts` asserts raw bodies. So the unwrap
 *     happens here, in `unwrap`, rather than in the shared transport
 *     where it would break every other feature's fixtures at once.
 *  2. **`code`, not status.** 401 `invalid_credentials` and 403
 *     `email_unverified` are both ordinary login failures, and their
 *     statuses normalize to two different `ApiError.kind`s — one of
 *     which every permission failure in the app also uses. `toAuthError`
 *     branches on the envelope's machine code instead.
 *  3. **A 2FA login is a success.** `POST /auth/login` answers
 *     `{ requiresOtp: true, otpToken }` with 200 and no cookie. The
 *     pages branch on a thrown `otp_required`, so `login` returns the
 *     outcome and `AuthProvider` does the throwing — see `LoginOutcome`.
 */

// ── The transport ───────────────────────────────────────────────────────

/**
 * A second, handler-free client used for `POST /auth/refresh` alone.
 *
 * **This is not a duplicate — it is what stops a deadlock.** `ApiClient`
 * routes any 401 through `refreshOnce()`, which memoizes the in-flight
 * refresh promise before awaiting it. If the refresh request itself went
 * through the same client and answered 401 (an expired or replayed
 * cookie — the common case), it would re-enter `refreshOnce()`, find the
 * promise it is *itself* the body of, and await it forever. The session
 * would hang rather than log out.
 *
 * Handler-free is also correct on its own terms: a failed refresh is
 * terminal by definition (backend ADR-013), so there is nothing a retry
 * could recover.
 */
const refreshClient = new ApiClient(env.apiBaseUrl);

/** Every successful body is `{ data: … }` (backend API §0.2). */
interface Envelope<T> {
  readonly data: T;
}

function unwrap<T>(envelope: Envelope<T>): T {
  return envelope.data;
}

// ── Response DTOs, transcribed from the backend ─────────────────────────

/** `LoginService.SessionUserPayload` — `role`/`permissions` are loose strings. */
interface SessionUserDto {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: string;
  readonly permissions: readonly string[];
}

/** `LoginService.AuthenticatedPayload` — login, otp/verify and refresh all return it. */
interface AuthenticatedPayloadDto {
  readonly user: SessionUserDto;
  readonly accessToken: string;
  readonly expiresIn: number;
}

interface OtpChallengeDto {
  readonly requiresOtp: true;
  readonly otpToken: string;
}

type LoginResponseDto = AuthenticatedPayloadDto | OtpChallengeDto;

function isOtpChallenge(body: LoginResponseDto): body is OtpChallengeDto {
  return 'requiresOtp' in body;
}

// ── Narrowing the backend's strings onto the frontend's unions ──────────

/**
 * The full `Permission` union (`types/auth`). Kept as a Set so an unknown
 * permission is *dropped* rather than fatal: the backend seeds 22 and the
 * frontend names 21, and a capability the UI cannot render is a feature
 * that has not shipped yet, not a reason to refuse the sign-in.
 */
const PERMISSIONS: ReadonlySet<string> = new Set<Permission>([
  'patients.view',
  'patients.revealIdentity',
  'records.view',
  'records.edit',
  'prescriptions.create',
  'labs.review',
  'appointments.manageOwn',
  'appointments.reassign',
  'appointments.cancelAdministratively',
  'messages.send',
  'communications.viewMetadata',
  'communications.viewContent',
  'communications.resolveFlags',
  'doctors.manage',
  'doctors.verify',
  'patients.manageAccounts',
  'roles.manage',
  'settings.manageSystem',
  'integrations.manage',
  'logs.view',
  'logs.export',
  'ai.use',
]);

function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/**
 * An unknown *role*, unlike an unknown permission, is fatal: the whole
 * route tree is selected by it, so there is no safe way to render a
 * session we cannot place. It is refused as `UnsupportedRoleError`, which
 * the login page names (DEC-013), and `adoptOrRefuse` closes the server
 * session the refusal would otherwise leave open.
 */
function toSessionUser(dto: SessionUserDto): SessionUser {
  if (!isRole(dto.role)) throw new UnsupportedRoleError(dto.role);
  return {
    id: dto.id,
    name: dto.name,
    email: dto.email,
    role: dto.role,
    permissions: dto.permissions.filter((p): p is Permission => PERMISSIONS.has(p)),
  };
}

function toSession(dto: AuthenticatedPayloadDto): AuthSession {
  return {
    user: toSessionUser(dto.user),
    accessToken: dto.accessToken,
    expiresIn: dto.expiresIn,
  };
}

// ── Error mapping ───────────────────────────────────────────────────────

const AUTH_CODES: ReadonlySet<string> = new Set<AuthErrorCode>([
  'invalid_credentials',
  'email_unverified',
  'otp_required',
  'otp_invalid',
  'email_taken',
  'token_invalid',
  'weak_password',
  'rate_limited',
  // ADR-035. Without these three the pages fall through to their generic
  // message and a suspended clinician is told "something went wrong",
  // which is exactly the case where a specific message matters.
  'account_inactive',
  'two_factor_required',
  'professional_number_taken',
]);

/**
 * Normalized `ApiError` → the coded `AuthError` the pages branch on.
 *
 * Errors already leave `ApiClient` normalized through `api/errors.ts`;
 * this only re-labels the ones the auth screens have a specific message
 * for. Anything else (network, server, an unrecognised code) is rethrown
 * untouched so the pages fall through to their generic message — the
 * same behaviour they have on the mock path for an unexpected throw.
 *
 * Exported for `endpoints/invitations.ts` (ADR-035 §5), which is a second
 * adapter over the same error vocabulary — a `token_invalid` from an
 * invitation must reach the page as the same `AuthError` a reset link
 * produces, and a second copy of this mapping would be a second thing to
 * keep in step.
 */
export function toAuthError(error: unknown): unknown {
  if (!isApiError(error)) return error;

  if (error.code !== undefined && AUTH_CODES.has(error.code)) {
    return new AuthError(error.code as AuthErrorCode);
  }

  // A validation failure on a password field is the policy talking
  // (backend `passwordPolicyErrors`); the reset screen renders it as a
  // weak-password error rather than as a generic one.
  if (error.kind === 'validation' && 'password' in error.fieldErrors) {
    return new AuthError('weak_password');
  }

  if (error.kind === 'rate_limited') return new AuthError('rate_limited');

  return error;
}

/** Runs `call`, mapping any auth-shaped failure onto an `AuthError`. */
async function mapErrors<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw toAuthError(error);
  }
}

// ── The service ─────────────────────────────────────────────────────────

/**
 * Adopts a session for the rest of the app: the access token goes into
 * `ApiClient`'s memory (FE §6.2 — nowhere else may hold it) so every
 * subsequent request carries it.
 */
function adopt(session: AuthSession): AuthSession {
  apiClient.setAccessToken(session.accessToken);
  return session;
}

/**
 * `adopt(toSession(dto))`, except for a role this client cannot place. The
 * server has already issued a session for it — an access token and the
 * httpOnly refresh cookie — so refusing it on screen and leaving it open
 * would keep a refresh cookie alive for a sign-in the user was told failed.
 * It is signed out, best-effort, before the refusal is thrown.
 */
async function adoptOrRefuse(dto: AuthenticatedPayloadDto): Promise<AuthSession> {
  try {
    return adopt(toSession(dto));
  } catch (error) {
    if (error instanceof UnsupportedRoleError) {
      apiClient.setAccessToken(dto.accessToken);
      await httpAuthService.logout();
    }
    throw error;
  }
}

/** The shared in-flight refresh — see `restore` for why it must be shared. */
let restoreInFlight: Promise<AuthSession | null> | null = null;

async function runRestore(): Promise<AuthSession | null> {
  try {
    const body = await refreshClient.post<Envelope<AuthenticatedPayloadDto>>('/auth/refresh');
    return await adoptOrRefuse(unwrap(body));
  } catch (error) {
    if (isApiError(error) && (error.kind === 'auth' || error.kind === 'network')) return null;
    throw error;
  }
}

export const httpAuthService: AuthService = {
  /**
   * Boot restore is a refresh: the access token lives in memory and did
   * not survive the reload, but the httpOnly cookie did. A 401 here is
   * the ordinary "no session" answer, not an error worth surfacing.
   *
   * Single-flight, and that is load-bearing rather than an optimization.
   * The backend rotates the refresh token on every use and treats the
   * previous one, re-presented, as theft — revoking the whole session
   * family. So two *concurrent* restores do not merely waste a request:
   * the second replays the token the first just retired and logs the user
   * out. React's `StrictMode` double-invokes the provider's boot effect in
   * development, which is exactly that scenario, and it was observed
   * against the live API before this guard existed.
   */
  restore(): Promise<AuthSession | null> {
    restoreInFlight ??= runRestore().finally(() => {
      restoreInFlight = null;
    });
    return restoreInFlight;
  },

  async login(input: LoginInput): Promise<LoginOutcome> {
    return mapErrors(async () => {
      const body = await apiClient.post<Envelope<LoginResponseDto>>('/auth/login', {
        email: input.email,
        password: input.password,
        rememberMe: input.rememberMe,
      });
      const payload = unwrap(body);

      if (isOtpChallenge(payload)) {
        return { kind: 'otp', otpToken: payload.otpToken };
      }
      return { kind: 'session', session: await adoptOrRefuse(payload) };
    });
  },

  async verifyOtp(code: string, pending: PendingSignIn | null): Promise<AuthSession> {
    // The challenge handle, not the code, is what identifies the sign-in
    // being completed. Without it there is nothing to complete.
    if (!pending?.otpToken) throw new AuthError('otp_invalid', 'No challenge in progress');

    return mapErrors(async () => {
      const body = await apiClient.post<Envelope<AuthenticatedPayloadDto>>('/auth/otp/verify', {
        otpToken: pending.otpToken,
        code,
      });
      return adoptOrRefuse(unwrap(body));
    });
  },

  /**
   * Owner decision R1 — served only by an API built from `backend`
   * (`8992a208`). The code is sent trimmed and otherwise as typed: the
   * server normalises case, spaces and the dash, and a value not shaped
   * like a code is an ordinary wrong code (401 `otp_invalid`), never a 422
   * that would tell a guesser which inputs are worth trying. Against an API
   * without the route the 404 reaches the page untouched, which names it
   * as a failure it could not complete, not as a wrong code.
   */
  async redeemRecoveryCode(
    recoveryCode: string,
    pending: PendingSignIn | null,
  ): Promise<AuthSession> {
    if (!pending?.otpToken) throw new AuthError('otp_invalid', 'No challenge in progress');

    return mapErrors(async () => {
      const body = await apiClient.post<Envelope<AuthenticatedPayloadDto>>('/auth/otp/recovery', {
        otpToken: pending.otpToken,
        recoveryCode: recoveryCode.trim(),
      });
      return adoptOrRefuse(unwrap(body));
    });
  },

  async resendOtp(pending: PendingSignIn | null): Promise<void> {
    if (!pending?.otpToken) throw new AuthError('otp_invalid', 'No challenge in progress');
    await mapErrors(() => apiClient.post<void>('/auth/otp/resend', { otpToken: pending.otpToken }));
  },

  /**
   * Verification does not sign anyone in — the backend answers 204 and
   * the user signs in afterwards. Returning `null` is what routes
   * `VerifyEmailPage` to its "Continue to sign in" state.
   */
  async verifyEmail(token: string): Promise<AuthSession | null> {
    await mapErrors(() => apiClient.post<void>('/auth/verify-email', { token }));
    return null;
  },

  async resendVerification(pending: PendingSignIn | null): Promise<void> {
    // Takes an address, not a token: the user is on this page precisely
    // because they never opened the first message.
    if (!pending?.email) {
      throw new AuthError('token_invalid', 'No address to resend a verification to');
    }
    await mapErrors(() =>
      apiClient.post<void>('/auth/verification/resend', { email: pending.email }),
    );
  },

  /**
   * `POST /auth/register` (ADR-035 §4).
   *
   * The professional block is spread only on the doctor branch, and the
   * discriminant is what makes that safe — a patient body cannot carry a
   * registration number even by accident, because the union has no field
   * for one to come from.
   *
   * `registrationExpiresOn` is dropped when empty rather than sent as
   * `''`: the form's date input yields an empty string when untouched,
   * and the server's schema is `.optional()`, not "optional or blank".
   */
  async register(input: RegisterInput): Promise<RegisterResult> {
    return mapErrors(async () => {
      const body = await apiClient.post<Envelope<RegisterResult>>('/auth/register', {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
        password: input.password,
        role: input.role,
        acceptTerms: input.acceptTerms,
        acceptPrivacy: input.acceptPrivacy,
        ...(input.role === 'doctor'
          ? {
              professionalRegistrationNumber: input.professionalRegistrationNumber,
              professionalCategory: input.professionalCategory,
              specialty: input.specialty,
              ...(input.registrationExpiresOn === undefined || input.registrationExpiresOn === ''
                ? {}
                : { registrationExpiresOn: input.registrationExpiresOn }),
            }
          : {}),
      });
      return unwrap(body);
    });
  },

  async forgotPassword(email: string): Promise<void> {
    await mapErrors(() =>
      apiClient.post<Envelope<{ accepted: true }>>('/auth/forgot-password', { email }),
    );
  },

  async resetPassword(token: string, password: string): Promise<void> {
    await mapErrors(() => apiClient.post<void>('/auth/reset-password', { token, password }));
  },

  /**
   * `POST /me/password/verify` — the lock screen's re-authentication
   * (A-12a, `docs/handoff/auth-seam.md` §4.1). Served only by an API built
   * from `backend` (commit `4c6458d9`).
   *
   * It checks the password **for the session that is already open** and
   * answers 204 with no token and no cookie, so it resolves `null` and the
   * held session resumes. A two-factor account unlocks in place: the
   * session already passed its second factor at sign-in.
   *
   *  · 401 `invalid_credentials` — a wrong password. It is not a token
   *    failure, so `ApiClient` does not spend a refresh on it (M39.4).
   *  · 429 — the guess reached the sign-in lockout, which this route
   *    shares, and the server **revoked this session**. The access token
   *    is dropped here and {@link ReauthLockoutError} tells the lock
   *    screen there is nothing left to unlock.
   *  · 404 — an API built from `main`, which has no such route. Unlocking
   *    falls back to what it spent before the route existed: a real
   *    `POST /auth/login`, which checks the password but mints a second
   *    session, and which cannot complete a two-factor account
   *    (`otp_required`). The fallback goes when `backend` reaches `main`.
   */
  async reauthenticate(email: string, password: string): Promise<AuthSession | null> {
    try {
      await apiClient.post<void>('/me/password/verify', { password });
      return null;
    } catch (error) {
      if (isApiError(error) && error.kind === 'not_found') {
        const outcome = await this.login({ email, password, rememberMe: false });
        if (outcome.kind === 'otp') throw new AuthError('otp_required');
        return outcome.session;
      }
      if (isApiError(error) && error.kind === 'rate_limited') {
        apiClient.setAccessToken(null);
        throw new ReauthLockoutError();
      }
      throw toAuthError(error);
    }
  },

  async logout(): Promise<void> {
    try {
      await apiClient.post<void>('/auth/logout');
    } catch {
      // A logout that fails server-side must still end the session on
      // this client — the alternative is a user who pressed "Log out"
      // and stayed signed in. The cookie is cleared by the endpoint when
      // it is reachable; `clear()` below drops the access token either way.
    } finally {
      apiClient.setAccessToken(null);
    }
  },

  /**
   * Nothing to do: the httpOnly refresh cookie is the durable half of
   * the session and only the server can write it, and `rememberMe`
   * already reached it in the login body, where it chose the TTL.
   */
  persist(): void {},

  clear(): void {
    apiClient.setAccessToken(null);
  },
};
