import type { MessageKey, TranslateFn } from '@/i18n';

import { CANCEL_REASONS, type CancelReasonCode } from './model/types';

/**
 * The closed list of cancellation reasons, localized.
 *
 * The codes are the server's (contract §3); the words are this app's, so
 * the picker, the confirmation and the appointment's own history read in
 * the patient's language.
 */
export const CANCEL_REASON_KEYS: Readonly<Record<CancelReasonCode, MessageKey>> = {
  schedule_conflict: 'appointment.cancel.reason.scheduleConflict',
  feeling_better: 'appointment.cancel.reason.feelingBetter',
  booked_elsewhere: 'appointment.cancel.reason.bookedElsewhere',
  transport: 'appointment.cancel.reason.transport',
  cost: 'appointment.cancel.reason.cost',
  other: 'appointment.cancel.reason.other',
};

export { CANCEL_REASONS };

function isCode(value: string): value is CancelReasonCode {
  return (CANCEL_REASONS as readonly string[]).includes(value);
}

/**
 * `cancelled_reason` arrives as `patient:<code>` plus an optional note.
 * A recognised code is shown in the patient's language, followed by the
 * note they wrote; anything else — a clinic's reason, a legacy free-text
 * value — is shown exactly as the server sent it.
 */
export function describeCancelledReason(raw: string, t: TranslateFn): string {
  const match = /^patient:([a-z_]+)(?:[\s:–—-]+([\s\S]+))?$/.exec(raw.trim());
  const code = match?.[1];
  if (code === undefined || !isCode(code)) return raw;
  const label = t(CANCEL_REASON_KEYS[code]);
  const note = match?.[2]?.trim();
  return note === undefined || note === '' ? label : `${label} — ${note}`;
}
