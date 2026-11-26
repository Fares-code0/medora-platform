import type { MessageKey } from '@/i18n';
import { isApiError } from '@/types/api';

/**
 * How a failed appointment write is presented.
 *
 * One classifier for booking, cancelling and rescheduling, so the same
 * server answer reads the same on every screen. It looks at the
 * envelope's `code` (ADR-012) and falls back to the error's kind — never
 * at message text.
 *
 * ── What each outcome asks of the screen ─────────────────────────────
 *
 * | kind | meaning | the screen should |
 * |---|---|---|
 * | `slot_taken` | the time went (409, or 404 on the slot) | refresh the slots, keep the form |
 * | `request_pending` | one reschedule request is already open | refresh the appointment |
 * | `conflict` | the appointment changed under the patient | show the server's `detail`, refresh |
 * | `insurance` | 422 `insurance_not_covered` | show the server's `detail`; the form is kept |
 * | `visit_type` | 422 `visit_type_required` | ask for a visit type |
 * | `not_linked` | 409 `patient_not_linked` | point at account linking |
 * | `offline` | network or timeout | offer a retry — never sign out |
 * | `generic` | anything else | say it did not go through |
 *
 * The session is untouched by any of these: a 401 is handled once, in the
 * API client, and is never a reason a form here signs anyone out.
 */
export type ActionFailureKind =
  | 'slot_taken'
  | 'request_pending'
  | 'conflict'
  | 'insurance'
  | 'visit_type'
  | 'not_linked'
  | 'offline'
  | 'generic';

export interface ActionFailure {
  readonly kind: ActionFailureKind;
  readonly messageKey: MessageKey;
  /** The server's own sentence, shown as sent — only where the contract says to. */
  readonly detail: string | null;
}

const MESSAGE: Readonly<Record<ActionFailureKind, MessageKey>> = {
  slot_taken: 'appointment.error.slotTaken',
  request_pending: 'appointment.error.requestPending',
  conflict: 'appointment.error.conflict',
  insurance: 'appointment.error.insurance',
  visit_type: 'appointment.error.visitType',
  not_linked: 'appointment.error.notLinked',
  offline: 'appointment.error.offline',
  generic: 'appointment.action.failed',
};

export function classifyActionError(error: unknown): ActionFailure {
  const kind = kindOf(error);
  const detail =
    (kind === 'conflict' || kind === 'insurance') &&
    isApiError(error) &&
    'detail' in error &&
    typeof error.detail === 'string' &&
    error.detail.trim() !== ''
      ? error.detail
      : null;
  return { kind, messageKey: MESSAGE[kind], detail };
}

function kindOf(error: unknown): ActionFailureKind {
  if (!isApiError(error)) return 'generic';
  switch (error.code) {
    case 'slot_taken':
      return 'slot_taken';
    case 'reschedule_request_pending':
      return 'request_pending';
    case 'patient_not_linked':
      return 'not_linked';
    case 'insurance_not_covered':
      return 'insurance';
    case 'visit_type_required':
      return 'visit_type';
    default:
      break;
  }
  switch (error.kind) {
    case 'conflict':
      return 'conflict';
    // An unknown slot id: the slot is gone as far as the patient can tell.
    case 'not_found':
      return 'slot_taken';
    case 'network':
    case 'timeout':
      return 'offline';
    default:
      return 'generic';
  }
}
