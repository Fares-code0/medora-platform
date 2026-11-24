/**
 * Care-relationship scoping (RM M7.2, ADR-022), hospital-aware since S3.
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
 * ## 1. The hospital-owned assignment is the anchor (S3)
 *
 * A doctor reaches a patient if and only if the doctor's one active,
 * clinically usable employment owns a live `patient_doctor_assignments`
 * row for that patient — the authoritative hospital-aware rule in
 * `hospital-patient-scope.ts` (#17, #18, DR-02, DR-05, DR-07, OD-12).
 * Never by matching a name: DECISIONS.md is explicit that "care-scoping by
 * name would be a security defect, not merely untidy", and ADR-003 removed
 * free-text doctor names precisely so this could not be built that way.
 *
 * A reachable patient comes with a **scope** — the active hospital, the
 * employment and the patient's hospital medical record there — which
 * callers use to show only that hospital's child rows and to stamp the
 * rows they create. A child row with no hospital (#17) or another
 * hospital's is not part of the chart this doctor may see.
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
 * Hospital Admin and Platform Admin get no clinical access here (OD-07).
 */

import { Inject, Injectable } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception';
import type { Principal } from './authz.types';
import {
  decidePatientReach,
  HOSPITAL_PATIENT_SCOPE_REPOSITORY,
  singleClinicalEmployment,
  type ClinicalEmployment,
  type HospitalPatientScopeRepository,
  type PatientClinicalScope,
  type PatientReachDecision,
} from './hospital-patient-scope';
import { memoizeInRequest } from './request-scope';

@Injectable()
export class PatientScopeService {
  constructor(
    @Inject(HOSPITAL_PATIENT_SCOPE_REPOSITORY)
    private readonly repository: HospitalPatientScopeRepository,
  ) {}

  /**
   * The doctor's one active, clinically usable employment, or `null`
   * (not a doctor; no, or more than one, active employment; unverified,
   * suspended or deleted doctor; inactive hospital). Server-derived only:
   * doctor-own lists filter by its hospital and writes stamp it (S4).
   *
   * Memoized per request: it depends only on the caller's own employment,
   * which no route lets the caller change about themselves. Outside a
   * request (jobs, unit tests) it is read every time.
   */
  async clinicalEmployment(principal: Principal): Promise<ClinicalEmployment | null> {
    if (principal.roleCode !== 'doctor') return null;
    const employment = singleClinicalEmployment(await this.employments(principal));
    return typeof employment === 'string' ? null : employment;
  }

  /**
   * The full decision: the scope on success, a diagnostic reason on
   * refusal. The assignment is read fresh on every call (audit F6).
   */
  async decide(principal: Principal, patientId: string): Promise<PatientReachDecision> {
    if (principal.roleCode !== 'doctor') return decidePatientReach(principal, [], []);

    const [employments, assignments] = await Promise.all([
      this.employments(principal),
      this.repository.liveAssignmentScopes(principal.userId, patientId),
    ]);
    return decidePatientReach(principal, employments, assignments);
  }

  /**
   * Whether this principal may reach this patient's clinical data.
   *
   * Only `doctor` can hold a care relationship. Every other platform
   * role — admin included — reaches patient data through the masked
   * projections of API §4.11, not through this service, so the honest
   * answer for them is no.
   */
  async canReach(principal: Principal, patientId: string): Promise<boolean> {
    return (await this.decide(principal, patientId)).allowed;
  }

  /**
   * The form call sites should prefer. Returns the scope the caller filters
   * child reads by and stamps writes with.
   *
   * Throwing rather than returning a boolean is deliberate: a call site
   * that ignores a `false` still runs the query it was guarding, whereas
   * one that ignores an exception does not exist. ADR-022 accepts
   * service-layer scoping in v1 on the basis that every path goes
   * through here, and this signature is what makes "went through here"
   * and "was actually stopped" the same event.
   */
  async assertCanReach(principal: Principal, patientId: string): Promise<PatientClinicalScope> {
    const decision = await this.decide(principal, patientId);
    if (decision.allowed) return decision.scope;

    // Deliberately identical to the message a genuinely missing patient
    // would produce, and carrying no patient id: the response must not
    // distinguish "not yours" from "does not exist" (MG §11.6 also
    // forbids PHI in error messages).
    throw AppException.notFound('Patient not found');
  }

  private employments(principal: Principal): Promise<readonly ClinicalEmployment[]> {
    return memoizeInRequest(`clinical-employment:${principal.userId}`, () =>
      this.repository.activeClinicalEmployments(principal.userId),
    );
  }
}
