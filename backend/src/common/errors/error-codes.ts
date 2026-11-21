/**
 * Machine error codes — the `code` field of the error envelope (API §0.3).
 *
 * Per ADR-012 these are stable machine identifiers: snake_case, never
 * localised, never reworded once shipped. The human-facing `message` may
 * change freely; `code` may not, because the frontend branches on it.
 *
 * The auth codes are transcribed verbatim from the frontend's
 * `types/auth/auth-error.ts` (`AuthErrorCode`). That union is the
 * contract — the pages branch on these strings on both the mock and the
 * HTTP path — so these must match it exactly.
 */

/** Authentication codes the auth pages branch on (API §1). */
export const AUTH_ERROR_CODES = [
  'invalid_credentials',
  'email_unverified',
  'otp_required',
  'otp_invalid',
  'email_taken',
  'token_invalid',
  'weak_password',
  'rate_limited',
  // ADR-035. Kept in the same order as the frontend union so the two
  // read as one list rather than two that happen to overlap.
  //
  // `account_inactive` — password correct, `users.status` not ACTIVE.
  // `two_factor_required` — an administrator with no enrolled factor.
  // `professional_number_taken` — a doctor signup whose registration
  //   number is already on another `doctors` row.
  'account_inactive',
  'two_factor_required',
  'professional_number_taken',
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

/**
 * Transport-level codes owned by this milestone. Domain modules add their
 * own as they land (e.g. `allergy_conflict`, `acknowledgment_required`,
 * `safety_check_unavailable` arrive with M13).
 */
export const COMMON_ERROR_CODES = [
  'validation_failed',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'internal_error',
  'service_unavailable',
  // Raised by the shared status-machine kernel (RM M2.3), so it belongs
  // to no single domain module: appointments, prescriptions, lab orders
  // and access requests all refuse illegal transitions through it.
  'invalid_status_transition',
  // Raised by the body parser before any handler runs (AST-G2, RM M37.1):
  // a body over the limit in `common/http/body-limits.ts`, and a charset
  // or content encoding it cannot decode.
  'payload_too_large',
  'unsupported_media_type',
] as const;

export type CommonErrorCode = (typeof COMMON_ERROR_CODES)[number];

export type ErrorCode = AuthErrorCode | CommonErrorCode | (string & {});

/**
 * Default code per status, used when a thrown error names none. Every
 * error leaving the API carries a code — a client that must branch on
 * failure should never have to parse a message to do it.
 */
export function defaultCodeForStatus(status: number): ErrorCode {
  switch (status) {
    case 400:
    case 422:
      return 'validation_failed';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 413:
      return 'payload_too_large';
    case 415:
      return 'unsupported_media_type';
    // `rate_limited` is shared: the auth module raises it on lockout
    // (API §1.2) and the global limiter raises it on any endpoint.
    case 429:
      return 'rate_limited';
    case 503:
      return 'service_unavailable';
    default:
      return 'internal_error';
  }
}
