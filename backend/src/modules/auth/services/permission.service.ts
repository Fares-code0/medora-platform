import { Injectable } from '@nestjs/common';

import { PermissionResolver } from '../../../shared/authz';

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
 * issue** — login, refresh, step-up — and not per request, because the
 * resolved list is copied into the access token and API §1.11 fixes it
 * for that token's life: "permissions are static per session (changes
 * apply at next issue)". A cache would save a query on an endpoint that
 * already hashes a password with Argon2id, and would need an
 * invalidation story that belongs with M7.4's matrix writes.
 */
@Injectable()
export class PermissionService {
  constructor(private readonly resolver: PermissionResolver) {}

  /**
   * Permission **codes**, sorted, so a token diff is readable.
   *
   * The same computation `AuthorizationGuard` enforces — matrix or
   * custom-role grants, per-user overrides, locks and the server policy
   * overlay — so the claim a client renders can never list a capability
   * the server would refuse (audit A-8: custom roles used to differ). The
   * claim is display data only; no server decision reads it (§2.8).
   * `roleId` is kept for the call sites' signature; the role code decides.
   */
  async resolve(userId: string, _roleId: string, roleCode: string): Promise<string[]> {
    const { permissions } = await this.resolver.effectivePermissions({ userId, roleCode });
    return [...permissions].sort();
  }

  /**
   * Whether an account whose employment or affiliation has ended may still
   * sign in: it may not (§2.6). History is preserved; only access ends.
   */
  async isTerminated(userId: string, roleCode: string): Promise<boolean> {
    return (await this.resolver.standingFor(userId, roleCode)) === 'terminated';
  }
}
