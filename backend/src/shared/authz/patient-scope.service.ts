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

import { Inject, Injectable } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception';
import {
  PATIENT_ASSIGNMENT_REPOSITORY,
  type PatientAssignmentRepository,
  type Principal,
} from './authz.types';

@Injectable()
export class PatientScopeService {
  constructor(
    @Inject(PATIENT_ASSIGNMENT_REPOSITORY)
    private readonly assignments: PatientAssignmentRepository,
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
    if (principal.roleCode !== 'doctor') return false;

    return this.assignments.isAssigned(principal.userId, patientId);
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
}
