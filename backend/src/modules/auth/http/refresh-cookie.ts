import type { CookieOptions, Request, Response } from 'express';

/**
 * The refresh cookie (RM M6.2, M6.3 — API §0.1, ADR-011).
 *
 * `medora_rt`; `httpOnly; Secure; SameSite=Strict; Path=/api/v1/auth`.
 * Every attribute is load-bearing:
 *
 * - **httpOnly** — script cannot read it, so an XSS bug cannot exfiltrate
 *   a 30-day credential. This is the whole reason the refresh token is a
 *   cookie while the access token is not.
 * - **Secure** — including in development. Browsers treat `localhost` as
 *   a trustworthy origin, so a Secure cookie works over plain HTTP there;
 *   making the flag conditional would mean the development path is not
 *   the one that ships.
 * - **SameSite=Strict** — the refresh endpoint is a state-changing POST
 *   that needs no cross-site context, so `Strict` costs nothing and
 *   removes the CSRF question entirely.
 * - **Path** — scoped to the auth routes, so the token is not attached to
 *   every clinical request. It must match the API's real base path
 *   (ADR-011): scoped wrongly, the browser sends nothing and silent
 *   refresh fails for every user, with no error anywhere.
 */
export const REFRESH_COOKIE_NAME = 'medora_rt';

/** ADR-011 — the API is served at `/api/v1`, so the cookie is scoped here. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

function baseOptions(domain: string): CookieOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    domain,
  };
}

export function setRefreshCookie(
  response: Response,
  token: string,
  ttlSeconds: number,
  domain: string,
): void {
  // `maxAge` is milliseconds in Express and seconds in the header; the
  // conversion is here rather than at each call site, where spreading it
  // out is how one of them ends up a thousand times too short.
  response.cookie(REFRESH_COOKIE_NAME, token, {
    ...baseOptions(domain),
    maxAge: ttlSeconds * 1_000,
  });
}

/**
 * Clears it. The attributes must match the ones it was set with — a
 * browser matches a deletion by name, domain and path, so a
 * `clearCookie` that omits `path` leaves the cookie in place and the
 * user is still holding a refresh token after logging out.
 */
export function clearRefreshCookie(response: Response, domain: string): void {
  response.clearCookie(REFRESH_COOKIE_NAME, baseOptions(domain));
}

/**
 * Reads the cookie off the request.
 *
 * Parsed here rather than with `cookie-parser`: the application needs
 * exactly one cookie, and adding request-wide middleware to read it
 * would also put every other cookie a browser sends onto every request
 * object, where the logger and the error filter can reach them.
 */
export function readRefreshCookie(request: Request): string | undefined {
  const header = request.headers.cookie;
  if (header === undefined) return undefined;

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== REFRESH_COOKIE_NAME) continue;
    return decodeCookieValue(part.slice(separator + 1).trim());
  }

  return undefined;
}

/**
 * The cookie's value, percent-decoded where it decodes.
 *
 * `decodeURIComponent` throws `URIError` on a malformed escape (`%`,
 * `%zz`, a truncated UTF-8 sequence), and the cookie header is the
 * client's to write: an unauthenticated `POST /auth/refresh` carrying
 * `medora_rt=%` answered 500 and logged an unhandled exception, which
 * anyone could produce at will.
 *
 * The raw value is returned rather than `undefined`. A token this API
 * issued is base64url and never contains `%`, so the raw value matches
 * no session and the refresh is refused with the ordinary 401. And a
 * cookie that is present still wins over a body token
 * (`presentedRefreshToken`): treating a malformed cookie as absent would
 * let a request fall through to the mobile body path.
 */
function decodeCookieValue(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
