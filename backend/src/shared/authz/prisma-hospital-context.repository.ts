import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database';
import type { HospitalContextRepository } from './hospital-context.service';

@Injectable()
export class PrismaHospitalContextRepository implements HospitalContextRepository {
  constructor(private readonly prisma: PrismaService) {}

  async activeDoctorEmploymentHospitalIds(userId: string): Promise<readonly string[]> {
    const rows = await this.prisma.db.doctorEmployment.findMany({
      where: { endedAt: null, doctor: { is: { userId } } },
      select: { hospitalId: true },
      take: 2,
    });
    return rows.map(({ hospitalId }) => hospitalId);
  }

  async activeHospitalAdminHospitalIds(userId: string): Promise<readonly string[]> {
    const rows = await this.prisma.db.hospitalRoleAssignment.findMany({
      where: {
        userId,
        revokedAt: null,
        role: { is: { code: 'admin' } },
      },
      select: { hospitalId: true },
      take: 3,
    });
    return rows.map(({ hospitalId }) => hospitalId);
  }
}
