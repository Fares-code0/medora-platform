import { isApiError } from '@/types/api';

/**
 * Did `/auth/refresh` reject the token, or did the request simply not
 * get an answer the token can be judged by?
 *
 * The two used to be one outcome. Every failure of a refresh — a 401,
 * but also no signal, a timeout, a 502 from a proxy — ended the session
 * and **deleted the refresh token from the keychain**. A patient who
 * opened the app in a lift was signed out for good and told their
 * session had expired, which it had not.
 *
 * Only the server can say a session is over, and `/auth/refresh` says it
 * one way: **401**. Every dead-session case in
 * `backend/src/modules/auth/services/refresh.service.ts` — an unknown or
 * replayed token, a lost rotation race, an account suspended or deleted
 * since sign-in — answers `401 unauthorized`, and the route is
 * `@Public()` with no request schema and no rate limit, so it has no
 * other refusal to give.
 *
 * | Outcome | Kinds | Meaning |
 * |---|---|---|
 * | **Rejected** | `auth` (401) with code `unauthorized` | The token cannot be used again. The session is over. |
 * | **No answer** | everything else — `network`, `timeout`, `server`, `rate_limited`, `cancelled`, `forbidden` (403), `validation` (400/422), a 401 without the code `unauthorized`, anything that is not an `ApiError` | Nothing is known about the token. It stays in the keychain. |
 *
 * **The code is part of the refusal.** Every refusal this route can give
 * is `AppException.unauthorized('unauthorized', 'Session expired')` —
 * `expiredSession()` in `refresh.service.ts`, and the controller's own
 * no-token branch in `auth.controller.ts` `refresh` — and the exception
 * filter always serialises it as `{ message, code }`
 * (`common/http/all-exceptions.filter.ts`, `buildBody`). A 401 without
 * that code (an empty or HTML body, another code) did not come from this
 * route's contract: it came from something in front of it, and is treated
 * the same way as the 403 below.
 *
 * 403, 400 and 422 are on the "no answer" side because the API never
 * sends them from this route (audit M3). One that arrives came from
 * something in front of it — a WAF challenge, a CDN, a load balancer —
 * and deleting a patient's sign-in on a middlebox's say-so is the defect
 * this file exists to prevent. If the contract ever adds a refusal, it
 * is added here with the contract change.
 *
 * This does not change the authentication contract. It changes only
 * what the app infers from an answer.
 */
export function isSessionRejection(error: unknown): boolean {
  return isApiError(error) && error.kind === 'auth' && error.code === 'unauthorized';
}
