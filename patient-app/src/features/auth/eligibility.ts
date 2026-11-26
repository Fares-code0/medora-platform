import type { AuthenticatedIdentity } from './model/types';

/**
 * Who may use this app at all (C-11) — and the one place that says so.
 *
 * ── The rule ─────────────────────────────────────────────────────────
 *
 * The patient app is for patients. A clinician, a receptionist or an
 * administrator signing in with their Medora credentials must not see a
 * single patient screen — not an empty Home, not a profile, nothing that
 * reads as "this works, it is just quiet". The server already refuses
 * every patient route to them (`403 patient_only`); this gate is what
 * stops the app from rendering a patient shell around those refusals.
 *
 * Eligibility is `user.role === 'patient'` on the login, OTP, recovery
 * and refresh payloads (contract §1: `GET /auth/session` and the login
 * payload are unchanged; the role is already on them). Anything else —
 * another role, or a payload that names none — is ineligible. A missing
 * role fails closed: the gate is a "may this app render at all" decision,
 * and a payload that does not say is not a yes.
 *
 * It is applied on EVERY session the provider installs: a sign-in, an
 * OTP or recovery completion, the cold-start restore, and every refresh,
 * because a role can change while a session is open.
 *
 * ── Role changes mid-session, and ADR-046 ───────────────────────────
 *
 * The backend revokes an account's sessions when its role changes
 * (ADR-046). A role change therefore usually reaches this app NOT as a
 * refresh carrying a new role, but as `401 unauthorized` on the next
 * refresh — which `refresh-outcome.ts` already reads as "the session is
 * over" and ends as `session-expired`. The role check on refresh is the
 * second line, for a server that did not revoke.
 *
 * ── What is NOT ineligibility ───────────────────────────────────────
 *
 * A `403` from an ordinary endpoint is that endpoint's refusal and
 * nothing more: it renders as the endpoint's own forbidden state and
 * never ends the session. Only two signals mean "this account may not
 * use the app":
 *
 * 1. a session payload whose role is not `patient` (`isEligibleIdentity`);
 * 2. `403` with the explicit code `patient_only` from the eligibility
 *    probe, `GET /me/patient-link` — and from that route alone
 *    (`isIneligibleProbeRefusal` in `features/patient-link/probe.ts`,
 *    called only by `usePatientLink`).
 *
 * Reading `patient_only` off any other route would let one mis-scoped
 * endpoint sign every patient out, which is exactly the over-reaction
 * `refresh-outcome.ts` exists to prevent for 403s on refresh.
 *
 * ── What it does when it refuses ────────────────────────────────────
 *
 * `SessionProvider` revokes the session server-side (`POST /auth/logout`)
 * and runs the same teardown as any sign-out — keychain, access token,
 * PHI cache, recent doctors, breadcrumbs — then lands `unauthenticated`
 * with `reason: 'ineligible'`, which the navigator renders as the
 * "patients only" screen. No role switcher, no non-patient screens.
 */

export const PATIENT_ROLE = 'patient';

/** Whether this session's account may use the patient app. */
export function isEligibleIdentity(identity: Pick<AuthenticatedIdentity, 'role'>): boolean {
  return identity.role === PATIENT_ROLE;
}

