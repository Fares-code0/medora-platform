/**
 * `PATIENT_ASSIGNMENT_REPOSITORY` against the real table (RM M7.2, M5.6).
 *
 * Replaces `UnassignedPatientAssignments`, which denied every query
 * because `patient_doctor_assignments` did not exist. It does now, so
 * this is the care relationship ADR-022 makes the v1 control.
 *
 * ## Three joins the port hides, and why each is needed
 *
 * The port asks `isAssigned(doctorUserId, patientId)` in the vocabulary
 * the *caller* has — a user id from the access token and the public
 * `PT-…` handle from the URL. The table is keyed by neither:
 *
 *  - `doctor_id` references `doctors.id`, not `users.id`. A doctor's
 *    user account and their clinical record are separate rows, so the
 *    token's subject has to be resolved through `doctors.user_id`.
 *  - `patient_id` references `patients.id`, a uuid, while every route
 *    quotes `patients.public_id`. Matching the public id against the
 *    uuid column would simply never match — a scoping check that always
 *    denies looks like it works right up until it locks a clinic out.
 *
 * Doing both as one query keeps it a single round trip on a path that
 * runs before every patient-child read.
 *
 * ## Only live assignments count
 *
 * `revoked_at` is the end of a care relationship. A revoked row must not
 * grant access, or removing a doctor from a patient's care would leave
 * them able to read the chart indefinitely — which is the whole thing
 * revocation exists to stop.
 */

import { Injectable } from '@nestjs/common';

import { decidePatientReach } from './hospital-patient-scope';
import type { PatientAssignmentRepository } from './authz.types';
import { PrismaHospitalPatientScopeRepository } from './prisma-hospital-patient-scope.repository';

/**
 * ## Since S3: only hospital-owned assignments count
 *
 * `isAssigned` answers with the authoritative hospital-aware rule
 * (`hospital-patient-scope.ts`), not with the bare row. A legacy row with
 * no hospital (#17), a row owned by another hospital or by an ended
 * employment, and any row of a doctor who is unverified, suspended,
 * soft-deleted or without an active employment (#18, OD-12) is "not
 * assigned". Keeping a hospital-blind variant of this port would leave a
 * second, weaker answer to the same question one import away.
 */
@Injectable()
export class PrismaPatientAssignmentRepository implements PatientAssignmentRepository {
  constructor(private readonly scopes: PrismaHospitalPatientScopeRepository) {}

  async isAssigned(doctorUserId: string, patientId: string): Promise<boolean> {
    const [employments, assignments] = await Promise.all([
      this.scopes.activeClinicalEmployments(doctorUserId),
      this.scopes.liveAssignmentScopes(doctorUserId, patientId),
    ]);

    return decidePatientReach(
      { userId: doctorUserId, roleCode: 'doctor' },
      employments,
      assignments,
    ).allowed;
  }
}
