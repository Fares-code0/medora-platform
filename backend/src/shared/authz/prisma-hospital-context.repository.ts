import { Injectable } from '@nestjs/common';

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

@Injectable()
export class PrismaHospitalContextRepository implements HospitalContextRepository {
  constructor(private readonly prisma: PrismaService) {}

  async activeDoctorEmploymentHospitals(
    userId: string,
  ): Promise<readonly HospitalContextHospital[]> {
    const rows = await this.prisma.db.doctorEmployment.findMany({
      where: {
        endedAt: null,
        doctor: { is: { userId } },
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
}
