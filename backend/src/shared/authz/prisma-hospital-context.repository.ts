import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database';
import type {
  HospitalContextHospital,
  HospitalContextRepository,
} from './hospital-context.service';

@Injectable()
export class PrismaHospitalContextRepository implements HospitalContextRepository {
  constructor(private readonly prisma: PrismaService) {}

  async activeDoctorEmploymentHospitals(
    userId: string,
  ): Promise<readonly HospitalContextHospital[]> {
    const rows = await this.prisma.db.doctorEmployment.findMany({
      where: { endedAt: null, doctor: { is: { userId } } },
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
      },
      select: { hospitalId: true, hospital: { select: { name: true } } },
      distinct: ['hospitalId'],
    });
    return rows.map(({ hospitalId, hospital }) => ({ id: hospitalId, name: hospital.name }));
  }
}
