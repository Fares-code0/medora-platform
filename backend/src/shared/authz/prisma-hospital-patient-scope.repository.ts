import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database';
import type {
  HospitalPatientScopeRepository,
  LiveAssignmentScope,
} from './hospital-patient-scope.shadow';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Read-only: the same live-assignment predicate as `isAssigned`, plus scope columns. */
@Injectable()
export class PrismaHospitalPatientScopeRepository implements HospitalPatientScopeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async liveAssignmentScopes(
    doctorUserId: string,
    patientId: string,
  ): Promise<readonly LiveAssignmentScope[]> {
    const rows = await this.prisma.db.patientDoctorAssignment.findMany({
      where: {
        revokedAt: null,
        doctor: { userId: doctorUserId },
        patient: {
          OR: [{ publicId: patientId }, ...(UUID.test(patientId) ? [{ id: patientId }] : [])],
        },
      },
      select: {
        hospitalId: true,
        hospitalMedicalRecordId: true,
        doctorEmploymentId: true,
        doctorEmployment: { select: { endedAt: true } },
      },
      // Two is enough to detect ambiguity; the shadow rule never picks one.
      take: 2,
    });

    return rows.map((row) => ({
      hospitalId: row.hospitalId,
      hospitalMedicalRecordId: row.hospitalMedicalRecordId,
      doctorEmploymentId: row.doctorEmploymentId,
      employmentEndedAt: row.doctorEmployment?.endedAt ?? null,
    }));
  }
}
