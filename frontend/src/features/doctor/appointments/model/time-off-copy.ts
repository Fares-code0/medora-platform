import { formatDate, formatTime, type TranslateFn } from '@/i18n';
import { isApiError } from '@/types/api';

import type { TimeOffBlock } from './time-off-service';

/** Shared wording for the time-off pages — the window's span and a refusal's message. */

export function timeOffSpan(t: TranslateFn, block: TimeOffBlock): string {
  return t('timeOff.span', {
    start: `${formatDate(block.startsAt)} ${formatTime(block.startsAt)}`,
    end: `${formatDate(block.endsAt)} ${formatTime(block.endsAt)}`,
  });
}

/** The server's own words for a refusal (409 conflict, 422 field errors). */
export function timeOffErrorMessage(t: TranslateFn, error: unknown): string {
  if (isApiError(error) && error.kind === 'conflict') return error.detail;
  if (isApiError(error) && error.kind === 'validation') {
    const first = Object.values(error.fieldErrors)[0]?.[0];
    if (first !== undefined) return first;
  }
  return t('timeOff.error.generic');
}
