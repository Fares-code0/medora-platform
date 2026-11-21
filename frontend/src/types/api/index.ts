/**
 * API envelope and infrastructure types — FRONTEND_ARCHITECTURE.md §9.1.
 * DTO types for specific domains live in their feature `model/` folders;
 * only cross-feature transport shapes belong here.
 */

/** Standard success envelope returned by the Medora API. */
export interface ApiResponse<T> {
  readonly data: T;
}

/** Paginated collection envelope — matches P1 table + Pagination contracts. */
export interface Paginated<T> {
  readonly items: readonly T[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

/** Common list query parameters mirrored in URL state (UX 1.3). */
export interface ListParams {
  readonly q?: string;
  readonly sort?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

/**
 * Carried by every normalized error, alongside its `kind`.
 *
 * `kind` is the *rendering* decision (which error state to show); `code`
 * is the *branching* decision. The backend's error envelope always
 * carries a stable machine code (its ADR-012), and `kind` alone cannot
 * replace it: a wrong password and an unverified address are both
 * failures on the same form but arrive as 401 `invalid_credentials` and
 * 403 `email_unverified` — two different `kind`s, and the second shares
 * its `kind` with every unrelated permission failure in the app.
 *
 * Optional because a network failure has no envelope to read one from.
 */
interface ApiErrorBase {
  readonly code?: string;
}

/**
 * Normalized API error — FRONTEND_ARCHITECTURE.md §10.2.
 * Every failure leaving the API layer is one of these; rendering rules
 * map 1:1 to the DS/UX error states.
 */
export type ApiError = ApiErrorBase &
  (
    | { readonly kind: 'validation'; readonly fieldErrors: Readonly<Record<string, string[]>> }
    | { readonly kind: 'auth' }
    | { readonly kind: 'forbidden' }
    | { readonly kind: 'not_found' }
    | { readonly kind: 'conflict'; readonly detail: string }
    | { readonly kind: 'rate_limited'; readonly retryAfterSeconds: number }
    | { readonly kind: 'network' }
    | { readonly kind: 'server'; readonly ref: string }
  );

/** Type guard: is this unknown thrown value a normalized ApiError? */
export function isApiError(value: unknown): value is ApiError {
  return (
    typeof value === 'object' && value !== null && 'kind' in value && typeof value.kind === 'string'
  );
}
