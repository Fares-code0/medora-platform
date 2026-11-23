import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../shared/database';
import { applyLocks, isPermission } from '../../../shared/authz';

/**
 * Resolving a user's capabilities (RM M6.2; M7.1 owns the guard).
 *
 * `role bundle + user overrides`, which is the rule M7.1 states and
 * `user_permissions` is shaped for: `allowed` is a boolean rather than a
 * presence flag precisely so an override can *remove* a capability the
 * role grants (see `03-identity.prisma`). So the resolution is a set
 * union followed by a set difference, in that order — an explicit
 * `allowed = false` wins over the bundle, or a doctor who may not
 * prescribe would still be able to.
 *
 * ## Locks are re-applied after the overrides (M7.1)
 *
 * The union-then-difference above is not the whole rule. The permission
 * matrix marks some cells as fixed — `roles.manage` is locked **on** for
 * `admin` and **off** for every other role — and `PUT /roles/matrix`
 * rejects a body that moves one (reconciliation §5 rule 2). Without the
 * third step below, `user_permissions` would be a way around that check
 * reached through a different endpoint: a single row could grant
 * `roles.manage` to a doctor, or take it from the last administrator and
 * lock the platform out of its own settings. A lock that only one of two
 * write paths honours is not a lock.
 *
 * ## What M6 deliberately leaves to M7
 *
 * The Redis cache and its invalidation. This runs **once per token
 * issue** — login, refresh, step-up — and not per request: the resolved
 * list is copied into the access token with the permission version it was
 * resolved at (`pv`). Since G4 (ADR-047) the claim is not trusted past a
 * change — `AccessTokenGuard` compares `pv` with the account's current
 * version on every request and re-resolves through `PermissionResolver`
 * when they differ — so permission changes apply on the next request, not
 * at the next issue.
 */
@Injectable()
export class PermissionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * `resolve`, plus the `users.permission_version` it was resolved at — the
   * token's `pv` claim (G4, ADR-047).
   *
   * The version is read **first**, in its own statement, and the rows after
   * it. The database bumps the version in the same transaction as any
   * permission change, so rows read after the version are at least as new
   * as it: the claim can be newer than its `pv`, never older. Reading them
   * the other way round could stamp an old set with a new version, and the
   * guard would then trust a stale claim.
   */
  async resolveVersioned(
    userId: string,
    roleId: string,
    roleCode: string,
  ): Promise<{ permissions: string[]; permissionVersion: number }> {
    const { permissionVersion } = await this.prisma.db.user.findUniqueOrThrow({
      where: { id: userId },
      select: { permissionVersion: true },
    });
    const permissions = await this.resolve(userId, roleId, roleCode);

    return { permissions, permissionVersion };
  }

  /** Permission **codes**, sorted, so a token diff is readable. */
  async resolve(userId: string, roleId: string, roleCode: string): Promise<string[]> {
    const [bundle, overrides] = await Promise.all([
      this.prisma.db.rolePermission.findMany({
        where: { roleId },
        select: { permission: { select: { code: true } } },
      }),
      this.prisma.db.userPermission.findMany({
        where: { userId },
        select: { allowed: true, permission: { select: { code: true } } },
      }),
    ]);

    const codes = new Set(bundle.map((row) => row.permission.code));

    for (const override of overrides) {
      if (override.allowed) codes.add(override.permission.code);
      else codes.delete(override.permission.code);
    }

    // `applyLocks` speaks the 22-capability union, so anything the
    // database holds that the union does not is dropped here rather than
    // being copied into a token no guard will ever check against it.
    // `assertBundlesReferenceKnownCodes` makes that unreachable for the
    // seed; this keeps it unreachable for a hand-edited row.
    const known = [...codes].filter(isPermission);

    // A role with no matrix column — `nurse` — has no locks, so this
    // returns the overrides unchanged rather than emptying them.
    //
    // Re-sorted afterwards: `applyLocks` returns catalogue order, and
    // this method's contract is alphabetical so a token diff is readable.
    return [...applyLocks(roleCode, known)].sort();
  }
}
