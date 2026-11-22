import { env } from '@/configs/env';

import { normalizeHttpError, normalizeNetworkError } from './errors';
import { malformedResponse } from './http';

/**
 * ApiClient — FRONTEND_ARCHITECTURE.md §10.1.
 * fetch-based transport with auth-header injection and normalized errors.
 * The access token lives in memory only (§6.2) and is set by the auth
 * feature via `setAccessToken`; no other module may read or store it.
 *
 * The 401 → single-flight refresh → replay interceptor is registered by the
 * auth feature via `setUnauthorizedHandler`.
 */

type UnauthorizedHandler = () => Promise<string | null>;

/** Per-request options a caller may pass alongside the path. */
export interface RequestOptions {
  /** Cancels the request — TanStack Query passes one to every `queryFn`. */
  readonly signal?: AbortSignal;
  /**
   * Sent as `Idempotency-Key` (API §0.5, ADR-014; RM M39.3). On a route the
   * server marks `@Idempotent()`, a repeat of the same request with the same
   * key returns the stored result instead of executing again. The caller
   * owns the key's lifetime: one key per *intent*, reused when that intent
   * is retried, never shared with a different request (the server answers
   * 422 `idempotency_key_reused`). A server that does not implement it
   * ignores the header, so the request behaves exactly as without it.
   */
  readonly idempotencyKey?: string;
  /**
   * Overrides the default 30 s timeout for this one request, in ms. Meant for
   * a request that is slow by nature — a multipart upload — not to paper over
   * a slow endpoint. A timeout ends the request exactly as before: aborted,
   * then reported as a network error.
   */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * The timeout for a multipart upload (`PUT /me/profile/photo`, `POST /files`;
 * the server accepts up to 10 MB). 30 s suits JSON but not a 10 MB body on a
 * slow uplink: at 1 Mbit/s the body alone takes ~84 s, so the default aborted
 * an upload that was still progressing. 120 s covers that case with headroom
 * and still ends a request that has truly stalled.
 */
export const UPLOAD_TIMEOUT_MS = 120_000;

interface TransportOptions {
  params?: Record<string, unknown>;
  body?: unknown;
  signal?: AbortSignal;
  idempotencyKey?: string;
  timeoutMs?: number;
}

/** The caller's options, minus the keys it left unset (exactOptionalPropertyTypes). */
function transportOptions(options: RequestOptions): TransportOptions {
  return {
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  };
}

/**
 * The 401 codes that mean "the access token is missing, expired or
 * revoked" — the only 401s a refresh can fix.
 *
 * The backend also answers 401 for ordinary business rejections: a wrong
 * password at `/auth/login` or `/me/password` (`invalid_credentials`) and a
 * wrong TOTP code (`otp_invalid`). Refreshing on those spent a rotation for
 * nothing and *replayed* the rejected POST, so a mistyped current password
 * reached the server twice. Its access-token guard throws
 * `AppException.unauthorized()`, whose code is `unauthorized`; a body with
 * no code at all (a proxy, or an older server) is treated the same way,
 * because assuming expiry is the safe reading when nothing says otherwise.
 */
const TOKEN_FAILURE_CODES: ReadonlySet<string> = new Set(['unauthorized']);

async function isTokenFailure(response: Response): Promise<boolean> {
  try {
    const body = (await response.clone().json()) as { readonly code?: unknown };
    return typeof body.code !== 'string' || TOKEN_FAILURE_CODES.has(body.code);
  } catch {
    return true;
  }
}

/**
 * A success body, read so that every failure still leaves as an `ApiError`
 * (FRONTEND_ARCHITECTURE §10.2). An empty body is `undefined`, as a 204 is —
 * the strict readers in `api/http.ts` refuse it where data was expected. A
 * body that is not JSON is `malformed_response`: an SPA host's catch-all
 * rewrite answers a mistyped `VITE_API_BASE_URL` with `200 index.html`, and
 * that used to escape as a raw `SyntaxError` no error state recognises. The
 * `ref` names no path, so no patient handle reaches an error report.
 */
async function readJsonBody<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (text.trim() === '') return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw malformedResponse('response body');
  }
}

export class ApiClient {
  private accessToken: string | null = null;
  private onUnauthorized: UnauthorizedHandler | null = null;
  private refreshInFlight: Promise<string | null> | null = null;

  constructor(private readonly baseUrl: string) {}

  /** Called exclusively by the auth feature. */
  setAccessToken(token: string | null): void {
    this.accessToken = token;
  }

  /** Registers the single-flight refresh handler (Phase 4). */
  setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
    this.onUnauthorized = handler;
  }

  get<T>(path: string, params?: Record<string, unknown>, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('GET', path, {
      ...(params === undefined ? {} : { params }),
      ...transportOptions(options),
    });
  }

  post<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('POST', path, { body, ...transportOptions(options) });
  }

  put<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('PUT', path, { body, ...transportOptions(options) });
  }

  patch<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('PATCH', path, { body, ...transportOptions(options) });
  }

  /**
   * A body on `DELETE` is unusual but deliberate where the API uses it: a
   * removal that must carry its reason (BR-DEC-003) keeps its verb.
   */
  delete<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('DELETE', path, {
      ...(body === undefined ? {} : { body }),
      ...transportOptions(options),
    });
  }

  private async request<T>(
    method: string,
    path: string,
    options: TransportOptions,
    isRetry = false,
  ): Promise<T> {
    const url = new URL(path.replace(/^\//, ''), `${this.baseUrl.replace(/\/?$/, '/')}`);
    if (options.params) {
      for (const [key, value] of Object.entries(options.params)) {
        if (
          (typeof value === 'string' && value !== '') ||
          typeof value === 'number' ||
          typeof value === 'boolean'
        ) {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const { signal } = options;
    const cancel = (): void => controller.abort();
    signal?.addEventListener('abort', cancel);

    let response: Response;
    try {
      // A request the caller cancelled is not a network failure: rethrow the
      // AbortError so TanStack Query treats it as a cancellation and never
      // renders an error state for a query nobody is waiting on any more.
      if (signal?.aborted === true) throw signal.reason;
      response = await fetch(url, {
        method,
        credentials: 'include', // httpOnly refresh cookie (§6.2)
        signal: controller.signal,
        headers: {
          Accept: 'application/json',
          'X-Correlation-Id': crypto.randomUUID(),
          // A multipart body sets its own Content-Type, boundary included;
          // naming one here would drop the boundary and the server could
          // not read the parts.
          ...(options.body !== undefined && !(options.body instanceof FormData)
            ? { 'Content-Type': 'application/json' }
            : {}),
          ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
          // Replayed unchanged by the 401 → refresh → retry path below, which
          // is what makes that retry safe on a route that already executed.
          ...(options.idempotencyKey === undefined
            ? {}
            : { 'Idempotency-Key': options.idempotencyKey }),
        },
        ...(options.body === undefined
          ? {}
          : {
              body: options.body instanceof FormData ? options.body : JSON.stringify(options.body),
            }),
      });
    } catch (error) {
      if (signal?.aborted === true) throw error;
      throw normalizeNetworkError();
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
    }

    if (
      response.status === 401 &&
      this.onUnauthorized &&
      !isRetry &&
      (await isTokenFailure(response))
    ) {
      const newToken = await this.refreshOnce();
      if (newToken) {
        return this.request<T>(method, path, options, true);
      }
    }

    if (!response.ok) {
      throw await normalizeHttpError(response);
    }

    if (response.status === 204) {
      return undefined as T;
    }
    return readJsonBody<T>(response);
  }

  /** Single-flight refresh: concurrent 401s share one refresh promise. */
  private async refreshOnce(): Promise<string | null> {
    if (!this.onUnauthorized) return null;
    this.refreshInFlight ??= this.onUnauthorized().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }
}

export const apiClient = new ApiClient(env.apiBaseUrl);
