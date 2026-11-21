import type { Request } from 'express';

/**
 * `X-Client-Type` (ADR-014, API §0.1, MG §15.2).
 *
 * One header, read in one place, deciding one thing: whether the refresh
 * token travels as a cookie or in the JSON body.
 *
 * ## What a native client cannot do
 *
 * A React Native app has no cookie jar scoped to a web origin, so
 * `Set-Cookie` has nothing to store the token in and `httpOnly` protects
 * nothing. MG §15.2 is explicit about the consequence — *"when
 * `X-Client-Type: mobile` … return the refresh token in the response body
 * instead of a cookie; mobile stores it in Keychain/Keystore; same
 * rotation + reuse detection"* — and RM M41.1's verification is a script
 * that "completes login→refresh→logout **without cookies**".
 *
 * ## Why this is a client declaration and safe to honour
 *
 * The header is set by the client about itself. A cross-origin attacker
 * cannot add it to a form post, and a `fetch` that carries it triggers a
 * preflight and still cannot read the response without CORS naming the
 * attacker's origin — the same boundary that already protects
 * `accessToken`, which has always been in this body.
 *
 * The asymmetry with `presentedRefreshToken` is deliberate and is not a
 * contradiction. On the **request** side the header is only a *fallback
 * selector*: a cookie, when present, always wins, so a browser cannot be
 * talked into sending its token in a body by an attacker who controls a
 * header. On the **response** side the header is a *mode*: it decides
 * where this client's token is delivered, and delivering it to exactly
 * one place is the point.
 */
export const CLIENT_TYPE_HEADER = 'x-client-type';

export function isMobileClient(request: Request): boolean {
  return request.headers[CLIENT_TYPE_HEADER] === 'mobile';
}
