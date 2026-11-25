import { env } from '@/configs/env';
import { ResponseContractError } from '@/schemas/envelope';
import { isApiError, isTokenExpiryError, type ApiError } from '@/types/api';
import { randomId } from '@/utils/id';
import { logger } from '@/utils/logger';

import {
  normalizeCancellationError,
  normalizeHttpError,
  normalizeNetworkError,
  normalizeTimeoutError,
} from './errors';

/**
 * `ApiClient` — the whole network surface of this app.
 *
 * A screen never calls `fetch`. A component never calls anything that
 * does. Everything goes screen -> hook -> service -> endpoint -> here,
 * and this is the only module that knows a network exists
 * (docs/ARCHITECTURE.md §3).
 *
 * ── What is different from the web client, and why ───────────────────
 *
 * **Mobile refresh.** The backend already supports it: sending
 * `X-Client-Type: mobile` makes `/auth/refresh` return the refresh token
 * in the response BODY instead of an httpOnly cookie
 * (`auth.controller.ts:285`, `auth-refresh.e2e-spec.ts:250`). That is why
 * the header is unconditional here and `credentials` is not set — a
 * mobile client has no cookie jar to rely on and must not appear to.
 *
 * **401 is a token, and only a token.** The web client refreshes on any
 * 401, which turns a mistyped password into a forced logout (audit §5).
 * Here a 401 triggers a refresh only when `isTokenExpiryError` says the
 * envelope's `code` is a token code. A `401 invalid_credentials` is
 * returned to the caller untouched.
 *
 * **Single-flight refresh.** Ten screens waking from background produce
 * ten 401s and exactly one refresh; the rest await the same promise and
 * replay. A second refresh with an already-rotated token would trip the
 * backend's reuse detection and revoke the whole session family
 * (ADR-026) — logging the patient out for being on a train.
 *
 * **Timeout and cancellation are different outcomes.** A screen unmounting
 * mid-request aborts it; that is not an error the patient should see.
 *
 * **Retries belong to the caller.** This client retries nothing on its
 * own. The query layer (`query-client.ts`) owns the retry policy, because
 * only it knows whether a call is a safe read or a booking that must not
 * be issued twice.
 */

/**
 * Resolves to a fresh access token, or null when the session is over.
 *
 * **Rejecting with an `ApiError` or a `ResponseContractError` means
 * neither**: the refresh got no usable answer (no signal, a timeout, a
 * 5xx, a captive portal's page), so nothing is known about the session.
 * The waiting requests fail with that error — a screen shows "can't
 * reach Medora" with Retry — and session loss is NOT notified.
 * Any other rejection is a defect in the handler and is treated as null,
 * so a broken handler cannot leave a session that 401s on every call.
 */
type RefreshHandler = () => Promise<string | null>;

/** Called once when a refresh fails: the session is gone. */
type SessionLostHandler = () => void;

/**
 * Called with the headers of every response, successful or not.
 *
 * The forced-upgrade gate (W-06) reads `X-Minimum-App-Version` off calls
 * the client was making anyway, so the operator's floor arrives without a
 * version endpoint — there is none in the contract, and inventing one is
 * forbidden. The deprecation notice (W-07) reads `Deprecation` and
 * `Sunset` off the same responses. Observers must not throw and must not
 * block: this runs on the response path of every request.
 *
 * There is a SET of them rather than one slot. Two features already
 * listen, and a single slot means whichever mounts second silently
 * unhooks the first — a forced-upgrade gate that stops working because
 * somebody added a banner is exactly the failure this API shape must not
 * allow.
 */
type ResponseObserver = (headers: Headers) => void;

const DEFAULT_TIMEOUT_MS = 30_000;

export interface RequestOptions {
  readonly params?: Record<string, unknown>;
  readonly body?: unknown;
  /**
   * Caller-owned cancellation — a screen unmounting, a search box
   * superseding its own in-flight request.
   */
  readonly signal?: AbortSignal;
  /**
   * ADR-014 / API §0.5. Set on any state-changing POST that must not be
   * applied twice if the response is lost. Accepted by the backend today,
   * not yet enforced — sending it is still correct and costs nothing.
   */
  readonly idempotencyKey?: string;
  readonly timeoutMs?: number;
  /**
   * Never refresh on this request's own 401. Set by `POST /auth/refresh`
   * alone: it refuses a dead session with the same `unauthorized` code the
   * access-token guard uses, and a refresh that answered its own 401 by
   * refreshing would wait on itself for ever. `isRefreshPath` below is the
   * second, path-based guard for the same case; either one is enough.
   */
  readonly skipRefresh?: boolean;
}

/**
 * A success body, read so a body that is not JSON fails like any other
 * response that does not match its contract. It used to escape as a raw
 * `SyntaxError` from `response.json()`, which no error state recognises; a
 * captive portal or a misrouted proxy answers `200` with an HTML page, which
 * is the realistic case on a phone. An empty body reads as `undefined`, as a
 * 204 does — every endpoint parses its envelope, so where data was expected
 * that still fails its contract. Logged like `parseResponse`: the endpoint,
 * never the body.
 */
async function readJsonBody<T>(response: Response, path: string): Promise<T> {
  const text = await response.text();
  if (text.trim() === '') return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    const endpoint = path.split('?')[0] ?? path;
    logger.error('Response body was not JSON', { endpoint });
    throw new ResponseContractError(endpoint, ['(body): not JSON']);
  }
}
export class ApiClient {
  private accessToken: string | null = null;
  private onRefresh: RefreshHandler | null = null;
  private onSessionLost: SessionLostHandler | null = null;
  private readonly responseObservers = new Set<ResponseObserver>();
  private refreshInFlight: Promise<string | null> | null = null;
  /** The refresh whose refusal was already reported as a session loss. */
  private sessionLostReportedFor: Promise<string | null> | null = null;
  /**
   * Which session a request was sent under (A-P3). Captured when a request
   * is sent and compared when its 401 arrives: a request whose session has
   * since ended must not refresh the session that replaced it, nor be
   * replayed carrying that session's token.
   *
   * It moves on at a session BOUNDARY, which `setAccessToken` sees as the
   * token going to or coming from null: every teardown clears the token
   * (`endSessionNow`), every sign-in or restore installs one from nothing,
   * and a different account adopted by a refresh is cleared first. A
   * same-session rotation (token to token) does not move it, so a 401
   * that lands after its own session's refresh still refreshes and replays
   * as it always did.
   */
  private sessionGeneration = 0;

  constructor(private readonly baseUrl: string) {}

  /**
   * Set exclusively by the auth feature. The access token lives here, in
   * memory, and nowhere else — never in secure storage, never in a
   * preference store, never in a log (checklist T-02).
   */
  setAccessToken(token: string | null): void {
    if (token === null || this.accessToken === null) this.sessionGeneration += 1;
    this.accessToken = token;
  }

  hasAccessToken(): boolean {
    return this.accessToken !== null;
  }

  setRefreshHandler(handler: RefreshHandler | null): void {
    this.onRefresh = handler;
  }

  setSessionLostHandler(handler: SessionLostHandler | null): void {
    this.onSessionLost = handler;
  }

  /**
   * Registers an observer and hands back the way to remove it. See
   * `ResponseObserver` for why this adds rather than replaces.
   */
  addResponseObserver(observer: ResponseObserver): () => void {
    this.responseObservers.add(observer);
    return () => {
      this.responseObservers.delete(observer);
    };
  }

  get<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('GET', path, options);
  }

  post<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('POST', path, { ...options, body });
  }

  put<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('PUT', path, { ...options, body });
  }

  patch<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('PATCH', path, { ...options, body });
  }

  delete<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.request<T>('DELETE', path, options);
  }

  /**
   * Query parameters are strings, numbers and booleans. An object
   * stringifies to `[object Object]`, which is a silently wrong filter
   * rather than an error, so it is dropped instead.
   */
  private static queryValue(value: unknown): string | null {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'boolean') return String(value);
    return null;
  }

  private buildUrl(path: string, params?: Record<string, unknown>): string {
    const base = this.baseUrl.replace(/\/?$/, '/');
    const url = new URL(path.replace(/^\//, ''), base);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        // Undefined, null and '' are "not set", not "set to empty" —
        // sending `?q=` makes an empty search box a filter.
        if (value === undefined || value === null || value === '') continue;
        if (Array.isArray(value)) {
          for (const item of value) {
            const encoded = ApiClient.queryValue(item);
            if (encoded !== null) url.searchParams.append(key, encoded);
          }
        } else {
          const encoded = ApiClient.queryValue(value);
          if (encoded !== null) url.searchParams.set(key, encoded);
        }
      }
    }
    return url.toString();
  }

  private buildHeaders(options: RequestOptions): Record<string, string> {
    return {
      Accept: 'application/json',
      // Makes /auth/refresh return the refresh token in the body rather
      // than a Set-Cookie a mobile client cannot store.
      'X-Client-Type': 'mobile',
      'X-Correlation-Id': randomId(),
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
      ...(this.accessToken ? { Authorization: `Bearer ${this.accessToken}` } : {}),
    };
  }

  private async request<T>(
    method: string,
    path: string,
    options: RequestOptions,
    isReplay = false,
  ): Promise<T> {
    // Already cancelled: an `abort` event that fired before the listener
    // below exists would never reach it, and the request would go out.
    if (options.signal?.aborted) throw normalizeCancellationError();

    const url = this.buildUrl(path, options.params);
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    // Two independent reasons to abort, one signal. `timedOut` is how the
    // catch block tells them apart — an AbortError carries no reason it
    // can rely on across engines.
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onCallerAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onCallerAbort);

    // In the same synchronous step as the headers below, so it names the
    // session whose token the request carries.
    const sentGeneration = this.sessionGeneration;
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        signal: controller.signal,
        headers: this.buildHeaders(options),
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      });
    } catch {
      if (timedOut) throw normalizeTimeoutError();
      if (options.signal?.aborted) throw normalizeCancellationError();
      throw normalizeNetworkError();
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onCallerAbort);
    }

    // Before the ok/not-ok fork, so an operator can raise the floor on a
    // client whose every call is failing — which is one of the states a
    // forced upgrade exists to rescue.
    this.notifyResponse(response.headers);

    if (!response.ok) {
      const error = await normalizeHttpError(response);

      // Never in answer to the refresh call itself: its 401 means the
      // refresh token is spent, and `refreshOnce` would hand that request
      // its own in-flight promise to wait on. Two guards for it: the
      // caller's explicit `skipRefresh`, and the path itself.
      const refreshable =
        !isReplay &&
        options.skipRefresh !== true &&
        !isRefreshPath(path) &&
        this.onRefresh !== null &&
        isApiError(error) &&
        isTokenExpiryError(error);

      if (refreshable) {
        // Sent under a session that has since ended (A-P3): its 401 says
        // nothing about the current one. No refresh, no replay with the
        // current session's token, no session loss — this request alone
        // stops, quietly.
        if (sentGeneration !== this.sessionGeneration) throw normalizeCancellationError();
        // A refresh that could not reach the server rejects here with its
        // transport error, which propagates to the caller and skips the
        // session-loss notification below (see `RefreshHandler`).
        const refresh = this.refreshOnce();
        const token = await refresh;
        // The session changed while the refresh ran (a sign-out, or a
        // refresh that came back as a different account): the same rule.
        if (sentGeneration !== this.sessionGeneration) throw normalizeCancellationError();
        if (token !== null) {
          return this.request<T>(method, path, options, true);
        }
        // One notification, however many requests raced the refresh: every
        // waiter holds the same promise, and only the first to land here
        // reports it.
        if (this.sessionLostReportedFor !== refresh) {
          this.sessionLostReportedFor = refresh;
          this.onSessionLost?.();
        }
      }
      throw error;
    }

    if (response.status === 204) {
      return undefined as T;
    }
    return readJsonBody<T>(response, path);
  }

  /**
   * An observer must never take the request down with it. A gate that
   * threw would turn a cosmetic upgrade banner into a failed API call.
   */
  private notifyResponse(headers: Headers): void {
    // Copied before iterating: an observer that unsubscribes itself
    // while being notified must not disturb the ones after it.
    for (const observer of [...this.responseObservers]) {
      try {
        observer(headers);
      } catch {
        // Deliberately swallowed, per observer. Nothing here is
        // load-bearing for the response the caller is waiting on, and
        // one bad observer must not silence the others.
      }
    }
  }

  /**
   * Concurrent 401s share one refresh promise — its outcome too, so a
   * refresh that could not reach the server fails every waiter with the
   * same transport error rather than one of them ending the session.
   */
  private refreshOnce(): Promise<string | null> {
    const handler = this.onRefresh;
    if (!handler) return Promise.resolve(null);
    this.refreshInFlight ??= handler()
      .catch((error: unknown) => {
        // A contract failure is an answer that was not the API's — a
        // captive portal's 200 HTML page — so it is "unreachable" too.
        if (isApiError(error) || error instanceof ResponseContractError) throw error;
        return null;
      })
      .finally(() => {
        this.refreshInFlight = null;
      });
    return this.refreshInFlight;
  }
}

/** `auth/refresh`, however the caller spelled the leading slash. */
function isRefreshPath(path: string): boolean {
  return path.replace(/^\/+/, '').split('?')[0] === 'auth/refresh';
}

export const apiClient = new ApiClient(env.apiBaseUrl);

export type { ApiError };
