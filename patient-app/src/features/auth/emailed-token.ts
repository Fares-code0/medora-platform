/**
 * The token out of whatever the patient pasted (checklist S4).
 *
 * The reset email carries a link, not a code:
 * `${APP_PUBLIC_URL}/reset-password?token=…`
 * (`backend/src/modules/auth/services/auth-mail.service.ts`, `link()`).
 * A patient whose mail client opens it in a browser comes back here and
 * pastes what they have — very often the whole link, sometimes with the
 * sentence around it. Trimming that and posting it sent the server a URL
 * as a token, and a valid reset failed.
 *
 * - A `token=` parameter anywhere (name matched case-insensitively) → the
 *   first **non-empty** value, percent-decoded.
 * - A URL anywhere in the paste but no non-empty `token` → empty, so the
 *   form says "paste the code" rather than posting text the server can
 *   only refuse.
 * - Anything else → the paste, trimmed: a bare token still works.
 *
 * The token itself is base64url (`secret.service.ts`), which needs no
 * escaping; decoding is for a link a mail client re-encoded on the way.
 * A malformed escape yields empty rather than a guess.
 */
const TOKEN_PARAMETER = /(?:^|[?&#;\s])token=([^&#\s]*)/gi;
const CONTAINS_URL = /(?:^|\s)(?:[a-z][a-z0-9+.-]*:\/\/|www\.)\S/i;

export function extractEmailedToken(pasted: string): string {
  const trimmed = pasted.trim();
  let sawParameter = false;
  for (const match of trimmed.matchAll(TOKEN_PARAMETER)) {
    sawParameter = true;
    const raw = match[1] ?? '';
    if (raw === '') continue;
    try {
      const token = decodeURIComponent(raw).trim();
      if (token !== '') return token;
    } catch {
      return '';
    }
  }
  if (sawParameter || CONTAINS_URL.test(trimmed)) return '';
  return trimmed;
}
