import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';

import { CurrentUser } from '../../../common/auth/current-user.decorator';
import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { Public } from '../../../common/auth/public.decorator';
import { Can } from '../../../shared/authz';
import { zodBody } from '../../../common/validation/zod-validation.pipe';
import { RateLimited } from '../../../shared/rate-limit';
import {
  acceptAdminInvitationSchema,
  activateAdminInvitationSchema,
  createAdminInvitationSchema,
} from '../dto';
import {
  type AcceptedInvitation,
  type ActivatedInvitation,
  AdminInvitationService,
  type CreatedInvitation,
} from '../services/admin-invitation.service';

/**
 * Administrator provisioning (ADR-035 §5).
 *
 * Three routes, and the split between them is the security boundary this
 * whole change exists to draw:
 *
 *  · **create** is `@Can('roles.manage')`. Only a principal who can
 *    already rewrite the permission matrix may confer a role that can
 *    rewrite the permission matrix. Not `@Roles('admin')` — a capability
 *    is the finer statement, it survives an administrator having that
 *    capability revoked by a per-user override, and it is what the
 *    resolver actually checks.
 *
 *  · **accept** and **activate** are `@Public()`, because the invitee has
 *    no account yet and therefore no token to present. The invitation is
 *    the credential. That is the same arrangement `reset-password` has,
 *    for the same reason, and it is safe for the same reason: the raw
 *    token exists only in one inbox, the database holds a digest, and
 *    every failure answers `token_invalid` identically.
 *
 * There is deliberately no `POST /auth/register` with `role: 'admin'` for
 * these routes to sit beside. The public registration DTO has no such
 * value, so the refusal is a 422 from the parser rather than a check
 * somebody has to remember to write.
 */
@Controller('auth/admin-invitations')
export class AdminInvitationController {
  constructor(private readonly invitations: AdminInvitationService) {}

  /**
   * **201** `{ email, role, expiresAt }`.
   *
   * The response deliberately carries no token. The invitation is
   * delivered to the invitee's inbox and nowhere else — returning it here
   * would let anyone holding `roles.manage` mint an administrator account
   * at an address they control without the owner of that address ever
   * being involved, which removes the one out-of-band step that makes
   * this flow worth having.
   */
  @Can('roles.manage')
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body(zodBody(createAdminInvitationSchema))
    body: ReturnType<typeof createAdminInvitationSchema.parse>,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<CreatedInvitation> {
    return this.invitations.create(body, user);
  }

  /**
   * **200** `{ nextStep: 'configure-mfa', email, secret, otpauthUrl,
   * recoveryCodes }`.
   *
   * Phase 1 of two. No session and no access token: the account exists
   * but is INACTIVE, and `LoginService` refuses it until phase 2 has run.
   *
   * This is the only time the recovery codes are returned, exactly as in
   * `TwoFactorService.setup` — they are stored encrypted and never read
   * back out, so an invitee who loses them asks for a new invitation.
   */
  @Public()
  @RateLimited('auth')
  @Post('accept')
  @HttpCode(HttpStatus.OK)
  accept(
    @Body(zodBody(acceptAdminInvitationSchema))
    body: ReturnType<typeof acceptAdminInvitationSchema.parse>,
  ): Promise<AcceptedInvitation> {
    return this.invitations.accept(body);
  }

  /**
   * **200** `{ nextStep: 'login', email }`.
   *
   * Phase 2. Still no session — the invitee signs in through
   * `POST /auth/login` like every other principal, so there is one code
   * path that mints sessions rather than two that have to agree.
   */
  @Public()
  @RateLimited('auth')
  @Post('activate')
  @HttpCode(HttpStatus.OK)
  activate(
    @Body(zodBody(activateAdminInvitationSchema))
    body: ReturnType<typeof activateAdminInvitationSchema.parse>,
  ): Promise<ActivatedInvitation> {
    return this.invitations.activate(body);
  }
}
