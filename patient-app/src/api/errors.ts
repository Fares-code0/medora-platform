import { isApiError, type ApiError } from '@/types/api';

/**
 * Error normalisation. Nothing downstream of this module ever sees a
 * `Response`, a fetch rejection or an `AbortError`.
 *
 * The one behavioural difference from `frontend/src/api/errors.ts` is
 * deliberate and is the whole reason this file was ported rather than
 * copied: `code` is preserved on every kind, and `timeout`/`cancelled`
 * are separated from `network`. A patient on a train needs "we couldn't
 * reach Medora" and a patient who backed out of a screen needs nothing at
 * all; collapsing both into one kind produces an error toast for a
 * navigation the patient performed on purpose.
 */

interface ErrorBody {
  readonly message?: string;
  readonly code?: string;
  readonly fieldErrors?: Record<string, string[]>;
  readonly detail?: string;
  readonly ref?: string;
}

/** Wraps a normalized ApiError in a real Error so thrown values are Errors. */
function toThrowable(error: ApiError): ApiError & Error {
  return Object.assign(new Error(`API error: ${error.kind}`), error);
}

export async function normalizeHttpError(response: Response): Promise<ApiError & Error> {
  let body: ErrorBody = {};
  try {
    const parsed: unknown = await response.json();
    // `null` is valid JSON and not an object; reading `.code` off it threw.
    if (typeof parsed === 'object' && parsed !== null) body = parsed;
  } catch {
    // Non-JSON body (a proxy's HTML 502, an empty 401) — fall through to
    // the status mapping. Never surface the raw text: it can carry
    // upstream detail that has no business in a patient-facing message.
  }

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
        detail: body.detail ?? 'This was changed somewhere else. Reload and try again.',
      });
    case 429: {
      const header = response.headers.get('Retry-After');
      const retryAfter = Number(header ?? '30');
      return toThrowable({
        ...code,
        kind: 'rate_limited',
        retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : 30,
      });
    }
    default:
      return toThrowable({
        ...code,
        kind: 'server',
        ref: body.ref ?? `HTTP-${response.status}`,
        status: response.status,
      });
  }
}

/**
 * May records already on screen stay there after a REFRESH failed this way?
 *
 * Deliberately not `shouldRetry` and not `ErrorState`'s Retry rule: those
 * answer "can trying again help", this answers "is what the patient is
 * reading still the server's answer". They differ in both directions —
 * a 429 offers no Retry button (the patient must wait) but says nothing
 * against the cached records, and an unrecognised failure may be worth a
 * retry but is no evidence the cache is still good.
 *
 * Only failures that say "the server could not be asked" qualify:
 * network, timeout, rate limiting, and a real 5xx. A `server` error
 * without a 5xx status is a status `normalizeHttpError` had no case for,
 * not a known outage, and fails closed — as do refusals (auth, forbidden,
 * not found), unavailable endpoints, response-contract errors and
 * anything that is not a normalized `ApiError`.
 */
export function isStaleDataSafeError(error: unknown): boolean {
  if (!isApiError(error)) return false;
  switch (error.kind) {
    case 'network':
    case 'timeout':
    case 'rate_limited':
      return true;
    case 'server':
      return error.status !== undefined && error.status >= 500 && error.status <= 599;
    case 'validation':
    case 'auth':
    case 'forbidden':
    case 'not_found':
    case 'conflict':
    case 'cancelled':
      return false;
  }
  // Unreachable for a typed ApiError, but `isApiError` only checks that
  // `kind` is a string: a foreign `{ kind: 'foo' }` lands here and must
  // fail closed with a real boolean.
  return false;
}

export function normalizeNetworkError(): ApiError & Error {
  return toThrowable({ kind: 'network' });
}

export function normalizeTimeoutError(): ApiError & Error {
  return toThrowable({ kind: 'timeout' });
}

export function normalizeCancellationError(): ApiError & Error {
  return toThrowable({ kind: 'cancelled' });
}
