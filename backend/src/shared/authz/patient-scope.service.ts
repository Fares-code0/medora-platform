/**
 * Care-relationship scoping (RM M7.2, ADR-022).
 *
 * The platform's central authorization question is not "may this user
 * read charts" but "may this user read **this patient's** chart". This
 * service is the only place that answers it, and RM M7.2 requires that
 * "all patient-child access routes through it" — records, labs,
 * prescriptions, appointments, notes, documents and AI context binding
 * alike.
 *
 * Three rules, each of which is the design rather than an implementation
 * detail.
 *
 * ## 1. The assignment is the anchor
 *
 * A doctor reaches a patient if and only if `patient_doctor_assignments`
 * links them (DB §13.1). Never by matching a name: DECISIONS.md is
 * explicit that "care-scoping by name would be a security defect, not
 * merely untidy", and ADR-003 removed free-text doctor names precisely
 * so this could not be built that way.
 *
 * ## 2. Out of scope is 404, not 403
 *
 * A 403 confirms the patient exists. A doctor walking `PT-1000`,
 * `PT-1001`, `PT-1002` against a 403/404 split would learn the clinic's
 * entire patient roster without opening a single chart — the enumeration
 * is the disclosure, and no chart was read. ADR-022's consequences
 * require the negative test for exactly this, and API §0.4 allows
 * "403/404" so that the server can choose the non-disclosing one.
 *
 * ## 3. Holding a capability is not a care relationship
 *
 * `patients.view` gets an administrator the *masked* directory
 * (API §4.1, §4.11). It does not create a care relationship, and this
 * service never consults the capability set to invent one. That is
 * reconciliation §5 rule 5: authorization never asks "is this the
 * admin", and a capability check that special-cases an identity is a
 * defect. An administrator who needs an identifier elevates through the
 * audited reveal of RM M7.3 — a different path, with a different record.
 */

import { Inject, Injectable, Logger, Optional } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception';
import { runAsSystem } from '../database';
import {
  type ClinicalEmployment,
  type ClinicalReach,
  PATIENT_ASSIGNMENT_REPOSITORY,
  type PatientAssignmentRepository,
  type Principal,
} from './authz.types';
import { HospitalPatientScopeShadow } from './hospital-patient-scope.shadow';

@Injectable()
export class PatientScopeService {
  private readonly logger = new Logger(PatientScopeService.name);

  constructor(
    @Inject(PATIENT_ASSIGNMENT_REPOSITORY)
    private readonly assignments: PatientAssignmentRepository,
    /**
     * Phase 22 shadow comparison (hospital-aware rule). Optional and
     * observation-only: it runs after the legacy decision is made, its
     * result is discarded, and its failures are swallowed. Removing it
     * changes nothing a caller can see.
     */
    @Optional() private readonly shadow?: HospitalPatientScopeShadow,
  ) {}

  /**
   * Whether this principal may reach this patient's clinical data.
   *
   * Only `doctor` can hold a care relationship. Every other platform
   * role — admin included — reaches patient data through the masked
   * projections of API §4.11, not through this service, so the honest
   * answer for them is no.
   */
  async canReach(principal: Principal, patientId: string): Promise<boolean> {
    // The legacy rule, unchanged: it alone decides. A repository failure
    // still propagates from here, before any shadow work starts.
    const allowed =
      principal.roleCode === 'doctor'
        ? // The DR-05 check itself reads the patient's records across the
          // tenant boundary it decides: a trusted `system`-scope lookup.
          await runAsSystem(() => this.assignments.reachesPatient(principal.userId, patientId))
        : false;

    // Started, never awaited: the decision above is returned at once, however
    // slow, hung or failing the shadow is (security audit F1).
    this.observeShadow(principal, patientId, allowed);
    return allowed;
  }

  /**
   * Starts the shadow comparison detached from the authorization path.
   *
   * Synchronous: it returns before the comparison settles, so nothing the
   * shadow does can delay or change `allowed`. Both failure modes are
   * contained here — a synchronous throw by the `try`, an asynchronous
   * rejection by the handler attached before this method returns — so no
   * rejection can go unhandled. No queue or timer is created, and the
   * result is discarded either way.
   *
   * C1 (#26): a comparison runs only if the shadow admits it (in-flight
   * cap); otherwise it is skipped. An admitted comparison's slot is released
   * exactly once, whether it resolves, rejects (including a statement
   * timeout, `57014`) or throws synchronously.
   */
  private observeShadow(principal: Principal, patientId: string, allowed: boolean): void {
    const shadow = this.shadow;
    if (shadow === undefined) return;

    let release: (() => void) | null;
    try {
      release = shadow.admit();
    } catch {
      this.logger.warn('Patient scope shadow comparison unavailable');
      return;
    }
    if (release === null) return;
    const done = release;

    let comparison: Promise<unknown>;
    try {
      comparison = Promise.resolve(shadow.compare(principal, patientId, allowed));
    } catch {
      done();
      this.logger.warn('Patient scope shadow comparison unavailable');
      return;
    }
    comparison.then(done, () => {
      done();
      this.logger.warn('Patient scope shadow comparison unavailable');
    });
  }

  /**
   * The form call sites should prefer.
   *
   * Throwing rather than returning a boolean is deliberate: a call site
   * that ignores a `false` still runs the query it was guarding, whereas
   * one that ignores an exception does not exist. ADR-022 accepts
   * service-layer scoping in v1 on the basis that every path goes
   * through here, and this signature is what makes "went through here"
   * and "was actually stopped" the same event.
   */
  async assertCanReach(principal: Principal, patientId: string): Promise<void> {
    if (await this.canReach(principal, patientId)) return;

    // Deliberately identical to the message a genuinely missing patient
    // would produce, and carrying no patient id: the response must not
    // distinguish "not yours" from "does not exist" (MG §11.6 also
    // forbids PHI in error messages).
    throw AppException.notFound('Patient not found');
  }

  /**
   * `assertCanReach`, returning where the reach holds (audit F-01): the
   * doctor's clinical hospital and the patient's record there. A clinical
   * read filters every row by `hospitalId`; a clinical write is stamped with
   * both. Same 404 as `assertCanReach` otherwise.
   */
  async reachAt(principal: Principal, patientId: string): Promise<ClinicalReach> {
    const reach =
      principal.roleCode === 'doctor'
        ? await runAsSystem(() => this.assignments.clinicalReach(principal.userId, patientId))
        : null;
    this.observeShadow(principal, patientId, reach !== null);
    if (reach !== null) return reach;
    throw AppException.notFound('Patient not found');
  }

  /**
   * The hospital a doctor's clinical lists are scoped to, or `null` (no
   * unambiguous clinical standing: such a list is empty, never unscoped).
   */
  async clinicalHospitalOf(principal: Principal): Promise<string | null> {
    if (principal.roleCode !== 'doctor') return null;
    return runAsSystem(() => this.assignments.clinicalHospital(principal.userId));
  }

  /**
   * The employment behind `clinicalHospitalOf` — the scope of the doctor's
   * own reports (S4) — or `null` without unambiguous clinical standing.
   */
  async clinicalEmployment(principal: Principal): Promise<ClinicalEmployment | null> {
    if (principal.roleCode !== 'doctor') return null;
    return runAsSystem(() => this.assignments.clinicalEmployment(principal.userId));
  }
}
