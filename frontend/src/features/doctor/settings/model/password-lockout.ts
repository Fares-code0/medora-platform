import { isApiError } from '@/types/api';

/**
 * Whether a failure is the server's password lockout (owner decision D1):
 * the guess that reached the sign-in limit, or an attempt while the account
 * is locked. The server answers 429 with code `rate_limited` from its own
 * error envelope, and has already ended the calling session.
 *
 * The status alone is not enough. `ApiClient` turns every 429 into
 * `kind: 'rate_limited'`, including one from a proxy or an edge firewall,
 * which carries no envelope and therefore no `code`. That answer is not the
 * account's lockout and ended no session, so it must not be shown as one
 * or end this session here.
 *
 * Verified for the two routes this is used on: neither `POST /me/password`
 * nor `POST /me/2fa/disable` carries `@RateLimited`, so the per-client
 * limiter, which shares the code, never answers them. A route that gained
 * it would make the code ambiguous and would need its own decision.
 */
export function isPasswordLockout(error: unknown): boolean {
  return isApiError(error) && error.kind === 'rate_limited' && error.code === 'rate_limited';
}
