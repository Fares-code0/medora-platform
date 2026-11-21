/**
 * `ROLE_REPOSITORY` against the real tables (RM M7.1, M5.1, M5.2).
 *
 * Replaces `SeededRoleRepository`, which served the catalogue's own
 * constants because there were no `roles`, `role_permissions` or
 * `user_permissions` rows to read. There are now, so this reads them.
 *
 * ## Codes, not ids, all the way out
 *
 * Every method speaks role and permission **codes**. The uuids stay
 * inside this file. The resolver works against the capability union and
 * the matrix, both of which are keyed by code, and a uuid escaping into
 * that layer would be a value nothing else can interpret.
 *
 * ## `currentMatrix` returns `unknown`, deliberately
 *
 * The port types it that way and `normalizeMatrix` repairs whatever
 * arrives. That is not defensive habit: the `permissions` table is
 * administrator-editable from M7.4 onward, so a code that is not in the
 * 22-capability union can genuinely appear in it. Normalising at the
 * boundary means the resolver never has to think about that, and a bad
 * row degrades to "that capability is not granted" rather than to a
 * token advertising something no guard can check.
 */

import { Injectable } from '@nestjs/common';

import { PrismaService } from '../database';
import type { PermissionOverrides, RoleRepository } from './authz.types';
import { isPermission, type Permission } from './permission-catalogue';

/**
 * A `role_permissions` row as `currentMatrix` must treat it: the generated
 * type says the relations are never null, which holds for the foreign key
 * but not for a read that races a delete.
 */
interface MatrixRow {
  readonly role: { readonly code: string } | null;
  readonly permission: { readonly code: string } | null;
}

@Injectable()
export class PrismaRoleRepository implements RoleRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The stored matrix as `{ roleCode: [permissionCode, …] }`.
   *
   * One query rather than one per role: the whole grid is five or six
   * rows by twenty-two columns, and this runs on a cache miss, so a
   * round trip per role would be six round trips to rebuild something
   * that fits in a few kilobytes.
   */
  async currentMatrix(): Promise<unknown> {
    const rows = await this.prisma.db.rolePermission.findMany({
      select: {
        role: { select: { code: true } },
        permission: { select: { code: true } },
      },
    });

    const matrix: Record<string, Permission[]> = {};
    for (const row of rows as readonly MatrixRow[]) {
      // A grant whose role or permission was deleted *during* this read.
      // The relations load in a second query, so a role removed between
      // the two (a custom role deleted; its grants cascade) comes back
      // null despite the foreign key. The grant no longer exists, so it
      // contributes nothing — dereferencing it answered 500 for whichever
      // request happened to miss the cache at that moment. Shared-cache
      // invalidation makes such read-throughs routine, not rare.
      if (row.role === null || row.permission === null) continue;
      // Unknown codes are dropped here rather than passed on. See the
      // header: the table is editable and the union is not.
      if (!isPermission(row.permission.code)) continue;
      (matrix[row.role.code] ??= []).push(row.permission.code);
    }

    return matrix;
  }

  /**
   * One user's overrides (DB §A5, API §15.5).
   *
   * `user_permissions.allowed` is a boolean rather than a presence flag
   * precisely so a row can *remove* a capability the role grants, which
   * is why this splits into two lists rather than one.
   */
  async overridesFor(userId: string): Promise<PermissionOverrides> {
    const rows = await this.prisma.db.userPermission.findMany({
      where: { userId },
      select: { allowed: true, permission: { select: { code: true } } },
    });

    const granted: Permission[] = [];
    const revoked: Permission[] = [];

    for (const row of rows) {
      if (!isPermission(row.permission.code)) continue;
      (row.allowed ? granted : revoked).push(row.permission.code);
    }

    return { granted, revoked };
  }

  /**
   * Every user holding a role — what `forgetRole` invalidates after a
   * matrix edit (API §15.3).
   *
   * Soft-deleted users are excluded by the middleware of M4.2, so a
   * departed account does not keep a cache entry alive.
   */
  async userIdsWithRole(roleCode: string): Promise<readonly string[]> {
    const rows = await this.prisma.db.user.findMany({
      where: { role: { code: roleCode } },
      select: { id: true },
    });

    return rows.map((row) => row.id);
  }
}
