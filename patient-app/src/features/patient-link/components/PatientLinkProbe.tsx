import { usePatientLink } from '../hooks';

/**
 * Asks `GET /me/patient-link` as soon as a session is up (C-11).
 *
 * Renders nothing. Mounted beside the signed-in navigator, so the link
 * state is read once per session whatever screen opens first — and a
 * `403 patient_only` from it ends an ineligible session even if no screen
 * that shows the link state is ever opened. The answer is cached under the
 * `patient-link` PHI domain, which Home and Profile read without asking
 * again.
 */
export function PatientLinkProbe() {
  usePatientLink();
  return null;
}
