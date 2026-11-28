import { isApiError } from '@/types/api';

/**
 * `409 patient_not_linked` — the signed-in account is a patient account
 * that staff have not yet linked to a patient record (ADR-048).
 *
 * It is an answer the screens render ("link your account at the hospital
 * desk"), not a failure to retry: retrying changes nothing until the link
 * exists. Matched on the envelope's `code`, never on the status alone —
 * a 409 is also a stale write.
 */
export function isPatientNotLinked(error: unknown): boolean {
  return isApiError(error) && error.kind === 'conflict' && error.code === 'patient_not_linked';
}
