import { Injectable } from '@nestjs/common';

import { DoctorPracticeStatus } from '../../generated/prisma/enums';
import { PrismaService } from '../database';
import type {
  HospitalContextHospital,
  HospitalContextRepository,
} from './hospital-context.service';

/**
 * The only hospital state that yields a context: an allow-list, not a
 * deny-list. `SUSPENDED`, `INACTIVE`, a soft-deleted row, or any status a
 * later migration adds all fail closed and read as missing context.
 */
export const ACTIVE_HOSPITAL_STATUS = 'ACTIVE';
export const ACTIVE_HOSPITAL_FILTER = {
  status: ACTIVE_HOSPITAL_STATUS,
  deletedAt: null,
} as const;

/**
 * The doctor practice states that may hold a clinical hospital context
 * (audit F4, issue #22). An allow-list for the same reason as the hospital
 * filter: `SUSPENDED`, and any state a later migration adds, fail closed.
 *
 * `VACATION` stays on the list only because it is on the Database reference
 * rule (`app_rls.effective_doctor_hospital` in
 * `prisma/rls-proposal/phase22-rls-proposal.sql`) and resolved today; the
 * owner decision on vacation and verification is still open (#18). This list
 * and that function must change together when #18 is decided.
 */
export const CLINICAL_PRACTICE_STATUSES: readonly DoctorPracticeStatus[] = [
  DoctorPracticeStatus.ACTIVE,
  DoctorPracticeStatus.VACATION,
];

/**
 * Doctor profile filter: practice status on the allow-list and not
 * soft-deleted. `deletedAt` is explicit because the soft-delete extension
 * filters top-level reads only, not a relation filter such as
 * `doctor: { is: … }` — the employment row is the top-level model here.
 */
function clinicalDoctorFilter(): {
  deletedAt: null;
  practiceStatus: { in: DoctorPracticeStatus[] };
} {
  // A fresh array per query: Prisma's filter type is mutable.
  return { deletedAt: null, practiceStatus: { in: [...CLINICAL_PRACTICE_STATUSES] } };
}

@Injectable()
export class PrismaHospitalContextRepository implements HospitalContextRepository {
  constructor(private readonly prisma: PrismaService) {}

  async activeDoctorEmploymentHospitals(
    userId: string,
  ): Promise<readonly HospitalContextHospital[]> {
    const rows = await this.prisma.db.doctorEmployment.findMany({
      where: {
        endedAt: null,
        doctor: { is: { userId, ...clinicalDoctorFilter() } },
        hospital: { is: ACTIVE_HOSPITAL_FILTER },
      },
      select: { hospitalId: true, hospital: { select: { name: true } } },
      take: 2,
    });
    return rows.map(({ hospitalId, hospital }) => ({ id: hospitalId, name: hospital.name }));
  }

  async activeHospitalAdminHospitals(userId: string): Promise<readonly HospitalContextHospital[]> {
    const rows = await this.prisma.db.hospitalRoleAssignment.findMany({
      where: {
        userId,
        revokedAt: null,
        role: { is: { code: 'admin' } },
        hospital: { is: ACTIVE_HOSPITAL_FILTER },
      },
      select: { hospitalId: true, hospital: { select: { name: true } } },
      distinct: ['hospitalId'],
    });
    return rows.map(({ hospitalId, hospital }) => ({ id: hospitalId, name: hospital.name }));
  }

  async hasActivePlatformAdminGrant(userId: string): Promise<boolean> {
    const grant = await this.prisma.db.platformAdminGrant.findFirst({
      where: { userId, revokedAt: null, user: { is: { role: { is: { code: 'admin' } } } } },
      select: { id: true },
    });
    return grant !== null;
  }
}
