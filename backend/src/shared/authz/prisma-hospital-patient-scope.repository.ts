import { Injectable } from '@nestjs/common';

import { DoctorVerificationStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../database';
import type {
  ClinicalEmployment,
  HospitalPatientScopeRepository,
  LiveAssignmentScope,
} from './hospital-patient-scope';
import {
  ACTIVE_HOSPITAL_FILTER,
  CLINICAL_PRACTICE_STATUSES,
} from './prisma-hospital-context.repository';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The two reads behind the authoritative hospital-aware patient scope
 * (`hospital-patient-scope.ts`). Read-only; neither is cached across a
 * request boundary, and the assignment read is never cached at all (audit
 * F6: a memo keyed by patient handle went stale when the request itself
 * created or revoked an assignment).
 *
 * The Phase 22 shadow ran this query in its own transaction with a
 * transaction-local `statement_timeout` because it competed with real
 * traffic for nothing; it now *is* the authorization path, so it runs as an
 * ordinary query like the legacy `isAssigned` it replaces.
 */
@Injectable()
export class PrismaHospitalPatientScopeRepository implements HospitalPatientScopeRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `deletedAt` is explicit on the doctor because the soft-delete extension
   * filters top-level reads only, never a relation filter such as
   * `doctor: { is: … }`; the employment row is the top-level model here.
   */
  async activeClinicalEmployments(doctorUserId: string): Promise<readonly ClinicalEmployment[]> {
    const rows = await this.prisma.db.doctorEmployment.findMany({
      where: {
        endedAt: null,
        doctor: {
          is: {
            userId: doctorUserId,
            deletedAt: null,
            verificationStatus: DoctorVerificationStatus.VERIFIED,
            // A fresh array per query: Prisma's filter type is mutable.
            practiceStatus: { in: [...CLINICAL_PRACTICE_STATUSES] },
          },
        },
        hospital: { is: ACTIVE_HOSPITAL_FILTER },
      },
      select: { id: true, doctorId: true, hospitalId: true },
      take: 2,
    });

    return rows.map((row) => ({
      doctorId: row.doctorId,
      doctorEmploymentId: row.id,
      hospitalId: row.hospitalId,
    }));
  }

  /**
   * The base client, not `prisma.db`: `patient_doctor_assignments` has no
   * `deleted_at`, so the soft-delete extension adds nothing here.
   */
  async liveAssignmentScopes(
    doctorUserId: string,
    patientId: string,
  ): Promise<readonly LiveAssignmentScope[]> {
    return this.prisma.patientDoctorAssignment.findMany({
      where: {
        revokedAt: null,
        doctor: { userId: doctorUserId },
        // Either the public `PT-…` handle or the uuid. Both are unique, so
        // the disjunction cannot match two patients. A uuid comparison is
        // only added for a uuid-shaped input: Postgres rejects a malformed
        // uuid literal with a type error rather than matching nothing.
        patient: {
          OR: [{ publicId: patientId }, ...(UUID.test(patientId) ? [{ id: patientId }] : [])],
        },
      },
      select: {
        patientId: true,
        hospitalId: true,
        hospitalMedicalRecordId: true,
        doctorEmploymentId: true,
      },
      // `one_live_per_pair` allows one; two would still be read and judged.
      take: 2,
    });
  }
}
