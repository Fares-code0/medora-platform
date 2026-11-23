/**
 * Roles, the permission matrix and per-user overrides (RM M7.4,
 * API §15 — DB §A1–A3, §A5).
 *
 * ## The matrix is `role_permissions`; the revision is its own row
 *
 * The grid the resolver reads is the join table, and that stays the
 * authoritative copy — a second, denormalised copy of the matrix would
 * be a second thing to get out of sync with the rows every authorization
 * decision is made from.
 *
 * What the join table cannot hold is a **revision**: it is a set of rows
 * with no aggregate identity, so "the matrix as it stood when this
 * editor opened" has nothing to compare against. `permission_matrix_state`
 * is that identity — one row, pinned to `id = 1` by a CHECK.
 *
 * `platform_settings` looked like the obvious home and is not one:
 * `platform_settings_key_check` restricts it to DB §L1's eleven slice
 * keys, deliberately, so that a typo cannot shadow a real slice. A
 * matrix revision is not a settings slice an administrator edits in a
 * panel, and widening that CHECK to admit one would have spent the
 * property the constraint exists for.
 *
 * ## The save is one transaction, and the compare-and-set is inside it
 *
 * `replaceMatrix` bumps the revision *conditionally on the expected
 * value* and only then rewrites the rows. Two administrators saving
 * together therefore cannot both succeed: the second's update matches no
 * row, the transaction rolls back, and nothing has been written. Doing
 * the check before the transaction would leave the familiar window
 * between reading a version and acting on it.
 */

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../shared/database';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The singleton row's primary key — pinned by a CHECK in the migration. */
const MATRIX_STATE_ID = 1;

export interface RoleRow {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly isSystem: boolean;
  readonly baseRole: { readonly code: string } | null;
  readonly members: number;
  readonly activeMembers: number;
}

export interface MatrixRevisionRow {
  readonly revision: number;
  readonly updatedAt: Date;
  /** `users.public_id` of the last saver, or null for the seeded baseline. */
  readonly updatedBy: string | null;
}

/** Raised when the stored revision is not the one the caller expected. */
export class MatrixRevisionConflict extends Error {
  constructor() {
    super('The permission matrix changed since this editor was opened');
    this.name = 'MatrixRevisionConflict';
  }
}

@Injectable()
export class RolesRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every role with its member counts (API §15.1).
   *
   * The two counts come from **one** `groupBy` rather than from a
   * `_count` plus a filtered relation load. Prisma issues a relation
   * selection as its own statement, so those were two snapshots of a
   * moving table: an account created between them was counted as active
   * without being counted as a member, and `activeMembers` came back
   * greater than `members` — an impossible pair the administrator's
   * roster renders verbatim. One grouped statement cannot disagree with
   * itself.
   *
   * It is also the shape that survives growth: the relation load pulled
   * every active user's id into memory to take `.length`, which is a
   * table scan per role on a real roster.
   */
  async roles(): Promise<readonly RoleRow[]> {
    const [rows, counts] = await Promise.all([
      this.prisma.db.role.findMany({
        select: {
          id: true,
          code: true,
          label: true,
          isSystem: true,
          baseRole: { select: { code: true } },
        },
        orderBy: { code: 'asc' },
      }),
      this.memberCountsByRoleId(),
    ]);

    return rows.map((row) => {
      const count = counts[row.id];

      return {
        id: row.id,
        code: row.code,
        label: row.label,
        isSystem: row.isSystem,
        baseRole: row.baseRole,
        members: count?.members ?? 0,
        // Counted rather than derived from `members`: a change to a role
        // reaches the accounts that can sign in, and only those.
        activeMembers: count?.activeMembers ?? 0,
      };
    });
  }

  /**
   * `roleId → { members, activeMembers }`, from a single grouped count.
   *
   * Grouping by `status` as well as `roleId` is what keeps the pair
   * consistent: both numbers are derived from the same result set, so
   * `activeMembers <= members` holds by construction rather than by
   * timing.
   */
  private async memberCountsByRoleId(): Promise<
    Readonly<Record<string, { members: number; activeMembers: number }>>
  > {
    const grouped = await this.prisma.db.user.groupBy({
      by: ['roleId', 'status'],
      _count: { _all: true },
    });

    const counts: Record<string, { members: number; activeMembers: number }> = {};

    for (const row of grouped) {
      const bucket = (counts[row.roleId] ??= { members: 0, activeMembers: 0 });
      bucket.members += row._count._all;
      if (row.status === 'ACTIVE') bucket.activeMembers += row._count._all;
    }

    return counts;
  }

  findRoleByCode(code: string): Promise<{ id: string; code: string; isSystem: boolean } | null> {
    return this.prisma.db.role.findUnique({
      where: { code },
      select: { id: true, code: true, isSystem: true },
    });
  }

  /**
   * Active account counts per role code — the preview's denominator.
   *
   * Counted in the database rather than by loading every active user's
   * id and taking `.length`: the preview only ever renders the number.
   */
  async activeMembersByRole(): Promise<Readonly<Record<string, number>>> {
    const [roles, grouped] = await Promise.all([
      this.prisma.db.role.findMany({ select: { id: true, code: true } }),
      this.prisma.db.user.groupBy({
        by: ['roleId'],
        where: { status: 'ACTIVE' },
        _count: { _all: true },
      }),
    ]);

    const byRoleId = new Map(grouped.map((row) => [row.roleId, row._count._all] as const));

    return Object.fromEntries(
      roles.map((role) => [role.code, byRoleId.get(role.id) ?? 0] as const),
    );
  }

  /** The stored grid as `{ roleCode: [permissionCode, …] }`. */
  async matrix(): Promise<Record<string, string[]>> {
    const rows = await this.prisma.db.rolePermission.findMany({
      select: { role: { select: { code: true } }, permission: { select: { code: true } } },
    });

    const matrix: Record<string, string[]> = {};
    for (const row of rows) (matrix[row.role.code] ??= []).push(row.permission.code);

    return matrix;
  }

  /**
   * The revision row, created on first read if the migration's baseline
   * insert was somehow rolled back.
   *
   * Revision 1 and not 0 for the baseline, matching the frontend's
   * `DEFAULT_PERMISSION_STATE.revision`. A seeded platform and a freshly
   * read one therefore report the same number, so an editor opened
   * against either can save against the other.
   */
  async revision(): Promise<MatrixRevisionRow> {
    const row = await this.prisma.db.permissionMatrixState.upsert({
      where: { id: MATRIX_STATE_ID },
      create: { id: MATRIX_STATE_ID, revision: 1 },
      update: {},
      select: { revision: true, updatedAt: true, updater: { select: { publicId: true } } },
    });

    return {
      revision: row.revision,
      updatedAt: row.updatedAt,
      updatedBy: row.updater?.publicId ?? null,
    };
  }

  /**
   * Replaces the whole grid, atomically, only if the revision still
   * matches (API §15.3).
   *
   * The rows are deleted and re-inserted rather than diffed. The grid is
   * five roles by twenty-two capabilities — at most 110 rows — and a diff
   * would be three statements' worth of extra logic on a table small
   * enough to rewrite. `grantedBy` is stamped on every row, so the join
   * table itself records who last set each cell.
   */
  async replaceMatrix(input: {
    readonly grid: Readonly<Record<string, readonly string[]>>;
    readonly expectedRevision: number;
    readonly actorId: string;
  }): Promise<MatrixRevisionRow> {
    return this.prisma.$transaction(async (tx) => {
      // The compare-and-set, and the only check there is. `updateMany`
      // with the expected revision in the predicate: if a concurrent
      // transaction committed a bump first, no row matches, this throws
      // and the whole transaction rolls back rather than overwriting
      // their save. A read-then-write would leave the familiar window
      // between learning the version and acting on it.
      const bumped = await tx.permissionMatrixState.updateMany({
        where: { id: MATRIX_STATE_ID, revision: input.expectedRevision },
        data: {
          revision: input.expectedRevision + 1,
          ...(UUID.test(input.actorId) ? { updatedBy: input.actorId } : {}),
        },
      });

      if (bumped.count !== 1) throw new MatrixRevisionConflict();

      const roles = await tx.role.findMany({ select: { id: true, code: true } });
      const permissions = await tx.permission.findMany({ select: { id: true, code: true } });
      const roleId = new Map(roles.map((role) => [role.code, role.id] as const));
      const permissionId = new Map(permissions.map((row) => [row.code, row.id] as const));

      const rows: { roleId: string; permissionId: string; grantedBy?: string }[] = [];
      for (const [code, capabilities] of Object.entries(input.grid)) {
        const role = roleId.get(code);
        if (role === undefined) continue;

        for (const capability of capabilities) {
          const permission = permissionId.get(capability);
          // A capability with no row is dropped rather than failing the
          // save: the catalogue is validated at the DTO boundary, so
          // reaching here means the `permissions` table is missing a
          // seeded row, which is a seeding problem and not this
          // administrator's to be blocked by.
          if (permission === undefined) continue;

          rows.push({
            roleId: role,
            permissionId: permission,
            ...(UUID.test(input.actorId) ? { grantedBy: input.actorId } : {}),
          });
        }
      }

      // Scoped to the roles being written. A blanket delete would clear
      // the bundle of any role outside the matrix — `nurse` today — and
      // the insert would not put it back, silently revoking a role the
      // editor does not even display.
      await tx.rolePermission.deleteMany({
        where: { role: { code: { in: Object.keys(input.grid) } } },
      });
      await tx.rolePermission.createMany({ data: rows });

      // Every member of an edited role gets a new authorization version in
      // this transaction, so a permission set cached before the edit is
      // never served again (multi-hospital §2.9), even if the cache
      // eviction that follows the commit fails.
      await tx.user.updateMany({
        where: { role: { code: { in: Object.keys(input.grid) } } },
        data: { authzVersion: { increment: 1 } },
      });

      const saved = await tx.permissionMatrixState.findUniqueOrThrow({
        where: { id: MATRIX_STATE_ID },
        select: { revision: true, updatedAt: true, updater: { select: { publicId: true } } },
      });

      return {
        revision: saved.revision,
        updatedAt: saved.updatedAt,
        updatedBy: saved.updater?.publicId ?? null,
      };
    });
  }

  /** Creates a custom role carrying a copy of the template's bundle. */
  async createFromTemplate(input: {
    readonly code: string;
    readonly label: string;
    readonly baseRoleId: string;
    readonly actorId: string;
  }): Promise<RoleRow> {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.role.create({
        data: {
          code: input.code,
          label: input.label,
          baseRoleId: input.baseRoleId,
          // `is_system` false is what marks a role an administrator made,
          // and it is what a later "delete this role" would check.
          isSystem: false,
          ...(UUID.test(input.actorId) ? { createdBy: input.actorId } : {}),
        },
        select: {
          id: true,
          code: true,
          label: true,
          isSystem: true,
          baseRole: { select: { code: true } },
        },
      });

      const template = await tx.rolePermission.findMany({
        where: { roleId: input.baseRoleId },
        select: { permissionId: true },
      });

      if (template.length > 0) {
        await tx.rolePermission.createMany({
          data: template.map((row) => ({
            roleId: created.id,
            permissionId: row.permissionId,
            ...(UUID.test(input.actorId) ? { grantedBy: input.actorId } : {}),
          })),
        });
      }

      // A role created a moment ago has no members. Stated rather than
      // queried — the count would be a round trip for a known zero.
      return { ...created, members: 0, activeMembers: 0 };
    });
  }

  /** The overrides on one account, by its public id (API §15.5). */
  async overridesFor(
    publicId: string,
  ): Promise<{ userId: string; role: string; granted: string[]; revoked: string[] } | null> {
    const user = await this.prisma.db.user.findFirst({
      where: { publicId },
      select: {
        id: true,
        role: { select: { code: true } },
        permissions: { select: { allowed: true, permission: { select: { code: true } } } },
      },
    });

    if (user === null) return null;

    const granted: string[] = [];
    const revoked: string[] = [];
    for (const row of user.permissions) {
      (row.allowed ? granted : revoked).push(row.permission.code);
    }

    return { userId: user.id, role: user.role.code, granted, revoked };
  }

  /**
   * Replaces one account's overrides wholesale.
   *
   * Delete-then-insert inside a transaction, for the same reason the
   * matrix save is: a `PUT` means "these are the overrides now", and a
   * merge would leave a row the administrator believed they had removed.
   */
  async replaceOverrides(input: {
    readonly userId: string;
    readonly granted: readonly string[];
    readonly revoked: readonly string[];
    readonly actorId: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.userPermission.deleteMany({ where: { userId: input.userId } });

      const permissions = await tx.permission.findMany({ select: { id: true, code: true } });
      const permissionId = new Map(permissions.map((row) => [row.code, row.id] as const));

      const rows = [
        ...input.granted.map((code) => ({ code, allowed: true })),
        ...input.revoked.map((code) => ({ code, allowed: false })),
      ]
        .map((entry) => {
          const id = permissionId.get(entry.code);
          return id === undefined
            ? null
            : {
                userId: input.userId,
                permissionId: id,
                allowed: entry.allowed,
                ...(UUID.test(input.actorId) ? { grantedBy: input.actorId } : {}),
              };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null);

      if (rows.length > 0) await tx.userPermission.createMany({ data: rows });

      // Same transaction as the overrides: the cached set is stale the moment
      // this commits (§2.9).
      await tx.user.update({
        where: { id: input.userId },
        data: { authzVersion: { increment: 1 } },
      });
    });
  }
}
