/**
 * Effective-permission resolution (RM M7.1).
 *
 * Reconciliation §5 rule 1: effective permissions = role bundle ±
 * `user_permissions` overrides, cached, invalidated on change. This is
 * that sentence, made total and made safe.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';

import { applyServerPolicy } from './authz-policy';
import { applyLocks, normalizeMatrix } from './permission-matrix';
import { bundleFor, isPermission, isPlatformRole, orderCapabilities } from './permission-catalogue';
import {
  PERMISSION_CACHE,
  ROLE_REPOSITORY,
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
    const stored = await this.roles.currentMatrix();
    const matrix = normalizeMatrix(stored);
    const platformRole = isPlatformRole(principal.roleCode);
    // A system role outside the matrix (`nurse`) or a custom role resolves
    // from its own stored grants. A custom role used to resolve to the empty
    // bundle here while the token claim listed its grants — two answers for
    // one account (audit A-8); both paths now read the same rows.
    const baseRoleCode = platformRole ? null : await this.roles.baseRoleCodeOf(principal.roleCode);
    const fromRole = platformRole
      ? matrix[principal.roleCode]
      : storedGrants(stored, principal.roleCode, bundleFor(principal.roleCode));
    const overrides = await this.overridesFor(principal.userId);

    const held = new Set<Permission>(fromRole);
    for (const permission of overrides.granted) held.add(permission);
    for (const permission of overrides.revoked) held.delete(permission);

    // Locks, then the server policy overlay (§2.1, §2.4, §2.8): no override,
    // matrix edit or custom-role grant can take a role past its category
    // ceiling, give `admin` standing PHI access, or give anyone else
    // platform administration. Applied last, so nothing re-adds a capability.
    const locked = applyLocks(principal.roleCode, held);

    return {
      principal,
      permissions: orderCapabilities(
        applyServerPolicy(principal.roleCode, baseRoleCode, locked),
      ),
      fromRole,
      overrides,
    };
  }

  /**
   * The hot path. Reads through the cache; a cache that is down is a
   * miss, never a denial (see `PermissionCache`).
   */
  async permissionsFor(principal: Principal): Promise<readonly Permission[]> {
    // Keyed by user, role and `authz_version` (audit A-3). Every change to
    // an account's authorization bumps the version in the change's own
    // transaction, so an entry cached before it is simply never read again —
    // even when the eviction below fails or Redis is unreachable. Without a
    // version (a caller outside a request) the cache is not used at all.
    const key = cacheKeyFor(principal);
    if (key !== null) {
      const cached = await this.readCache(key);
      if (cached !== undefined) return cached;
    }

    const { permissions } = await this.effectivePermissions(principal);
    if (key !== null) await this.writeCache(key, permissions);

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
   * §5 rule 4 says changes take effect at next session issue, which is
   * about the *token*; this is about the cache behind it, and the cache
   * must not be the thing that makes a revocation outlive the session it
   * was supposed to end.
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

  private async readCache(userId: string): Promise<readonly Permission[] | undefined> {
    try {
      return await this.cache.get(userId);
    } catch (error) {
      this.logger.warn({ authz: 'cache-read-failed', userId }, asMessage(error));
      return undefined;
    }
  }

  private async writeCache(userId: string, permissions: readonly Permission[]): Promise<void> {
    try {
      await this.cache.set(userId, permissions);
    } catch (error) {
      this.logger.warn({ authz: 'cache-write-failed', userId }, asMessage(error));
    }
  }

  /**
   * An invalidation that throws would fail the request that changed the
   * permission — but the change itself already committed, so the caller
   * would retry a write that has happened. Logging loudly and continuing
   * leaves a stale cache entry that expires on its own TTL.
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

/** `user|role|vVERSION`, or `null` when the principal carries no version. */
export function cacheKeyFor(principal: Principal): string | null {
  if (principal.authzVersion === undefined) return null;
  return `${principal.userId}|${principal.roleCode}|v${principal.authzVersion}`;
}

/** A non-matrix role's stored grants, or its built-in bundle when it has none. */
function storedGrants(
  stored: unknown,
  roleCode: string,
  fallback: readonly Permission[],
): readonly Permission[] {
  if (typeof stored !== 'object' || stored === null) return fallback;
  const raw = (stored as Record<string, unknown>)[roleCode];
  if (!Array.isArray(raw)) return fallback;
  return raw.filter((id): id is Permission => typeof id === 'string' && isPermission(id));
}
