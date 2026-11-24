import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database';
import type { AdminScopeFacts, AdminScopeRepository } from './admin-scope.service';
import { ACTIVE_HOSPITAL_STATUS } from './prisma-hospital-context.repository';

/**
 * Reads the two facts administrative scope is decided from (S5). Both from
 * authoritative tables, per request:
 *
 * - a live `platform_admin_assignments` row (the explicit designation);
 * - every live hospital `admin` assignment, **including** those at a
 *   suspended or deleted hospital, so the resolver can tell "one assignment
 *   at an inactive hospital" (refused) from "one at an active hospital" —
 *   filtering inactive hospitals out here would let a second, inactive
 *   assignment silently turn an ambiguous account into a scoped one.
 */
@Injectable()
export class PrismaAdminScopeRepository implements AdminScopeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async facts(userId: string): Promise<AdminScopeFacts> {
    const [platform, assignments] = await Promise.all([
      this.prisma.platformAdminAssignment.findFirst({
        where: { userId, revokedAt: null },
        select: { id: true },
      }),
      this.prisma.hospitalRoleAssignment.findMany({
        where: { userId, revokedAt: null, role: { is: { code: 'admin' } } },
        select: {
          hospitalId: true,
          hospital: { select: { name: true, status: true, deletedAt: true } },
        },
      }),
    ]);

    return {
      platformAdmin: platform !== null,
      hospitalAdminAssignments: assignments.map(({ hospitalId, hospital }) => ({
        hospitalId,
        hospitalName: hospital.name,
        hospitalActive: hospital.status === ACTIVE_HOSPITAL_STATUS && hospital.deletedAt === null,
      })),
    };
  }
}
