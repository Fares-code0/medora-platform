import { NETWORK_WRITE_OUTCOME_UNKNOWN } from '@/api/errors';
import { isApiError } from '@/types/api';

/**
 * Why an administrator's request was refused, in words they can act on
 * (FE-10.10).
 *
 * The server's own explanation wins wherever it gave one: a 409's `detail`
 * is written for people ("This is the last active admin; promote another
 * one first", "An account with this email already exists"), and a 422
 * names the field. Everything else gets a plain sentence for its kind —
 * never "API error: conflict".
 *
 * A non-API error is the mock service's own refusal (`DoctorsError`,
 * `OversightError`), already worded for the screen, so it passes through.
 */
export function adminRefusal(error: unknown): string {
  if (!isApiError(error)) {
    return error instanceof Error && error.message.length > 0
      ? error.message
      : 'The platform did not accept that change. Nothing was altered.';
  }
  switch (error.kind) {
    case 'conflict':
      return sentence(error.detail);
    case 'validation': {
      const first = Object.values(error.fieldErrors)[0]?.[0];
      return first === undefined
        ? 'The server did not accept those details. Check them and try again.'
        : sentence(first);
    }
    case 'forbidden':
      return 'Your account does not hold the permission this needs. Nothing was changed.';
    case 'not_found':
      return 'That record is no longer on the platform. Refresh and try again.';
    case 'auth':
      return 'Your session has ended. Sign in again to continue.';
    case 'rate_limited':
      return `Too many attempts. Try again in ${String(error.retryAfterSeconds)} seconds.`;
    case 'network':
      return NETWORK_WRITE_OUTCOME_UNKNOWN;
    case 'server':
      return error.code === 'not_connected'
        ? 'This is not connected to the Medora server yet.'
        : `The server could not complete this (${error.ref}). Nothing was changed.`;
  }
}

/**
 * The description an admin section's error state shows for a failed load.
 * `undefined` keeps the state's default wording; a missing permission and a
 * dropped session are worth saying, because Retry cannot fix either.
 */
export function loadFailureDescription(error: unknown): string | undefined {
  if (!isApiError(error)) return undefined;
  if (error.kind === 'forbidden') {
    return 'Your account does not hold the permission this section needs.';
  }
  if (error.kind === 'auth') return 'Your session has ended. Sign in again to continue.';
  return undefined;
}

/** Server details are written as clauses; the dialogs print them as sentences. */
function sentence(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 'The platform refused that change. Nothing was altered.';
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}
