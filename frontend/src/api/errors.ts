import type { ApiError } from '@/types/api';

/**
 * Error normalization — FRONTEND_ARCHITECTURE.md §10.2.
 * Every failure leaving the API layer is a normalized ApiError; nothing
 * downstream ever inspects raw Response objects or fetch exceptions.
 */

interface ErrorBody {
  readonly message?: string;
  readonly code?: string;
  readonly fieldErrors?: Record<string, string[]>;
  readonly detail?: string;
  readonly ref?: string;
}

/** Wraps a normalized ApiError in a real Error so thrown values are Error instances. */
function toThrowable(error: ApiError): ApiError & Error {
  return Object.assign(new Error(`API error: ${error.kind}`), error);
}

export async function normalizeHttpError(response: Response): Promise<ApiError & Error> {
  let body: ErrorBody = {};
  try {
    body = (await response.json()) as ErrorBody;
  } catch {
    // Non-JSON error body — fall through to status-based mapping.
  }

  // The envelope's machine code, preserved on every kind. Callers that
  // must tell two failures of the same status apart (the auth service is
  // the first) read it; everything else keeps branching on `kind` alone.
  const code = body.code === undefined ? {} : { code: body.code };

  switch (response.status) {
    case 400:
    case 422:
      return toThrowable({ ...code, kind: 'validation', fieldErrors: body.fieldErrors ?? {} });
    case 401:
      return toThrowable({ ...code, kind: 'auth' });
    case 403:
      return toThrowable({ ...code, kind: 'forbidden' });
    case 404:
      return toThrowable({ ...code, kind: 'not_found' });
    case 409:
      return toThrowable({
        ...code,
        kind: 'conflict',
        detail: body.detail ?? 'The resource was modified elsewhere.',
      });
    case 429: {
      const retryAfter = Number(response.headers.get('Retry-After') ?? '30');
      return toThrowable({
        ...code,
        kind: 'rate_limited',
        retryAfterSeconds: Number.isNaN(retryAfter) ? 30 : retryAfter,
      });
    }
    default:
      return toThrowable({ ...code, kind: 'server', ref: body.ref ?? `HTTP-${response.status}` });
  }
}

export function normalizeNetworkError(): ApiError & Error {
  return toThrowable({ kind: 'network' });
}

/**
 * What a failed write may honestly say when the failure is `network`.
 *
 * `network` covers a request that never left, one whose connection dropped
 * after it was sent, and `ApiClient`'s own 30-second timeout — and in the
 * last two the server may well have applied the write. "Nothing was changed"
 * is therefore a claim the client cannot make: a doctor told that about an
 * addendum that did save will write it again. This says what is known.
 */
export const NETWORK_WRITE_OUTCOME_UNKNOWN =
  'The server could not be reached, so it is not known whether this was saved. Check before trying again.';
