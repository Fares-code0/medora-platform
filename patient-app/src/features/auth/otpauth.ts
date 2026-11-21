/**
 * Whether an enrolment link from the server may be handed to `Linking`.
 *
 * `otpauthUrl` comes from `POST /me/2fa/setup` and `/me/2fa/reenroll`, and
 * `Linking.openURL` opens whatever scheme it is given — the reason
 * `emergency/dial.ts` and `consent.ts` allow-list theirs. A compromised or
 * misconfigured API must not turn "Open my authenticator app" into an
 * `https:` phishing page asking for the very codes being set up, or into a
 * deep link into another app. The only scheme an authenticator registers is
 * `otpauth://`; the secret shown beside the button is the fallback.
 *
 * A pattern rather than `new URL`: the scheme is all that is decided, and
 * the check must not depend on how much of `URL` the runtime implements.
 */
const OTPAUTH = /^otpauth:\/\/[^\s]+$/i;

export function isOtpauthUrl(value: string): boolean {
  return OTPAUTH.test(value);
}
