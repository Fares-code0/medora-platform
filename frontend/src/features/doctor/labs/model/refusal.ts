import { NETWORK_WRITE_OUTCOME_UNKNOWN } from '@/api/errors';
import { isApiError } from '@/types/api';

/**
 * Why a laboratory write was refused, in words a doctor can act on: the
 * server's own explanation where it gave one (a critical value not
 * acknowledged, no report document to file, an unknown department), a plain
 * sentence otherwise — never "API error: …". A non-API error is the
 * adapter's or the mock's own message, which is already written for people.
 */
export function refusalOf(error: Error): string {
  if (!isApiError(error)) return error.message;
  switch (error.kind) {
    case 'conflict':
      return error.detail;
    case 'validation':
      return Object.values(error.fieldErrors)[0]?.[0] ?? 'The request was not accepted.';
    case 'not_found':
      return 'This order is no longer available to you.';
    case 'forbidden':
      return 'You are not allowed to make this change.';
    case 'network':
      return NETWORK_WRITE_OUTCOME_UNKNOWN;
    case 'server':
      return error.code === 'not_connected'
        ? 'This is not available from the laboratory service yet.'
        : 'The server could not complete this. Nothing was changed.';
    default:
      return 'Nothing was changed. Please try again.';
  }
}
