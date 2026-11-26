import { isApiError } from '@/types/api';

/**
 * Whether a failure of `GET /me/patient-link` says the account is not a
 * patient account (C-11; the rule is in `features/auth/eligibility.ts`).
 *
 * `403` with the code `patient_only` and nothing else: a 403 without the
 * code came from something in front of the API, and is that request's
 * failure rather than a verdict on the account. It lives with the route
 * whose answer it reads, and only `usePatientLink` calls it — reading
 * `patient_only` off any other endpoint would let one mis-scoped route
 * sign every patient out.
 */
export function isIneligibleProbeRefusal(error: unknown): boolean {
  return isApiError(error) && error.kind === 'forbidden' && error.code === 'patient_only';
}
