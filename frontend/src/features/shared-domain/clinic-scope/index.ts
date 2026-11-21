/**
 * Clinic scoping (D-27b).
 *
 * **The product model.** Medora is multi-clinic. One doctor has one primary
 * clinic. A doctor may view, create, update and manage data belonging to
 * their own clinic, and no other's. An administrator is not clinic-scoped —
 * platform administration spans clinics — so an absent clinic means "not
 * scoped", which is a different claim from "scoped to nothing".
 *
 * ────────────────────────────────────────────────────────────────────────
 * **THIS IS NOT THE SECURITY BOUNDARY.**
 *
 * Everything a client filters, a client can unfilter: change a variable in
 * a debugger, replay a request with a different id, or simply read the
 * response that already contained the other clinic's rows. Isolation has to
 * be enforced by the server, on every read and every write, derived from the
 * session rather than from any parameter the client sends.
 *
 * What this module does is narrower and still worth doing: it makes the
 * frontend *reflect* the policy, so a doctor is never shown another clinic's
 * data and is never offered an action against it. That is a correctness and
 * honesty property, not a security one. `docs/handoff/clinic-isolation.md`
 * states what the backend must enforce.
 * ────────────────────────────────────────────────────────────────────────
 */

/** Anything attributed to a clinic. */
export interface ClinicScoped {
  readonly clinicId: string;
}

/** Anything attributed to a clinic and a doctor. */
export interface DoctorScoped extends ClinicScoped {
  readonly doctorId: string;
}

/**
 * The scope a signed-in account looks at data through.
 *
 * `null` clinic means the account is not clinic-scoped (an administrator).
 * It is deliberately not the same as an empty string: "spans every clinic"
 * and "belongs to a clinic named nothing" must not collapse into one value,
 * because the first should see everything and the second should see nothing.
 */
export interface ClinicScope {
  readonly clinicId: string | null;
  readonly doctorId: string | null;
}

export const UNSCOPED: ClinicScope = { clinicId: null, doctorId: null };

/**
 * Rows the scope may see.
 *
 * An unscoped account (admin) sees everything. A clinic-scoped account sees
 * only its own clinic's rows — and a row with no clinic is **excluded**, not
 * included: an unattributed row is one nobody can prove belongs here, and
 * defaulting it visible is how a leak looks in a demo.
 */
export function visibleToScope<T extends ClinicScoped>(
  rows: readonly T[],
  scope: ClinicScope,
): readonly T[] {
  if (scope.clinicId === null) return rows;
  return rows.filter((row) => row.clinicId === scope.clinicId);
}

/**
 * Rows belonging to this doctor specifically — their own board rather than
 * their clinic's. Clinic membership is checked as well, so a row attributed
 * to this doctor but another clinic still does not appear.
 */
export function ownedByDoctor<T extends DoctorScoped>(
  rows: readonly T[],
  scope: ClinicScope,
): readonly T[] {
  if (scope.doctorId === null) return visibleToScope(rows, scope);
  return visibleToScope(rows, scope).filter((row) => row.doctorId === scope.doctorId);
}

/** Whether one row is inside the scope. Used to guard an action, not to hide UI. */
export function isInScope(row: ClinicScoped, scope: ClinicScope): boolean {
  return scope.clinicId === null || row.clinicId === scope.clinicId;
}
