import { isApiError } from '@/types/api';

/**
 * `503 service_unavailable` — the server has no assistant provider
 * configured (the state every deployment is in today).
 *
 * Matched on the status and on the envelope's code, either one: a 503
 * from a proxy has no envelope but is the same answer to the patient —
 * "not available right now" — and neither is a reason to show a retry
 * loop or to invent a reply.
 */
export function isAssistantUnavailable(error: unknown): boolean {
  if (!isApiError(error)) return false;
  if (error.code === 'service_unavailable') return true;
  return error.kind === 'server' && error.status === 503;
}

/** A turn cancelled by the patient leaving the screen — never an error to show. */
export function isCancelled(error: unknown): boolean {
  return isApiError(error) && error.kind === 'cancelled';
}
