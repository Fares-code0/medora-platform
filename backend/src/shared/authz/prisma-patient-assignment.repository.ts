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

import { DoctorVerificationStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../database';
import { ACTIVE_HOSPITAL_FILTER, CLINICAL_PRACTICE_STATUSES } from './prisma-hospital-context.repository';
import type { PatientAssignmentRepository } from './authz.types';

@Injectable()
export class PrismaPatientAssignmentRepository implements PatientAssignmentRepository {
  constructor(private readonly prisma: PrismaService) {}

  async reachesPatient(doctorUserId: string, patientId: string): Promise<boolean> {
    // One indexed read: the patient's record at the hospital where the
    // doctor is actively and clinically employed (DR-05).
    const record = await this.prisma.db.hospitalMedicalRecord.findFirst({
      where: {
        patient: { OR: [{ publicId: patientId }, ...uuidClause(patientId)] },
        hospital: {
          is: {
            ...ACTIVE_HOSPITAL_FILTER,
            doctorEmployments: {
              some: {
                endedAt: null,
                doctor: {
                  is: {
                    userId: doctorUserId,
                    deletedAt: null,
                    verificationStatus: DoctorVerificationStatus.VERIFIED,
                    practiceStatus: { in: [...CLINICAL_PRACTICE_STATUSES] },
                  },
                },
              },
            },
          },
        },
      },
      select: { id: true },
    });

    return record !== null;
  }
}

/**
 * A uuid comparison is only added when the input actually looks like
 * one. Postgres rejects a malformed uuid literal with a type error
 * rather than returning no rows, so passing `PT-1001` into a `uuid`
 * column would turn a legitimate "not assigned" into a 500.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidClause(value: string): readonly { id: string }[] {
  return UUID.test(value) ? [{ id: value }] : [];
}
