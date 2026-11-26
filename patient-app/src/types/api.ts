/**
 * Transport shapes — the port of `frontend/src/types/api/index.ts`.
 *
 * Domain DTOs live in their feature's `model/`; only cross-feature
 * transport types belong here. Field names in both places are the
 * backend's verbatim (API contract §11: "field names are law"), because a
 * fourth client is a fourth place a name can drift (audit R-11).
 */

/** Standard success envelope. */
export interface ApiResponse<T> {
  readonly data: T;
}

/** Paginated collection envelope. */
export interface Paginated<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

/** Common list query parameters. */
export interface ListParams {
  readonly q?: string;
  readonly sort?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

/**
 * `kind` is the RENDERING decision — which of the eight error states to
 * show. `code` is the BRANCHING decision.
 *
 * Keeping both is not redundancy, it is the fix for a live defect in the
 * web client that this app must not inherit (audit §5, `REPO_AUDIT.md` §4
 * finding 3.2): a wrong password and an expired token are both `401`, and
 * a client that reads only the status treats a typo as a dead session and
 * logs the patient out. `code` is what tells `invalid_credentials` from
 * `unauthorized`. `client.ts` therefore refreshes on `kind: 'auth'` ONLY
 * when the code is absent or is a token code — never on a credentials
 * failure. `client.test.ts` ("does NOT refresh on 401 invalid_credentials" and the
 * `isTokenExpiryError` suite) is the assertion.
 *
 * Optional because a network failure has no envelope to carry one.
 */
interface ApiErrorBase {
  readonly code?: string;
}

/** Every failure leaving the API layer is one of these. */
export type ApiError = ApiErrorBase &
  (
    | {
        readonly kind: 'validation';
        readonly fieldErrors: Readonly<Record<string, string[]>>;
        /** The envelope's `detail`, when the server sent one. */
        readonly detail?: string;
      }
    | { readonly kind: 'auth' }
    | { readonly kind: 'forbidden' }
    | { readonly kind: 'not_found' }
    | { readonly kind: 'conflict'; readonly detail: string }
    | { readonly kind: 'rate_limited'; readonly retryAfterSeconds: number }
    | { readonly kind: 'network' }
    | { readonly kind: 'timeout' }
    | { readonly kind: 'cancelled' }
    | {
        readonly kind: 'server';
        readonly ref: string;
        /**
         * The HTTP status, when the failure was an HTTP response.
         * `normalizeHttpError` maps every status it has no case for to
         * `server` — a 405 or a 3xx as well as a 503 — so the kind alone
         * does not say "5xx". `isStaleDataSafeError` reads this.
         */
        readonly status?: number;
      }
  );

export type ApiErrorKind = ApiError['kind'];

export function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === 'object' && value !== null && 'kind' in value && typeof value.kind === 'string'
  );
}

/**
 * The backend's error codes that mean "your access token is no longer
 * good", as distinct from every other 401. Only these trigger a refresh.
 *
 * **One code, read from the backend rather than assumed (audit H1).**
 * Reconciled with `main`, which had added `unauthorized` at the front of
 * the old four-code list. The list is narrowed to that one code because
 * the backend source admits no other:
 *
 * - The access-token guard answers a missing, forged, expired or ended
 *   access token with `AppException.unauthorized()` and, for a dead
 *   session, `AppException.unauthorized('unauthorized', 'Session
 *   expired')` (`backend/src/modules/auth/guards/access-token.guard.ts`,
 *   lines 70, 73 and 95). `AppException.unauthorized`'s default code is
 *   `unauthorized` (`common/errors/app.exception.ts`), as is the default
 *   for any bare 401 (`defaultCodeForStatus`, `common/errors/error-codes.ts`).
 *   The authorization guard with no principal and `/auth/session` for an
 *   ended session send the same code (`shared/authz/authorization.guard.ts`,
 *   `modules/auth/services/session-user.service.ts`).
 * - `token_expired`, `unauthenticated` and `session_expired` appear
 *   nowhere in the backend's error codes (`common/errors/error-codes.ts`)
 *   or in any `AppException` it throws. Listing them changed nothing
 *   against the real API.
 * - `token_invalid` IS sent with a 401, but as a business rejection: an
 *   expired or forged 2FA re-enrolment token on
 *   `POST /me/2fa/reenroll/confirm` (`modules/auth/services/
 *   two-factor.service.ts`, `completeReenrollment`). Refreshing on it
 *   replayed that confirmation with a fresh access token, so it must NOT
 *   be listed. Its other uses (password reset, email verification,
 *   invitations) are 422s.
 *
 * The web client reached the same one-code set (`TOKEN_FAILURE_CODES` in
 * `frontend/src/api/client.ts`). The other 401 codes the backend sends —
 * `invalid_credentials`, `otp_invalid`, `token_invalid` — are about what
 * the patient typed and never trigger a refresh. `POST /auth/refresh`
 * also refuses with `unauthorized` (`modules/auth/services/
 * refresh.service.ts`, `expiredSession`); that request opts out with
 * `skipRefresh` and by path (`client.ts`), because a refresh refreshing
 * itself is a loop.
 */
export const TOKEN_ERROR_CODES: readonly string[] = ['unauthorized'];

/** Does this normalized error justify attempting a token refresh? */
export function isTokenExpiryError(error: ApiError): boolean {
  if (error.kind !== 'auth') return false;
  // No code at all: the safe reading is "token", because a bare 401 from
  // a guard is the token case and a credentials failure always carries
  // `invalid_credentials` (backend ADR-012).
  return error.code === undefined || TOKEN_ERROR_CODES.includes(error.code);
}
