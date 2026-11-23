import { describe, expect, it, vi } from 'vitest';

import type { PrismaService } from '../database';
import { PrismaHospitalContextRepository } from './prisma-hospital-context.repository';

describe('PrismaHospitalContextRepository', () => {
  it('loads one active doctor employment and its hospital display name', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([{ hospitalId: 'hospital-a', hospital: { name: 'North Hospital' } }]);
    const prisma = {
      db: { doctorEmployment: { findMany } },
    } as unknown as PrismaService;
    const repository = new PrismaHospitalContextRepository(prisma);

    await expect(repository.activeDoctorEmploymentHospitals('user-1')).resolves.toEqual([
      { id: 'hospital-a', name: 'North Hospital' },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        endedAt: null,
        doctor: { is: { userId: 'user-1' } },
        hospital: { is: { status: 'ACTIVE', deletedAt: null } },
      },
      select: { hospitalId: true, hospital: { select: { name: true } } },
      take: 2,
    });
  });

  it('selects active hospital-admin assignments with distinct hospital ids', async () => {
    const findMany = vi
      .fn()
      .mockResolvedValue([{ hospitalId: 'hospital-a', hospital: { name: 'North Hospital' } }]);
    const prisma = {
      db: { hospitalRoleAssignment: { findMany } },
    } as unknown as PrismaService;
    const repository = new PrismaHospitalContextRepository(prisma);

    await expect(repository.activeHospitalAdminHospitals('user-1')).resolves.toEqual([
      { id: 'hospital-a', name: 'North Hospital' },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        revokedAt: null,
        role: { is: { code: 'admin' } },
        hospital: { is: { status: 'ACTIVE', deletedAt: null } },
      },
      select: { hospitalId: true, hospital: { select: { name: true } } },
      distinct: ['hospitalId'],
    });
  });
});
