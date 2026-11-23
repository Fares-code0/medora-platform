import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../database';
import { PrismaHospitalContextRepository } from './prisma-hospital-context.repository';

describe('PrismaHospitalContextRepository', () => {
  it('resolves only active doctor employment and detects more than one row', async () => {
    const findMany = vi.fn().mockResolvedValue([{ hospitalId: 'hospital-a' }]);
    const prisma = {
      db: { doctorEmployment: { findMany } },
    } as unknown as PrismaService;
    const repository = new PrismaHospitalContextRepository(prisma);

    await expect(repository.activeDoctorEmploymentHospitalIds('user-1')).resolves.toEqual([
      'hospital-a',
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { endedAt: null, doctor: { is: { userId: 'user-1' } } },
      select: { hospitalId: true },
      take: 2,
    });
  });

  it('resolves only unrevoked hospital-admin assignments', async () => {
    const findMany = vi.fn().mockResolvedValue([{ hospitalId: 'hospital-a' }]);
    const prisma = {
      db: { hospitalRoleAssignment: { findMany } },
    } as unknown as PrismaService;
    const repository = new PrismaHospitalContextRepository(prisma);

    await expect(repository.activeHospitalAdminHospitalIds('user-1')).resolves.toEqual([
      'hospital-a',
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        revokedAt: null,
        role: { is: { code: 'admin' } },
      },
      select: { hospitalId: true },
      take: 3,
    });
  });
});
