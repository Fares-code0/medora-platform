import type { MessageKey } from '@/i18n';
import { isAuthError, type AuthErrorCode } from '@/types/auth';

/**
 * The message key an auth page shows for a failure.
 *
 * Every credential route can answer `429 rate_limited` (backend M37.2), and
 * a throttle is never the user's input to fix, so it is named here by default
 * rather than left for each page to remember. Two passes (§26, §28) fixed
 * pages that had forgotten it one at a time. A page lists only the codes it
 * words its own way; anything else, including a non-auth failure, is its
 * `fallback`.
 */
export function authErrorKey(
  error: unknown,
  messages: Partial<Record<AuthErrorCode, MessageKey>>,
  fallback: MessageKey,
): MessageKey {
  if (!isAuthError(error)) return fallback;
  const own = messages[error.code];
  if (own !== undefined) return own;
  return error.code === 'rate_limited' ? 'common.rateLimited' : fallback;
}
