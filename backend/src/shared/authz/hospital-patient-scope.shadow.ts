/**
 * Phase 22 — hospital-aware patient scope, **shadow mode only**.
 *
 * `PatientScopeService` still answers every real access question with the
 * legacy care-relationship rule (ADR-022). This evaluator computes what the
 * hospital-aware rule *would* answer and compares the two, so divergence can
 * be observed before any enforcement is switched on. Its result is never
 * returned to a caller, never throws into one, and never changes a decision.
 *
 * The shadow rule fails closed. A doctor reaches a patient only when all of
 * these hold, and any missing, ambiguous, conflicting or unmapped piece is
 * a "no access" shadow decision with a reason:
 *
 * - the server-derived hospital context is exactly one active
 *   `DoctorEmployment` (hospital is the isolation boundary, DR-01);
 * - exactly one live care assignment links the doctor and the patient;
 * - that assignment is explicitly owned by the same hospital — legacy rows
 *   with no hospital are never assumed to belong to one;
 * - it is bound to the doctor's employment, and that employment is active
 *   (OD-12: access derived from an ended employment is gone, no grace);
 * - it is bound to the patient's `HospitalMedicalRecord` at that hospital.
 *
 * Every other role — Hospital Admin and Platform Admin included — has no
 * clinical access in the shadow rule either (OD-07). No platform-role
 * mapping is consulted or inferred.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';

import type { HospitalContext } from '../../common/auth/hospital-context';
import type { Principal } from './authz.types';
import { HospitalContextService } from './hospital-context.service';

export const HOSPITAL_PATIENT_SCOPE_REPOSITORY = Symbol('HOSPITAL_PATIENT_SCOPE_REPOSITORY');

/** One live (`revoked_at IS NULL`) care assignment and its Phase 21 scope columns. */
export interface LiveAssignmentScope {
  readonly hospitalId: string | null;
  readonly hospitalMedicalRecordId: string | null;
  readonly doctorEmploymentId: string | null;
  /** `ended_at` of the bound employment; `null` when active or unbound. */
  readonly employmentEndedAt: Date | null;
}

export interface HospitalPatientScopeRepository {
  /** Accepts the public `PT-…` handle or the uuid, like `isAssigned`. */
  liveAssignmentScopes(
    doctorUserId: string,
    patientId: string,
  ): Promise<readonly LiveAssignmentScope[]>;
}

type UnresolvedContextReason = Extract<HospitalContext, { kind: 'unresolved' }>['reason'];

export type ShadowDenyReason =
  | UnresolvedContextReason
  | 'role_has_no_care_relationship'
  | 'context_not_clinical'
  | 'no_care_assignment'
  | 'ambiguous_care_assignment'
  | 'assignment_hospital_unassigned'
  | 'cross_hospital_assignment'
  | 'assignment_employment_unassigned'
  | 'assignment_employment_ended'
  | 'hospital_medical_record_unassigned';

export type ShadowPatientScopeDecision =
  | { readonly allowed: true; readonly hospitalId: string }
  | { readonly allowed: false; readonly reason: ShadowDenyReason };

export type ShadowComparisonOutcome =
  | 'agree_allow'
  | 'agree_deny'
  /** Expected while legacy rows have no hospital ownership. */
  | 'legacy_allow_shadow_deny'
  /** Must never happen: the shadow rule is strictly narrower. */
  | 'legacy_deny_shadow_allow';

export interface PatientScopeShadowComparison {
  readonly legacyAllowed: boolean;
  readonly shadow: ShadowPatientScopeDecision;
  readonly outcome: ShadowComparisonOutcome;
}

function deny(reason: ShadowDenyReason): ShadowPatientScopeDecision {
  return { allowed: false, reason };
}

@Injectable()
export class HospitalPatientScopeShadow {
  private readonly logger = new Logger(HospitalPatientScopeShadow.name);

  constructor(
    private readonly contexts: HospitalContextService,
    @Inject(HOSPITAL_PATIENT_SCOPE_REPOSITORY)
    private readonly repository: HospitalPatientScopeRepository,
  ) {}

  /** The hospital-aware decision. Observation only — never an access gate. */
  async evaluate(principal: Principal, patientId: string): Promise<ShadowPatientScopeDecision> {
    if (principal.roleCode !== 'doctor') return deny('role_has_no_care_relationship');

    const context = await this.contexts.resolve({
      id: principal.userId,
      role: principal.roleCode,
    });
    if (context.kind === 'unresolved') return deny(context.reason);
    if (context.kind !== 'hospital' || context.source !== 'doctor_employment') {
      return deny('context_not_clinical');
    }

    const assignments = await this.repository.liveAssignmentScopes(principal.userId, patientId);
    if (assignments.length === 0) return deny('no_care_assignment');
    if (assignments.length > 1) return deny('ambiguous_care_assignment');
    const assignment = assignments[0];
    if (assignment === undefined) return deny('no_care_assignment');

    if (assignment.hospitalId === null) return deny('assignment_hospital_unassigned');
    if (assignment.hospitalId !== context.hospitalId) return deny('cross_hospital_assignment');
    if (assignment.doctorEmploymentId === null) return deny('assignment_employment_unassigned');
    if (assignment.employmentEndedAt !== null) return deny('assignment_employment_ended');
    if (assignment.hospitalMedicalRecordId === null) {
      return deny('hospital_medical_record_unassigned');
    }

    return { allowed: true, hospitalId: context.hospitalId };
  }

  /**
   * Computes and records the comparison. Logs carry the role, outcome and
   * reason only — no patient identifier and no hospital name (no PHI).
   */
  async compare(
    principal: Principal,
    patientId: string,
    legacyAllowed: boolean,
  ): Promise<PatientScopeShadowComparison> {
    const shadow = await this.evaluate(principal, patientId);
    const outcome: ShadowComparisonOutcome =
      legacyAllowed === shadow.allowed
        ? legacyAllowed
          ? 'agree_allow'
          : 'agree_deny'
        : legacyAllowed
          ? 'legacy_allow_shadow_deny'
          : 'legacy_deny_shadow_allow';

    if (outcome === 'legacy_deny_shadow_allow') {
      this.logger.warn({ msg: 'Patient scope shadow divergence', outcome, role: principal.roleCode });
    } else if (outcome === 'legacy_allow_shadow_deny' && !shadow.allowed) {
      this.logger.debug({
        msg: 'Patient scope shadow divergence',
        outcome,
        role: principal.roleCode,
        reason: shadow.reason,
      });
    }

    return { legacyAllowed, shadow, outcome };
  }
}
