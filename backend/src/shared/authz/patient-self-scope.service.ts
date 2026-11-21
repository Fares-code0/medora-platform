/**
 * Patient self-scoping (ADR-030 §6).
 *
 * The mirror image of `PatientScopeService`. That service answers "may
 * this **doctor** reach this patient's chart" through the care
 * relationship; this one answers "**is** this caller that patient", which
 * is the only authorization question a `/me/*` route ever asks.
 *
 * ## Why this exists at all, rather than a capability
 *
 * `patient` is a role in the `roles` table with **no column in the
 * permission matrix** — the `nurse` precedent of ADR-029 §3, adopted for
 * a stronger reason. `PLATFORM_ROLES` is a transcription of
 * `frontend/src/features/admin/permissions.ts`, bound by a parity spec
 * that CI runs on frontend changes, so a sixth column cannot be added
 * from this tree; and the 22 capabilities are clinician capabilities an
 * administrator grants to staff, so a `patient` column would put every
 * patient into that editor as a grantable principal.
 *
 * The consequence is the good kind. A patient principal resolves to zero
 * capabilities, so **every `@Can(...)` route in the platform already
 * denies them** with nothing written and nothing to forget. What is left
 * is ownership, and ownership is not expressible as a decorator argument
 * — "may act on their own row" is a fact about a pair, not about a
 * principal. Hence a service, on the same reasoning ADR-022 used for care
 * scoping, and `@Roles()` deliberately stays typed to `PlatformRole` so
 * that it *cannot* name `patient`: a route must never be authorized by
 * "is a patient" alone.
 *
 * ## Out of scope is 404, never 403
 *
 * Inherited from `PatientScopeService` and for the same reason: a 403
 * confirms the row exists. A patient walking `APT-3001`, `APT-3002`
 * against a 403/404 split would learn the clinic's booking volume without
 * reading one appointment — the enumeration *is* the disclosure. API §0.4
 * permits "403/404" precisely so the server can pick the non-disclosing
 * one.
 *
 * ## An unlinked account is not an error
 *
 * `patientIdFor` returns `null` for an authenticated patient who has not
 * been linked to a clinical record, and that is the **normal** state
 * immediately after registration: ADR-030 §4 separates account creation
 * from record claiming, because claiming asserts "I am the person in
 * PT-1042" and a wrong assertion discloses one person's history to
 * another. Callers must render that as an empty collection or a
 * `patient: null` profile — a success — rather than as a failure. Only
 * `assertOwns`, which is asked about a *specific* row, turns it into a
 * 404, because an unlinked caller genuinely owns no row.
 */

import { Inject, Injectable } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception';
import { PATIENT_SELF_REPOSITORY, type PatientSelfRepository, type Principal } from './authz.types';

/** The role code seeded by `prisma/seed/permissions.ts` (ADR-030 §6). */
const PATIENT_ROLE = 'patient';

@Injectable()
export class PatientSelfScopeService {
  constructor(
    @Inject(PATIENT_SELF_REPOSITORY)
    private readonly patients: PatientSelfRepository,
  ) {}

  /**
   * The caller's own patient record, or `null`.
   *
   * `null` covers two different situations on purpose, because no caller
   * needs to tell them apart: the principal is not a patient at all (a
   * doctor or admin hitting a `/me/*` patient route), or is a patient
   * whose account has not been linked to a record. Both mean "this caller
   * has no patient data here", and collapsing them means a route cannot
   * accidentally leak which of the two it was.
   */
  async patientIdFor(principal: Principal): Promise<string | null> {
    if (principal.roleCode !== PATIENT_ROLE) return null;

    return this.patients.findPatientIdByUserId(principal.userId);
  }

  /**
   * Whether this principal is the patient identified by `patientId`.
   *
   * Accepts the public `PT-…` handle or the raw uuid, matching
   * `PatientScopeService`'s tolerance, so a caller that already resolved
   * one does not pay for a second lookup.
   */
  async owns(principal: Principal, patientId: string): Promise<boolean> {
    const own = await this.patientIdFor(principal);
    if (own === null) return false;

    return own === patientId;
  }

  /**
   * The form call sites should prefer.
   *
   * Throwing rather than returning a boolean, for the reason
   * `PatientScopeService.assertCanReach` gives: a call site that ignores
   * a `false` still runs the query it was guarding, whereas one that
   * ignores an exception does not exist.
   */
  async assertOwns(principal: Principal, patientId: string): Promise<void> {
    if (await this.owns(principal, patientId)) return;

    // Deliberately identical to the message a genuinely missing record
    // would produce, and carrying no identifier: the response must not
    // distinguish "not yours" from "does not exist", and MG §11.6 forbids
    // PHI in error messages besides.
    throw AppException.notFound('Patient not found');
  }
}
