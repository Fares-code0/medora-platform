import { Inject, Injectable } from '@nestjs/common';

import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import { PrismaService } from '../../../shared/database';
import { UserStatus } from '../../../generated/prisma/enums';
import { IdentityRepository } from '../repositories/identity.repository';

import { ADMIN_INVITATION_TTL_SECONDS } from './admin-invitation.service';
import { AuthMailService } from './auth-mail.service';
import { SecretService } from './secret.service';

/**
 * The first administrator of a deployment (RM M38.4, ADR-035, ADR-017 §2).
 *
 * ## The constraint this answers
 *
 * ADR-035 closed public administrator registration: privileged roles are
 * conferred by someone who already holds `roles.manage`. Its consequence,
 * in its own words: "**The first administrator of a deployment must be
 * seeded**, because every route that creates one requires one … a
 * bootstrap endpoint would be the hole this ADR closes, reopened under
 * another name." ADR-017 §2 adds that it is exactly one, with no demo
 * credentials and no mock password.
 *
 * ## What this does
 *
 * It issues **one ordinary administrator invitation**, from the server,
 * with no sender (`invited_by` NULL). The invitee then goes through the
 * same two phases every invited administrator does — set a password,
 * prove a TOTP code — so ADR-035's invariant survives intact: the only
 * code path that moves an administrator to ACTIVE is the one that just
 * verified a second factor. Nothing here writes a password, a credential
 * or an ACTIVE status, and nothing here is reachable over HTTP; it runs
 * only from `src/cli/bootstrap-admin.ts`, which needs a shell on the
 * server and the deployment's environment.
 *
 * ## The refusals
 *
 * - **The roles are not seeded** — there is no `admin` role to confer.
 * - **An administrator already exists**, in any status. After the first,
 *   administrators are invited through the API by an administrator
 *   (ADR-017 §3); this is not a second way in.
 * - **The address already has an account.**
 *
 * One recovery is allowed, and only when asked for (`reissue`): an
 * earlier bootstrap invitation that was **accepted but never completed**
 * leaves an INACTIVE account that has never authenticated — a password
 * was set, no second factor was proved, and the invitation expires after
 * seven days. Without a way past it the deployment would have no
 * administrator and no way to make one. `reissue` removes only accounts
 * of exactly that shape and revokes their invitations; any other
 * administrator still refuses.
 */

export type BootstrapDelivery = 'email' | 'print';

export type BootstrapRefusalReason = 'roles_not_seeded' | 'administrator_exists' | 'email_taken';

export class BootstrapRefused extends Error {
  override readonly name = 'BootstrapRefused';

  constructor(
    readonly reason: BootstrapRefusalReason,
    message: string,
  ) {
    super(message);
  }
}

export interface BootstrapRequest {
  readonly email: string;
  readonly delivery: BootstrapDelivery;
  /** Remove an abandoned bootstrap first (see the header). */
  readonly reissue?: boolean;
}

export interface BootstrapResult {
  readonly email: string;
  readonly expiresAt: Date;
  /** Present only for `delivery: 'print'` — the operator hands it over. */
  readonly link?: string;
  /** Abandoned bootstrap accounts removed by `reissue`. */
  readonly removedPlaceholders: number;
}

const ADMIN_ROLE = 'admin';

@Injectable()
export class AdminBootstrapService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityRepository,
    private readonly secrets: SecretService,
    private readonly mail: AuthMailService,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
  ) {}

  async issue(request: BootstrapRequest): Promise<BootstrapResult> {
    const email = request.email.trim();

    const role = await this.identity.findRoleByCode(ADMIN_ROLE);
    if (role === null) {
      throw new BootstrapRefused(
        'roles_not_seeded',
        'There is no `admin` role. Seed the reference data first: `npm run db:seed:production`.',
      );
    }

    const removedPlaceholders =
      request.reissue === true ? await this.removeAbandonedBootstraps(role.id) : 0;

    // Soft-deleted accounts are not administrators; every other status is.
    // A LOCKED or SUSPENDED administrator is still one, and is recovered
    // through the API by another administrator, not by minting a new one.
    const administrators = await this.prisma.db.user.count({ where: { roleId: role.id } });
    if (administrators > 0) {
      throw new BootstrapRefused(
        'administrator_exists',
        `An administrator account already exists (${String(administrators)}). ` +
          'Further administrators are invited from the Administration Center. ' +
          'If an earlier bootstrap was accepted but never completed, rerun with --reissue.',
      );
    }

    if ((await this.identity.findByEmail(email)) !== null) {
      throw new BootstrapRefused('email_taken', 'An account with this email already exists.');
    }

    // Any invitation still outstanding for this address is superseded, as
    // `AdminInvitationService.create` does: two live tokens for one
    // account would mean revoking the visible one leaves the other open.
    await this.prisma.db.adminInvitation.updateMany({
      where: { email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const raw = this.secrets.randomToken();
    const expiresAt = new Date(Date.now() + ADMIN_INVITATION_TTL_SECONDS * 1_000);

    const invitation = await this.prisma.db.adminInvitation.create({
      data: {
        email,
        tokenHash: this.secrets.hash(raw),
        roleId: role.id,
        permissions: [],
        expiresAt,
        // The one invitation with no sender. See the schema comment.
        invitedBy: null,
      },
    });

    if (request.delivery === 'email') {
      await this.mail.sendAdminInvitation(email, raw, role.code, expiresAt);
    }

    await this.audit.record({
      action: 'admin.invitation_created',
      // `null` is the system itself (`audit.types`): an operator at the
      // server's shell, not an account. The row says so in `bootstrap`.
      actor: { userId: null, role: null },
      entityType: 'admin_invitation',
      entityId: invitation.id,
      metadata: {
        role: role.code,
        bootstrap: true,
        delivery: request.delivery,
        removedPlaceholders,
      },
    });

    return {
      email,
      expiresAt,
      removedPlaceholders,
      ...(request.delivery === 'print' ? { link: this.mail.adminInvitationLink(raw) } : {}),
    };
  }

  /**
   * Accounts a bootstrap invitation created and never activated: role
   * `admin`, INACTIVE, linked to an invitation with no sender that was
   * accepted and never completed. Any administrator of another shape is
   * left alone, so the count check afterwards still refuses.
   */
  private async removeAbandonedBootstraps(adminRoleId: string): Promise<number> {
    const abandoned = await this.prisma.db.adminInvitation.findMany({
      where: {
        invitedBy: null,
        roleId: adminRoleId,
        acceptedAt: { not: null },
        completedAt: null,
        user: { status: UserStatus.INACTIVE, roleId: adminRoleId },
      },
      select: { id: true, userId: true },
    });

    const userIds = abandoned.flatMap((row) => (row.userId === null ? [] : [row.userId]));
    if (userIds.length === 0) return 0;

    await this.prisma.$transaction([
      this.prisma.adminInvitation.updateMany({
        where: { id: { in: abandoned.map((row) => row.id) } },
        data: { revokedAt: new Date() },
      }),
      // A hard delete, of an account that never authenticated: it has no
      // session, no clinical row and no audit trail of its own to keep,
      // and a soft-deleted row would still hold the address's unique index.
      this.prisma.user.deleteMany({
        where: { id: { in: userIds }, status: UserStatus.INACTIVE, roleId: adminRoleId },
      }),
    ]);

    return userIds.length;
  }
}
