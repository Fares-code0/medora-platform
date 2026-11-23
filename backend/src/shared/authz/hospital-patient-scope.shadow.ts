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
 *   `DoctorEmployment` at an `ACTIVE`, non-deleted hospital (hospital is
 *   the isolation boundary, DR-01); a suspended, inactive or deleted
 *   hospital is missing context;
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
  /** The owning hospital is `ACTIVE` and not soft-deleted; `false` when unowned. */
  readonly hospitalActive: boolean;
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
  | 'assignment_hospital_inactive'
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

/** C1 resource bounds (issue #26). */
export interface ShadowLimits {
  /** Comparisons allowed in flight per process; beyond it they are skipped. */
  readonly maxInFlight: number;
}

export const DEFAULT_SHADOW_LIMITS: ShadowLimits = { maxInFlight: 4 };

/** Releases an admitted comparison's slot. Idempotent. */
export type ShadowSlotRelease = () => void;

@Injectable()
export class HospitalPatientScopeShadow {
  private readonly logger = new Logger(HospitalPatientScopeShadow.name);

  private inFlight = 0;
  private skipped = 0;

  constructor(
    private readonly contexts: HospitalContextService,
    @Inject(HOSPITAL_PATIENT_SCOPE_REPOSITORY)
    private readonly repository: HospitalPatientScopeRepository,
    private readonly limits: ShadowLimits = DEFAULT_SHADOW_LIMITS,
  ) {}

  /**
   * C1 in-flight cap. Returns a release function when a slot is free, or
   * `null` when `maxInFlight` comparisons are already running — the caller
   * then skips the comparison entirely (no queue, no wait). Synchronous, so
   * admission can never delay the authorization decision.
   *
   * The slot is held until the comparison **settles**, not until a timer
   * fires: releasing early would let the work it stands for keep running
   * uncounted. The shadow's own query is bounded by a transaction-local
   * `statement_timeout`, so a slow or lock-blocked database settles it; a
   * comparison that never settled would keep its slot, and the cap would
   * still bound such work at `maxInFlight`.
   */
  admit(): ShadowSlotRelease | null {
    if (this.inFlight >= this.limits.maxInFlight) {
      this.skipped += 1;
      // Debug, not warn: under a slow database this fires per request.
      this.logger.debug({ maxInFlight: this.limits.maxInFlight }, 'Patient scope shadow skipped');
      return null;
    }

    this.inFlight += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.inFlight -= 1;
    };
  }

  /** In-flight and skipped counts, for tests and diagnostics. No identifiers. */
  load(): { readonly inFlight: number; readonly skipped: number; readonly maxInFlight: number } {
    return { inFlight: this.inFlight, skipped: this.skipped, maxInFlight: this.limits.maxInFlight };
  }

  /** The hospital-aware decision. Observation only — never an access gate. */
  async evaluate(principal: Principal, patientId: string): Promise<ShadowPatientScopeDecision> {
    if (principal.roleCode !== 'doctor') return deny('role_has_no_care_relationship');

    // Shared with every other reader in this request: one lookup at most.
    const context = await this.contexts.forRequest({
      id: principal.userId,
      role: principal.roleCode,
    });
    if (context.kind === 'unresolved') return deny(context.reason);
    if (context.kind !== 'hospital' || context.source !== 'doctor_employment') {
      return deny('context_not_clinical');
    }

    // Read fresh on every evaluation — deliberately not memoized (audit F6,
    // #25). A per-request memo keyed by (doctor, patient handle) went stale
    // when the request itself created or revoked an assignment, and the same
    // patient by public id and by uuid got two entries (F7). Invalidating it
    // would need a hook on every write to patient_doctor_assignments,
    // doctor_employments and hospital_medical_records; not caching is the
    // safer rule, and the legacy `isAssigned` is not cached either. The cost
    // (one query per evaluation, only while the shadow is on) is bounded by
    // the in-flight cap (C1). The hospital context stays memoized: it depends
    // only on the caller's own employment, which no route lets the caller
    // change about themselves within a request.
    const assignments = await this.repository.liveAssignmentScopes(principal.userId, patientId);
    if (assignments.length === 0) return deny('no_care_assignment');
    if (assignments.length > 1) return deny('ambiguous_care_assignment');
    const assignment = assignments[0];
    if (assignment === undefined) return deny('no_care_assignment');

    if (assignment.hospitalId === null) return deny('assignment_hospital_unassigned');
    if (!assignment.hospitalActive) return deny('assignment_hospital_inactive');
    if (assignment.hospitalId !== context.hospitalId) return deny('cross_hospital_assignment');
    if (assignment.doctorEmploymentId === null) return deny('assignment_employment_unassigned');
    if (assignment.employmentEndedAt !== null) return deny('assignment_employment_ended');
    if (assignment.hospitalMedicalRecordId === null) {
      return deny('hospital_medical_record_unassigned');
    }

    return { allowed: true, hospitalId: context.hospitalId };
  }

  /**
   * Computes and records the comparison. The fields this method logs are the
   * role, outcome and reason only — it passes no patient identifier, hospital
   * name, token or session id. The request logger (nestjs-pino) still adds
   * its own `req` fields to every line written inside a request, including
   * the URL path, which can contain a public patient id such as `PT-1001`
   * (`common/logging/logger.config.ts`; only query strings are dropped).
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
      this.logger.warn({ outcome, role: principal.roleCode }, 'Patient scope shadow divergence');
    } else if (outcome === 'legacy_allow_shadow_deny' && !shadow.allowed) {
      this.logger.debug(
        { outcome, role: principal.roleCode, reason: shadow.reason },
        'Patient scope shadow divergence',
      );
    }

    return { legacyAllowed, shadow, outcome };
  }
}
