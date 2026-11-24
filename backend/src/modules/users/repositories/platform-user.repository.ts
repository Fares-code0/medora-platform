/**
 * The administrator's view of the platform's accounts (RM M8.2,
 * API §2.10).
 *
 * ## This repository reads `users`, and nothing joined to a person
 *
 * The panel it serves lists staff accounts: name, address, role, whether
 * the account works. It does **not** reach `patients`, `doctors` or any
 * clinical table, and the `select` below is the enforcement — an
 * administrator's account list is not a route to a chart.
 *
 * ## Search is `contains`, deliberately not trigram yet
 *
 * `users` is a staff-sized table (tens to low hundreds of rows in a
 * clinic), and `ILIKE '%q%'` over it is a sequential scan of nothing.
 * M10.1 introduces the trigram indexes, and it does so for `patients`,
 * which is the table that actually grows. Adding an index here first
 * would be a migration in service of a query that is already instant.
 */

import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../generated/prisma/client';
import { UserStatus } from '../../../generated/prisma/enums';
import { PrismaService } from '../../../shared/database';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PlatformUserRow {
  readonly publicId: string;
  readonly displayName: string;
  readonly email: string;
  readonly status: UserStatus;
  readonly lastActiveAt: Date | null;
  readonly createdAt: Date;
  readonly role: { readonly code: string };
}

export interface PlatformUserCriteria {
  readonly q?: string | undefined;
  readonly role?: string | undefined;
  readonly active?: boolean | undefined;
  readonly page: number;
  readonly pageSize: number;
}

const LIST_SELECT = {
  publicId: true,
  displayName: true,
  email: true,
  status: true,
  lastActiveAt: true,
  createdAt: true,
  role: { select: { code: true } },
} as const;

@Injectable()
export class PlatformUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    criteria: PlatformUserCriteria,
  ): Promise<{ rows: readonly PlatformUserRow[]; totalItems: number }> {
    const where: Prisma.UserWhereInput = {
      ...(criteria.q === undefined
        ? {}
        : {
            OR: [
              { displayName: { contains: criteria.q, mode: 'insensitive' } },
              // `email` is citext, so it compares case-insensitively
              // already; `mode` on it would be redundant, not wrong.
              { email: { contains: criteria.q } },
            ],
          }),
      ...(criteria.role === undefined ? {} : { role: { code: criteria.role } }),
      // "Active" is `status = ACTIVE`. Soft-deleted rows are invisible to
      // `db` regardless, so `active: false` means "suspended, locked or
      // deactivated" — the three states an administrator can undo.
      ...(criteria.active === undefined
        ? {}
        : criteria.active
          ? { status: UserStatus.ACTIVE }
          : { status: { not: UserStatus.ACTIVE } }),
    };

    const [rows, totalItems] = await Promise.all([
      this.prisma.db.user.findMany({
        where,
        select: LIST_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (criteria.page - 1) * criteria.pageSize,
        take: criteria.pageSize,
      }),
      this.prisma.db.user.count({ where }),
    ]);

    return { rows, totalItems };
  }

  /**
   * One account by its **public** id.
   *
   * The route parameter is `usr_…`, which is what an administrator sees
   * and what the list returned. Resolving it here rather than making the
   * caller pass a uuid keeps the internal key off the wire entirely.
   */
  findByPublicId(publicId: string): Promise<PlatformUserRow | null> {
    return this.prisma.db.user.findFirst({ where: { publicId }, select: LIST_SELECT });
  }

  /** The internal id and current role of an account, for the update path. */
  findIdentity(
    publicId: string,
  ): Promise<{ id: string; status: UserStatus; role: { code: string } } | null> {
    return this.prisma.db.user.findFirst({
      where: { publicId },
      select: { id: true, status: true, role: { select: { code: true } } },
    });
  }

  findRoleByCode(code: string): Promise<{ id: string; code: string; hospitalId: string | null } | null> {
    return this.prisma.db.role.findUnique({ where: { code }, select: { id: true, code: true, hospitalId: true } });
  }

  /** Whether the account works at `hospitalId` now (employment or affiliation) — F-17. */
  async worksAt(userId: string, hospitalId: string): Promise<boolean> {
    const count = await this.prisma.db.user.count({
      where: {
        id: userId,
        OR: [
          { doctor: { is: { employments: { some: { hospitalId, endedAt: null } } } } },
          { staffMember: { some: { hospitalAffiliations: { some: { hospitalId, endedAt: null } } } } },
        ],
      },
    });
    return count > 0;
  }

  /**
   * Applies a role and/or status change, recording the actor.
   *
   * Never a delete — API §2.10's business rule is "deactivation is soft
   * (never delete users with clinical trails)", and the whole of DB §7
   * says the same. There is no hard-delete path in this file and there
   * must not be one: a `users` row is referenced by appointments, records
   * and audit events, and removing it would orphan a clinical history.
   */
  async update(
    userId: string,
    actorId: string,
    data: { readonly roleId?: string | undefined; readonly status?: UserStatus | undefined },
  ): Promise<PlatformUserRow & { readonly adminScopesEnded: number }> {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          ...(data.roleId === undefined ? {} : { roleId: data.roleId }),
          ...(data.status === undefined ? {} : { status: data.status }),
          ...(UUID.test(actorId) ? { updatedBy: actorId } : {}),
          // Role and status are authorization: the cached permission set and
          // any token minted before this write are stale (ADR-046, §2.10).
          ...(data.roleId === undefined && data.status === undefined
            ? {}
            : { authzVersion: { increment: 1 } }),
        },
        select: LIST_SELECT,
      });

      // One model of admin standing (audit F-10): a Platform Admin grant or
      // a Hospital Admin assignment means something only on an `admin`
      // account. A demotion ends them in the same transaction, so a grant
      // never lingers to revive on a later re-promotion, and the database's
      // last-Platform-Admin invariant judges the demotion and the
      // revocation together at COMMIT.
      let adminScopesEnded = 0;
      if (data.roleId !== undefined && updated.role.code !== 'admin') {
        const now = new Date();
        const revokedBy = UUID.test(actorId) ? actorId : null;
        adminScopesEnded += (
          await tx.platformAdminGrant.updateMany({
            where: { userId, revokedAt: null },
            data: { revokedAt: now, ...(revokedBy === null ? {} : { revokedBy }) },
          })
        ).count;
        adminScopesEnded += (
          await tx.hospitalRoleAssignment.updateMany({
            where: { userId, revokedAt: null, role: { is: { code: 'admin' } } },
            data: { revokedAt: now },
          })
        ).count;
      }

      return { ...updated, adminScopesEnded };
    });
  }

  /**
   * Ends every live session for an account, returning how many.
   *
   * Deactivation has to close the door on sessions that are already
   * open, or the lever does nothing for the case it is pulled in — an
   * account being used right now. `RefreshService` refuses a non-ACTIVE
   * account as a second line of defence; this is the first.
   */
  async revokeSessions(userId: string): Promise<number> {
    const result = await this.prisma.db.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    return result.count;
  }

  /** How many ACTIVE accounts hold a given role — the last-admin guard. */
  countActiveWithRole(roleCode: string): Promise<number> {
    return this.prisma.db.user.count({
      where: { role: { code: roleCode }, status: UserStatus.ACTIVE },
    });
  }
}
