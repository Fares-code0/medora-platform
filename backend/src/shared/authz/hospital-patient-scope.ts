/**
 * Hospital-aware patient scope — the **authoritative** clinical access rule
 * (enforcement stage S3; owner decisions #17, #18, DR-02, DR-05, DR-07, OD-07,
 * OD-12; ADR-022's 404-not-403 is kept).
 *
 * Phase 22 introduced this rule in shadow mode beside the legacy
 * care-assignment rule. S3 makes it the only rule: `PatientScopeService`
 * answers every clinical access question from `decidePatientReach` below,
 * and the legacy hospital-blind assignment check is gone.
 *
 * ## The rule
 *
 * A principal reaches a patient's clinical data if and only if **all** hold:
 *
 * 1. the principal's role is `doctor` — every other role (Hospital Admin and
 *    Platform Admin included) has no clinical access through this rule
 *    (OD-07), and no platform-role mapping is consulted or inferred;
 * 2. the doctor has exactly one **clinical employment** (DR-02), derived on
 *    the server, never from client input (DR-08): an employment with
 *    `ended_at IS NULL` (OD-12) at a hospital that is `ACTIVE` and not
 *    soft-deleted, held by a doctor profile that is not soft-deleted, whose
 *    `verification_status` is `VERIFIED` and whose `practice_status` is
 *    `ACTIVE` or `VACATION` (#18: VACATION keeps access; unverified,
 *    SUSPENDED, terminated and deleted lose it). None, or more than one, is
 *    missing or ambiguous context and fails closed;
 * 3. a **live** care assignment (`revoked_at IS NULL`) links the doctor and
 *    the patient and is **owned by that employment**: its
 *    `doctor_employment_id` is the active employment's id, its `hospital_id`
 *    is the employment's hospital, and it carries the patient's
 *    `hospital_medical_record_id` at that hospital. The composite foreign
 *    keys make the three columns agree with each other, so an assignment
 *    tied to the active employment is necessarily at the active hospital and
 *    on the patient's record there (DR-04, DR-07).
 *
 * A legacy assignment — `hospital_id IS NULL`, so all three scope columns
 * are NULL — never grants ordinary clinical access (#17: unknown ownership
 * stays isolated; such rows are preserved, never assigned or rewritten).
 *
 * The Phase 22 shadow also refused a pair with two live rows as
 * "ambiguous". `patient_doctor_assignments_one_live_per_pair` already makes
 * that unrepresentable, so the rule is stated existentially ("an owned live
 * assignment exists") and the repository reads at most two rows.
 *
 * Cross-hospital access exists only through a grant or Break-Glass (DR-06,
 * OD-04). Neither exists yet, so there is no cross-hospital path at all.
 *
 * The decision is a pure function of two reads, so every branch is covered
 * by unit tests without a database; the reads live in
 * `PrismaHospitalPatientScopeRepository`.
 */

import type { Principal } from './authz.types';

export const HOSPITAL_PATIENT_SCOPE_REPOSITORY = Symbol('HOSPITAL_PATIENT_SCOPE_REPOSITORY');

/** The doctor's one active, clinically usable employment (rule step 2). */
export interface ClinicalEmployment {
  readonly doctorId: string;
  readonly doctorEmploymentId: string;
  readonly hospitalId: string;
}

/** One live (`revoked_at IS NULL`) care assignment and its Phase 21 scope columns. */
export interface LiveAssignmentScope {
  /** `patients.id` (uuid), whichever handle the caller passed. */
  readonly patientId: string;
  readonly hospitalId: string | null;
  readonly hospitalMedicalRecordId: string | null;
  readonly doctorEmploymentId: string | null;
}

/**
 * Where a reachable patient's clinical data lives for this doctor: the
 * active hospital, the employment that reaches it, and the patient's
 * hospital medical record there. Callers filter child reads by
 * `hospitalId` and stamp hospital-owned writes with these columns.
 */
export interface PatientClinicalScope extends ClinicalEmployment {
  /** `patients.id` (uuid). */
  readonly patientId: string;
  readonly hospitalMedicalRecordId: string;
}

export interface HospitalPatientScopeRepository {
  /**
   * Employments satisfying rule step 2 for this user, at most two (enough to
   * detect ambiguity, which the one-active-employment index should already
   * make impossible).
   */
  activeClinicalEmployments(doctorUserId: string): Promise<readonly ClinicalEmployment[]>;

  /** Live assignments for the pair. Accepts the public `PT-…` handle or the uuid. */
  liveAssignmentScopes(
    doctorUserId: string,
    patientId: string,
  ): Promise<readonly LiveAssignmentScope[]>;
}

export type PatientReachDenyReason =
  | 'role_has_no_care_relationship'
  | 'no_clinical_employment'
  | 'ambiguous_clinical_employment'
  | 'no_care_assignment'
  | 'assignment_hospital_unassigned'
  | 'cross_hospital_assignment'
  | 'assignment_employment_mismatch';

export type PatientReachDecision =
  | { readonly allowed: true; readonly scope: PatientClinicalScope }
  | { readonly allowed: false; readonly reason: PatientReachDenyReason };

function deny(reason: PatientReachDenyReason): PatientReachDecision {
  return { allowed: false, reason };
}

/** Rule step 2 over the repository's rows: exactly one, or a refusal. */
export function singleClinicalEmployment(
  employments: readonly ClinicalEmployment[],
): ClinicalEmployment | 'none' | 'ambiguous' {
  if (employments.length > 1) return 'ambiguous';
  return employments[0] ?? 'none';
}

/** The rule above, as a pure function. */
export function decidePatientReach(
  principal: Principal,
  employments: readonly ClinicalEmployment[],
  assignments: readonly LiveAssignmentScope[],
): PatientReachDecision {
  if (principal.roleCode !== 'doctor') return deny('role_has_no_care_relationship');

  const employment = singleClinicalEmployment(employments);
  if (employment === 'none') return deny('no_clinical_employment');
  if (employment === 'ambiguous') return deny('ambiguous_clinical_employment');

  for (const row of assignments) {
    if (
      row.hospitalId === employment.hospitalId &&
      row.doctorEmploymentId === employment.doctorEmploymentId &&
      row.hospitalMedicalRecordId !== null
    ) {
      return {
        allowed: true,
        scope: {
          ...employment,
          patientId: row.patientId,
          hospitalMedicalRecordId: row.hospitalMedicalRecordId,
        },
      };
    }
  }

  // The most specific reason, for diagnostics only: every refusal is the
  // same 404 to the caller.
  if (assignments.length === 0) return deny('no_care_assignment');
  if (
    assignments.some((row) => row.hospitalId !== null && row.hospitalId !== employment.hospitalId)
  ) {
    return deny('cross_hospital_assignment');
  }
  if (assignments.every((row) => row.hospitalId === null)) {
    return deny('assignment_hospital_unassigned');
  }
  return deny('assignment_employment_mismatch');
}
