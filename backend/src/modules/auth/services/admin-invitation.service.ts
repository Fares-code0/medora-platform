import { HttpStatus, Inject, Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import { PrismaService, isUniqueViolation } from '../../../shared/database';
import { UserStatus } from '../../../generated/prisma/enums';
import type {
  AcceptAdminInvitationInput,
  ActivateAdminInvitationInput,
  CreateAdminInvitationInput,
} from '../dto';
import { IdentityRepository } from '../repositories/identity.repository';

import { AuthMailService } from './auth-mail.service';
import { EnvelopeService } from '../../../shared/crypto';
import { PasswordService } from './password.service';
import { RecoveryCodeService } from './recovery-code.service';
import { SecretService } from './secret.service';
import { TotpService, type TotpEnrolment } from './totp.service';

/**
 * Administrator provisioning (ADR-035 §5).
 *
 * ## Why this exists at all
 *
 * `POST /auth/register` used to accept `role: 'admin'`, so an
 * administrator account — `roles.manage`, `settings.manageSystem`,
 * `patients.revealIdentity`, `logs.export` — was obtainable by anyone who
 * could fill in a public form and click a link in their own inbox. The
 * risk was named in `registration.service.ts` from the day it shipped and
 * deferred as RA-025.1. This service is the resolution: privileged roles
 * are conferred by someone who already holds `roles.manage`, and by
 * nobody else.
 *
 * ## Two phases, and why MFA is structural rather than policy
 *
 * `accept` creates the account **INACTIVE** with a TOTP secret
 * provisioned; `activate` proves a code from that secret and only then
 * writes `status = ACTIVE` and `two_factor_enabled = true`. Those two
 * writes happen on one line, in one transaction, in this file, and there
 * is no other code path in the platform that moves an invited account to
 * ACTIVE.
 *
 * So "administrators must have MFA" is not a rule someone has to remember
 * to enforce — it is the only way the state is reachable. An invitee who
 * abandons the flow after setting a password has an INACTIVE account, and
 * `LoginService`'s status check refuses it.
 *
 * One token spans both phases, guarded by a different column each time:
 * phase 1 refuses a row that already has `accepted_at`, phase 2 refuses
 * one that does not. Neither replays.
 *
 * ## Every failure is `token_invalid`
 *
 * Unknown, expired, revoked, already used, wrong phase — one code, the
 * same reasoning `VerificationTokenService.consume` documents. A caller
 * who could tell "expired" from "never existed" would eventually surface
 * that difference to someone holding a stolen link.
 */

/** ADR-035 §5 — an invitation is good for seven days. */
export const ADMIN_INVITATION_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface CreatedInvitation {
  readonly email: string;
  readonly role: string;
  readonly expiresAt: Date;
}

/** What phase 1 hands back: everything needed to enrol, and no session. */
export interface AcceptedInvitation extends TotpEnrolment {
  readonly nextStep: 'configure-mfa';
  readonly email: string;
}

export interface ActivatedInvitation {
  readonly nextStep: 'login';
  readonly email: string;
}

@Injectable()
export class AdminInvitationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly identity: IdentityRepository,
    private readonly secrets: SecretService,
    private readonly passwords: PasswordService,
    private readonly totp: TotpService,
    private readonly envelope: EnvelopeService,
    private readonly mail: AuthMailService,
    private readonly recoveryCodes: RecoveryCodeService,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
  ) {}

  /**
   * `POST /auth/admin-invitations` — guarded `@Can('roles.manage')`.
   *
   * Answers 409 rather than 202-always. This endpoint is *authenticated
   * and privileged*, so the anti-enumeration reasoning that governs
   * `forgot-password` does not apply: the caller may already list every
   * account through the administration module, so telling them an address
   * is taken discloses nothing they could not otherwise read, and
   * silently doing nothing would leave them believing an invitation was
   * sent.
   */
  async create(
    input: CreateAdminInvitationInput,
    actor: AuthenticatedUser,
  ): Promise<CreatedInvitation> {
    const email = input.email.trim();

    if ((await this.identity.findByEmail(email)) !== null) {
      throw AppException.conflict(
        'An account with this email already exists',
        'email_taken',
        'Email already registered',
      );
    }

    const role = await this.identity.findRoleByCode(input.role);
    if (role === null) {
      throw new AppException(HttpStatus.SERVICE_UNAVAILABLE, {
        message: 'Account roles are not configured',
        code: 'service_unavailable',
        detail: `Role \`${input.role}\` is not seeded`,
      });
    }

    // Any invitation still outstanding for this address is superseded.
    // Without this, re-inviting someone whose first link was lost leaves
    // two live tokens for one account, and revoking the visible one would
    // not close the other.
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
        permissions: [...input.permissions],
        expiresAt,
        invitedBy: actor.id,
      },
    });

    await this.mail.sendAdminInvitation(email, raw, role.code, expiresAt);

    await this.audit.record({
      action: 'admin.invitation_created',
      actor: { userId: actor.id, role: actor.role },
      entityType: 'admin_invitation',
      entityId: invitation.id,
      // The role and the capability count, never the token and never the
      // capability list — MG §11.6 is field names, not values, and the
      // token is the credential this whole flow protects.
      metadata: { role: role.code, permissionOverrides: input.permissions.length },
    });

    return { email, role: role.code, expiresAt };
  }

  /**
   * Phase 1 — `POST /auth/admin-invitations/accept`, public.
   *
   * Creates the account INACTIVE, with the address already marked
   * verified: the invitation link arrived at that inbox and was opened,
   * which is the same proof `verify-email` collects. Sending a second
   * confirmation mail to an address that just proved itself would be
   * ceremony.
   *
   * Returns the enrolment material and **no session**. An administrator
   * account with no second factor is not one anybody should be signed in
   * to, which is the whole reason there is a phase 2.
   */
  async accept(input: AcceptAdminInvitationInput): Promise<AcceptedInvitation> {
    const invitation = await this.pendingInvitation(input.token);
    if (invitation === null || invitation.acceptedAt !== null) throw tokenInvalid();

    // Between the invitation being sent and this call, the address may
    // have been registered another way. The unique index would refuse the
    // insert below; answering here keeps the failure legible.
    if ((await this.identity.findByEmail(invitation.email)) !== null) {
      throw AppException.conflict(
        'An account with this email already exists',
        'email_taken',
        'Email already registered',
      );
    }

    const enrolment = this.totp.enrol(invitation.email);
    const passwordHash = await this.passwords.hash(input.password);
    const now = new Date();

    const permissionIds = await this.resolvePermissionIds(invitation.permissions);

    let userId: string;
    try {
      userId = await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            publicId: IdentityRepository.generatePublicId(),
            firstName: localPartOf(invitation.email),
            lastName: '',
            // The invitee has not told us their name yet — the invitation
            // carries an address and a role, and nothing else. The local
            // part is a placeholder they replace in Settings; inventing a
            // human name here would be worse than an obviously provisional
            // one.
            displayName: localPartOf(invitation.email),
            email: invitation.email,
            phone: '',
            roleId: invitation.roleId,
            // The link proved the address. See the method comment.
            emailVerifiedAt: now,
            // Not ACTIVE until a second factor is proved (phase 2).
            status: UserStatus.INACTIVE,
            termsAcceptedAt: now,
            privacyAcceptedAt: now,
          },
        });

        await tx.userCredential.create({
          data: {
            userId: user.id,
            passwordHash,
            // Provisioned now, enabled in phase 2. The same two-step
            // `TwoFactorService` uses, and for the same reason: a flag
            // turned on before the round trip is proved is a lockout.
            totpSecretEnc: this.envelope.encrypt(enrolment.secret),
            recoveryCodesEnc: this.recoveryCodes.seal(enrolment.recoveryCodes),
          },
        });

        if (permissionIds.length > 0) {
          await tx.userPermission.createMany({
            data: permissionIds.map((permissionId) => ({
              userId: user.id,
              permissionId,
              allowed: true,
              grantedBy: invitation.invitedBy,
            })),
          });
        }

        // The claim, conditional on the row still being unaccepted —
        // `updateMany` so two clicks arriving together cannot both
        // proceed, exactly as `VerificationTokenService.consume` does it.
        const claimed = await tx.adminInvitation.updateMany({
          where: { id: invitation.id, acceptedAt: null, revokedAt: null },
          data: { acceptedAt: now, userId: user.id },
        });
        if (claimed.count !== 1) throw tokenInvalid();

        return user.id;
      });
    } catch (error) {
      if (isUniqueViolation(error, 'email')) {
        throw AppException.conflict(
          'An account with this email already exists',
          'email_taken',
          'Email already registered',
        );
      }
      throw error;
    }

    await this.audit.record({
      action: 'admin.invitation_accepted',
      actor: { userId, role: invitation.roleCode },
      entityType: 'admin_invitation',
      entityId: invitation.id,
      metadata: { status: UserStatus.INACTIVE, nextStep: 'configure-mfa' },
    });

    return { nextStep: 'configure-mfa', email: invitation.email, ...enrolment };
  }

  /**
   * Phase 2 — `POST /auth/admin-invitations/activate`, public.
   *
   * The one place an invited account becomes ACTIVE, and it runs only
   * after a code from the phase-1 secret verifies. Still no session: the
   * invitee signs in through `POST /auth/login` like everyone else, which
   * keeps one code path minting sessions rather than two.
   */
  async activate(input: ActivateAdminInvitationInput): Promise<ActivatedInvitation> {
    const invitation = await this.pendingInvitation(input.token);
    // Phase 2 requires exactly the state phase 1 leaves behind.
    if (invitation === null || invitation.acceptedAt === null || invitation.userId === null) {
      throw tokenInvalid();
    }

    const credential = await this.prisma.db.userCredential.findUnique({
      where: { userId: invitation.userId },
      select: { totpSecretEnc: true },
    });
    if (credential?.totpSecretEnc == null) throw tokenInvalid();

    let secret: string;
    try {
      secret = this.envelope.decrypt(credential.totpSecretEnc);
    } catch {
      // A ciphertext that no longer authenticates is a corrupt enrolment.
      // The honest answer is that there is no secret, so the code cannot
      // verify — the safe direction.
      throw tokenInvalid();
    }

    if (!this.totp.verify(secret, input.code)) {
      throw AppException.unauthorized('otp_invalid', 'That code is not valid');
    }

    const now = new Date();
    const userId = invitation.userId;

    await this.prisma.$transaction(async (tx) => {
      // The invitation is spent first and conditionally, so two
      // concurrent activations cannot both go on to write the account.
      const claimed = await tx.adminInvitation.updateMany({
        where: { id: invitation.id, completedAt: null, revokedAt: null },
        data: { completedAt: now },
      });
      if (claimed.count !== 1) throw tokenInvalid();

      await tx.user.update({
        where: { id: userId },
        data: { status: UserStatus.ACTIVE, twoFactorEnabled: true },
      });

      // Written inside the transaction, and so deliberately **not**
      // through the M8.6 recorder: the recorder holds its own client and
      // could not join this transaction, so a failure after the commit
      // would leave an activated administrator account whose feed never
      // says how it was activated. Every other activity write in the
      // codebase goes through `ACTIVITY_RECORDER`; this is the one place
      // atomicity is worth more than the shared fail-soft behaviour.
      await tx.userActivityLog.create({
        data: {
          userId,
          kind: 'SECURITY',
          summary: 'Account activated with two-factor authentication',
        },
      });
    });

    await this.audit.record({
      action: 'admin.invitation_completed',
      actor: { userId, role: invitation.roleCode },
      entityType: 'admin_invitation',
      entityId: invitation.id,
      metadata: { status: UserStatus.ACTIVE, twoFactor: true },
    });

    return { nextStep: 'login', email: invitation.email };
  }

  /**
   * The invitation behind a raw token, or `null` when it is unusable for
   * any reason — unknown, expired, revoked or already completed.
   *
   * Looked up by hash on a unique index, so the raw token is never
   * compared in application code and never stored.
   */
  private async pendingInvitation(rawToken: string): Promise<{
    id: string;
    email: string;
    roleId: string;
    roleCode: string;
    permissions: string[];
    // `null` for the bootstrap invitation (`admin-bootstrap.service.ts`).
    invitedBy: string | null;
    userId: string | null;
    acceptedAt: Date | null;
  } | null> {
    const invitation = await this.prisma.db.adminInvitation.findUnique({
      where: { tokenHash: this.secrets.hash(rawToken) },
      select: {
        id: true,
        email: true,
        roleId: true,
        permissions: true,
        invitedBy: true,
        userId: true,
        expiresAt: true,
        acceptedAt: true,
        completedAt: true,
        revokedAt: true,
        // The audit actor needs the role's code, not its uuid. Joined
        // here rather than queried again in each phase — the row is
        // already being read and the FK is RESTRICT, so it cannot be
        // missing.
        role: { select: { code: true } },
      },
    });

    if (invitation === null) return null;
    if (invitation.revokedAt !== null) return null;
    if (invitation.completedAt !== null) return null;
    if (invitation.expiresAt.getTime() <= Date.now()) return null;

    return {
      id: invitation.id,
      email: invitation.email,
      roleId: invitation.roleId,
      roleCode: invitation.role.code,
      permissions: invitation.permissions,
      invitedBy: invitation.invitedBy,
      userId: invitation.userId,
      acceptedAt: invitation.acceptedAt,
    };
  }

  /**
   * `permissions.code` values to row ids.
   *
   * Codes that match no row are dropped rather than raising. The DTO has
   * already validated every code against the catalogue, so a miss here
   * means the seed is behind the catalogue — an operator problem that
   * must not strand an invitee mid-acceptance with a half-created
   * account. The role bundle still applies; the override is what is lost.
   */
  private async resolvePermissionIds(codes: readonly string[]): Promise<string[]> {
    if (codes.length === 0) return [];

    const rows = await this.prisma.db.permission.findMany({
      where: { code: { in: [...codes] } },
      select: { id: true },
    });

    return rows.map((row) => row.id);
  }
}

/**
 * 422 `token_invalid` — every failure mode of every phase.
 *
 * The same status and code `reset-password` uses (API §1.8), and for the
 * same reason: the token is a field of the request body rather than a
 * credential in a header.
 */
function tokenInvalid(): AppException {
  return AppException.validation(
    { token: ['This invitation link is no longer valid'] },
    'This invitation link is no longer valid',
    'token_invalid',
  );
}

/**
 * A provisional display name from the invited address.
 *
 * `users.display_name` is NOT NULL and the invitation carries no human
 * name — it carries an address and a role. The local part is visibly
 * provisional, which is the point: an invitee who sees "m.reed" in the
 * header knows to set their name, where a plausible invented one would
 * simply look wrong to everyone else and right to nobody.
 */
function localPartOf(email: string): string {
  return email.split('@')[0] ?? email;
}
