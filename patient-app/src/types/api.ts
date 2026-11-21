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
 * `token_expired`. `client.ts` therefore refreshes on `kind: 'auth'` ONLY
 * when the code is absent or is a token code — never on a credentials
 * failure. `errors.test.ts` is the assertion.
 *
 * Optional because a network failure has no envelope to carry one.
 */
interface ApiErrorBase {
  readonly code?: string;
}

/** Every failure leaving the API layer is one of these. */
export type ApiError = ApiErrorBase &
  (
    | { readonly kind: 'validation'; readonly fieldErrors: Readonly<Record<string, string[]>> }
    | { readonly kind: 'auth' }
    | { readonly kind: 'forbidden' }
    | { readonly kind: 'not_found' }
    | { readonly kind: 'conflict'; readonly detail: string }
    | { readonly kind: 'rate_limited'; readonly retryAfterSeconds: number }
    | { readonly kind: 'network' }
    | { readonly kind: 'timeout' }
    | { readonly kind: 'cancelled' }
    | { readonly kind: 'server'; readonly ref: string }
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
 * `unauthorized` is the one the backend actually sends: its access-token
 * guard throws `AppException.unauthorized()` for a missing, expired or
 * revoked token (`access-token.guard.ts`), and that code is used for no
 * business rejection — a wrong password is `invalid_credentials`, a wrong
 * code `otp_invalid`. The web client refreshes on the same code.
 */
export const TOKEN_ERROR_CODES: readonly string[] = [
  'unauthorized',
  'token_expired',
  'token_invalid',
  'unauthenticated',
  'session_expired',
];

/** Does this normalized error justify attempting a token refresh? */
export function isTokenExpiryError(error: ApiError): boolean {
  if (error.kind !== 'auth') return false;
  // No code at all: the safe reading is "token", because a bare 401 from
  // a guard is the token case and a credentials failure always carries
  // `invalid_credentials` (backend ADR-012).
  return error.code === undefined || TOKEN_ERROR_CODES.includes(error.code);
}
