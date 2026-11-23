/**
 * Effective-permission resolution (RM M7.1).
 *
 * Reconciliation §5 rule 1: effective permissions = role bundle ±
 * `user_permissions` overrides, cached, invalidated on change. This is
 * that sentence, made total and made safe.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';

import { applyLocks, normalizeMatrix } from './permission-matrix';
import { bundleFor, isPlatformRole } from './permission-catalogue';
import {
  PERMISSION_CACHE,
  ROLE_REPOSITORY,
  type CachedPermissions,
  type EffectivePermissions,
  type Permission,
  type PermissionCache,
  type PermissionOverrides,
  type Principal,
  type RoleRepository,
} from './authz.types';

@Injectable()
export class PermissionResolver {
  private readonly logger = new Logger('Authz');

  constructor(
    @Inject(ROLE_REPOSITORY) private readonly roles: RoleRepository,
    @Inject(PERMISSION_CACHE) private readonly cache: PermissionCache,
  ) {}

  /**
   * The composition of §4.1, and the order is load-bearing:
   *
   *   1. the stored matrix, repaired (locks applied)
   *   2. the user's grants and revocations
   *   3. **locks re-applied**
   *
   * Step 3 is not redundant. Without it a `user_permissions` row could
   * grant `roles.manage` to a doctor or revoke it from an administrator
   * — reaching, through API §15.5, exactly the state §15.3 refuses to
   * save. A lock that only one of two endpoints honours is not a lock.
   */
  async effectivePermissions(principal: Principal): Promise<EffectivePermissions> {
    const matrix = normalizeMatrix(await this.roles.currentMatrix());
    // A role with no matrix column resolves to an empty bundle rather
    // than to `undefined` — see `bundleFor`. `nurse` can authenticate,
    // so authorization is asked about it and must answer "nothing".
    const fromRole = isPlatformRole(principal.roleCode)
      ? matrix[principal.roleCode]
      : bundleFor(principal.roleCode);
    const overrides = await this.overridesFor(principal.userId);

    const held = new Set<Permission>(fromRole);
    for (const permission of overrides.granted) held.add(permission);
    for (const permission of overrides.revoked) held.delete(permission);

    return {
      principal,
      permissions: applyLocks(principal.roleCode, held),
      fromRole,
      overrides,
    };
  }

  /**
   * The hot path. Reads through the cache, **at the request's permission
   * version only** (G4, ADR-047).
   *
   * `principal.permissionVersion` is `users.permission_version` as
   * `AccessTokenGuard` read it for this request; the database bumps it in
   * the same transaction as any permission change. So:
   *
   * - an entry stamped with that version is current and is used;
   * - an entry stamped with any other version — a change committed since it
   *   was written, whether or not its invalidation reached the cache — is
   *   **never used**: the set is re-resolved from PostgreSQL and re-stamped;
   * - a principal with no version (no guard read it) never reads the cache
   *   at all: there is nothing to compare an entry against.
   *
   * Stamping a fresh resolution with the version read *before* it is safe:
   * the version and the rows it versions commit together, so rows read
   * after the version are at least that new. At worst an entry is newer
   * than its stamp, which costs one extra miss and never a stale grant.
   *
   * A failed cache read is a miss (PostgreSQL is authoritative); a failed
   * re-resolution throws, and the request is refused — fail closed.
   */
  async permissionsFor(principal: Principal): Promise<readonly Permission[]> {
    const version = principal.permissionVersion;
    if (version === undefined) {
      return (await this.effectivePermissions(principal)).permissions;
    }

    const cached = await this.readCache(principal.userId);
    if (cached !== undefined && cached.version === version) return cached.permissions;

    const { permissions } = await this.effectivePermissions(principal);
    await this.writeCache(principal.userId, { version, permissions });

    return permissions;
  }

  async can(principal: Principal, capability: Permission): Promise<boolean> {
    return (await this.permissionsFor(principal)).includes(capability);
  }

  /** Every capability must be held — `@Can('a', 'b')` means both. */
  async canAll(principal: Principal, capabilities: readonly Permission[]): Promise<boolean> {
    if (capabilities.length === 0) return true;
    const held = await this.permissionsFor(principal);

    return capabilities.every((capability) => held.includes(capability));
  }

  /** One user's overrides changed (API §15.5). */
  async forget(userId: string): Promise<void> {
    await this.guardCache(() => this.cache.forget(userId), 'forget');
  }

  /**
   * The matrix changed for a role (API §15.3), so every member's
   * effective set changed at once.
   *
   * Since G4 (ADR-047) a permission change applies on the next request:
   * the members' permission versions were bumped by the database with the
   * change, so their entries are already unusable. Dropping them here is
   * hygiene — it frees the keys — not what makes the change take.
   */
  async forgetRole(roleCode: string): Promise<void> {
    const userIds = await this.roles.userIdsWithRole(roleCode);
    await this.guardCache(() => this.cache.forgetMany(userIds), 'forgetRole');
  }

  /** The whole matrix was replaced. */
  async forgetAll(): Promise<void> {
    await this.guardCache(() => this.cache.clear(), 'forgetAll');
  }

  private async overridesFor(userId: string): Promise<PermissionOverrides> {
    try {
      return await this.roles.overridesFor(userId);
    } catch (error) {
      // The repository is not optional the way the cache is: failing to
      // read overrides means we do not know what was *revoked*. Falling
      // back to the role bundle would silently restore a permission
      // somebody deliberately took away, so this fails closed instead.
      this.logger.error({ authz: 'overrides-unavailable', userId }, asMessage(error));
      throw error;
    }
  }

  private async readCache(userId: string): Promise<CachedPermissions | undefined> {
    try {
      return await this.cache.get(userId);
    } catch (error) {
      this.logger.warn({ authz: 'cache-read-failed', userId }, asMessage(error));
      return undefined;
    }
  }

  private async writeCache(userId: string, entry: CachedPermissions): Promise<void> {
    try {
      await this.cache.set(userId, entry);
    } catch (error) {
      this.logger.warn({ authz: 'cache-write-failed', userId }, asMessage(error));
    }
  }

  /**
   * An invalidation that throws would fail the request that changed the
   * permission — but the change itself already committed, so the caller
   * would retry a write that has happened. Logging loudly and continuing
   * is safe since G4 (ADR-047), and only since then: the entry left behind
   * is stamped with the old permission version, and `permissionsFor` never
   * uses an entry whose version differs from the one the request read. A
   * failed invalidation therefore fails closed — it costs a database read on
   * the next request, never a stale grant.
   */
  private async guardCache(operation: () => Promise<void>, name: string): Promise<void> {
    try {
      await operation();
    } catch (error) {
      this.logger.error({ authz: `cache-${name}-failed` }, asMessage(error));
    }
  }
}

function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
