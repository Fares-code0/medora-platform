/**
 * Whether a server-supplied enrolment link may be handed to the browser.
 *
 * `otpauthUrl` arrives from `POST /me/2fa/setup` and `/me/2fa/reenroll` and is
 * rendered as a link a user clicks. React 18 still renders a `javascript:`
 * href (it only warns), so a compromised or misconfigured API could turn
 * "Open in an authenticator app" into script in this origin, or into a
 * phishing page that asks for the very codes being set up. The only link an
 * authenticator app registers is `otpauth://`, so that is the only one
 * followed; the base32 secret beside it is the fallback either way.
 */
export function isOtpauthUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'otpauth:';
  } catch {
    return false;
  }
}
