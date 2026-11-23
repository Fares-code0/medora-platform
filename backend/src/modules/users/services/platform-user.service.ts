/**
 * The admin Users panel (RM M8.2, API §2.10).
 *
 * Two operations — list and patch — and most of this file is the rules
 * around the patch, because "change someone's role" is the single most
 * consequential write in the platform that is not a clinical one.
 *
 * ## Four refusals, and why each one exists
 *
 * **You cannot change your own role or deactivate yourself.** Both are
 * ways to lock the platform out of its own administration by accident,
 * and neither has a legitimate use: an administrator who wants to step
 * down asks another one. This is checked first because it is the cheapest
 * and the most likely to be hit by a misclick.
 *
 * **You cannot promote anyone to a privileged role here.** ADR-035 §7
 * makes MFA structurally mandatory for administrators: the *only* code
 * path that sets an admin account ACTIVE is the invitation flow's phase
 * 2, which runs immediately after a TOTP code is proved. Setting
 * `role = admin` on an existing account with no enrolled factor would
 * produce an account that `LoginService` then refuses forever with
 * `two_factor_required` — a bricked administrator, created by the panel
 * that exists to manage administrators. `POST /auth/admin-invitations`
 * is the supported path and it enrols the factor as part of the flow.
 *
 * **You cannot demote the last active administrator.** A platform with
 * no one holding `roles.manage` cannot grant it back — the matrix editor
 * and this panel both require it. That is unrecoverable without database
 * access, which is precisely the situation a guard is for.
 *
 * **You cannot deactivate the last active administrator**, for the same
 * reason: `status != ACTIVE` refuses sign-in, so it is a demotion by
 * another name.
 *
 * ## Deactivation is `status`, not a soft delete
 *
 * An earlier comment in `IdentityRepository` anticipated M8.2
 * "deactivating by soft delete". It does not, and the reason is the
 * contract: `PlatformUser.active` is a **boolean an administrator
 * flips**, so the state has to be reversible and the row has to stay
 * visible in the list it was toggled from. A soft-deleted row is hidden
 * from every `db` read, so reactivating one would need a second,
 * unfiltered code path — and, because `findByEmail` filters it too, the
 * deactivated user's sign-in would answer `invalid_credentials` rather
 * than `account_inactive`, telling a suspended clinician their password
 * is wrong.
 *
 * `deleted_at` keeps its own meaning: an account erased under a privacy
 * request (M22.4's territory), which is not what a Deactivate button
 * does.
 */

import { Inject, Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';
import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { ACTIVITY_RECORDER, type ActivityRecorder } from '../../../shared/activity';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import { UserStatus } from '../../../generated/prisma/enums';
import type { PlatformUserView } from '../dto/account.dto';
import type {
  ActivityQuery,
  PlatformUserQuery,
  UpdatePlatformUserInput,
} from '../dto/account.schema';
import { AccountService, type PaginatedActivity } from './account.service';
import {
  PlatformUserRepository,
  type PlatformUserRow,
} from '../repositories/platform-user.repository';

/**
 * Roles this route may not confer, because reaching them requires an
 * enrolled second factor that only the invitation flow provisions
 * (ADR-035 §7).
 *
 * A list rather than `=== 'admin'` for the reason `LoginService`'s
 * `isPrivilegedRole` gives: what justifies the rule is the capability
 * set, not the name, so the next role to hold `roles.manage` is added
 * here rather than discovered to have been exempt.
 */
const MFA_REQUIRED_ROLES: readonly string[] = ['admin'];

export interface PaginatedPlatformUsers {
  readonly items: readonly PlatformUserView[];
  readonly page: number;
  readonly pageSize: number;
  readonly totalItems: number;
  readonly totalPages: number;
}

@Injectable()
export class PlatformUserService {
  constructor(
    private readonly users: PlatformUserRepository,
    /**
     * The self feed's own service, injected rather than duplicated
     * (M29.1). An administrator and the account's owner read one
     * projection, so the two screens cannot drift apart.
     */
    private readonly accounts: AccountService,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
    @Inject(ACTIVITY_RECORDER) private readonly activity: ActivityRecorder,
  ) {}

  async list(query: PlatformUserQuery): Promise<PaginatedPlatformUsers> {
    const { rows, totalItems } = await this.users.list(query);

    return {
      items: rows.map(toView),
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / query.pageSize),
    };
  }

  async detail(publicId: string): Promise<PlatformUserView> {
    const row = await this.users.findByPublicId(publicId);
    if (row === null) throw AppException.notFound('User not found');

    return toView(row);
  }

  /**
   * API §2.8's feed, for the account an administrator is looking at —
   * RM M29.1's "admin profile view".
   *
   * ## Why it is the same projection as `/me/activity`
   *
   * `AccountService.activityFeed` is reused rather than reimplemented, so
   * an administrator sees exactly what the account's owner sees. Two
   * projections of one feed would eventually disagree about which fields
   * are shown, and the divergence would be invisible: nobody compares
   * the two screens.
   *
   * ## There is no PHI question here, and that is a property of the table
   *
   * `user_activity_log` holds account events — a password changed, a
   * setting saved, a sign-in — and `shared/activity`'s contract forbids
   * clinical content and values outright: "a summary names *what
   * changed*, never the value it changed to". So this is not a PHI
   * surface and needs no masking, unlike every admin projection of a
   * `patients` row (API §4.11).
   *
   * ## `roles.manage`, inherited from the controller
   *
   * The same capability that reads and changes the account is what reads
   * its history — an administrator who may deactivate an account but not
   * see why it was flagged would be worse off, not safer.
   */
  async activityFeed(publicId: string, query: ActivityQuery): Promise<PaginatedActivity> {
    const target = await this.users.findIdentity(publicId);
    // 404 before the feed, and identical to a genuinely missing account:
    // an administrator listing activity for a `usr_…` that does not exist
    // must not learn from the shape of the answer that it might.
    if (target === null) throw AppException.notFound('User not found');

    return this.accounts.activityFeed(target.id, query);
  }

  async update(
    actor: AuthenticatedUser,
    publicId: string,
    input: UpdatePlatformUserInput,
  ): Promise<PlatformUserView> {
    const target = await this.users.findIdentity(publicId);
    if (target === null) throw AppException.notFound('User not found');

    if (target.id === actor.id) {
      throw AppException.forbidden(
        'Ask another administrator to change your own role or status',
        'forbidden',
      );
    }

    const roleId = await this.resolveRole(target.role.code, input.role);
    const status = resolveStatus(input.active);

    await this.assertAdministrationSurvives(target.role.code, input.role, input.active);

    // A role change revokes every live session (approved G4 contract; the
    // database trigger `users_role_change_revokes_sessions` does it in the
    // same transaction as the update, from any write path). Counted first so
    // the audit row records how many sessions the change ended.
    const roleChanging = input.role !== undefined && input.role !== target.role.code;
    const endedByRoleChange = roleChanging ? await this.users.countLiveSessions(target.id) : 0;

    const updated = await this.users.update(target.id, actor.id, { roleId, status });

    // Deactivation ends the sessions that are already open. Without this
    // the lever does nothing for the case it is pulled in — an account
    // being used right now — until the access token expires.
    const revoked =
      endedByRoleChange +
      (status !== undefined && status !== UserStatus.ACTIVE
        ? await this.users.revokeSessions(target.id)
        : 0);

    await this.audit.record({
      action: 'user.administer',
      actor: { userId: actor.id, role: actor.role },
      entityType: 'user',
      entityId: publicId,
      metadata: {
        // Role *codes* are a public vocabulary, not personal data, so
        // both sides of the change are recorded — an investigation needs
        // to know what the role was, not only what it became.
        roleBefore: target.role.code,
        roleAfter: updated.role.code,
        statusBefore: target.status,
        statusAfter: updated.status,
        sessionsRevoked: revoked,
      },
    });

    // The *subject's* feed, not the actor's. "Your role was changed" is
    // something the account holder is entitled to see; who did it is the
    // audit ledger's business, so the actor is deliberately not named
    // here (API §14 governs that surface, not this one).
    if (input.role !== undefined && input.role !== target.role.code) {
      await this.activity.record({
        userId: target.id,
        kind: 'security',
        summary: 'Your role was changed by an administrator',
        detail: `Now: ${updated.role.code}`,
      });
    }

    if (status !== undefined && status !== target.status) {
      await this.activity.record({
        userId: target.id,
        kind: 'security',
        summary:
          status === UserStatus.ACTIVE
            ? 'Your account was reactivated'
            : 'Your account was deactivated',
      });
    }

    return toView(updated);
  }

  /** Resolves the requested role code to a row id, refusing the unsafe ones. */
  private async resolveRole(
    currentRole: string,
    requested: string | undefined,
  ): Promise<string | undefined> {
    if (requested === undefined || requested === currentRole) return undefined;

    if (MFA_REQUIRED_ROLES.includes(requested)) {
      throw AppException.conflict(
        `The ${requested} role requires an enrolled second factor. Send an invitation instead (POST /auth/admin-invitations).`,
        'two_factor_required',
      );
    }

    const role = await this.users.findRoleByCode(requested);
    // An unknown role code is a 422 on the field rather than a 404 on the
    // user: the user exists, the body does not name a real role.
    if (role === null) {
      throw AppException.validation({ role: ['Unknown role'] }, 'Unknown role');
    }

    return role.id;
  }

  /**
   * Refuses a change that would leave nobody able to administer the
   * platform.
   *
   * Counted rather than assumed: "there is surely another admin" is the
   * belief that produces a locked-out platform. The count is of **active**
   * administrators, because a suspended one cannot sign in to fix it.
   */
  private async assertAdministrationSurvives(
    currentRole: string,
    requestedRole: string | undefined,
    requestedActive: boolean | undefined,
  ): Promise<void> {
    const losingTheRole = requestedRole !== undefined && requestedRole !== currentRole;
    const beingDeactivated = requestedActive === false;

    if (!MFA_REQUIRED_ROLES.includes(currentRole)) return;
    if (!losingTheRole && !beingDeactivated) return;

    const remaining = await this.users.countActiveWithRole(currentRole);
    if (remaining > 1) return;

    throw AppException.conflict(
      `This is the last active ${currentRole}; promote another one first`,
      'conflict',
    );
  }
}

function resolveStatus(active: boolean | undefined): UserStatus | undefined {
  if (active === undefined) return undefined;
  // Reactivation always lands on ACTIVE. Deactivation lands on INACTIVE
  // rather than SUSPENDED: the two mean different things to the person
  // affected — suspended is a disciplinary state — and this route's body
  // is a boolean, which cannot express the difference.
  return active ? UserStatus.ACTIVE : UserStatus.INACTIVE;
}

function toView(row: PlatformUserRow): PlatformUserView {
  return {
    id: row.publicId,
    name: row.displayName,
    email: row.email,
    role: row.role.code,
    active: row.status === UserStatus.ACTIVE,
    lastActiveAt: row.lastActiveAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
