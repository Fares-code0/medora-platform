import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { zodBody, zodQuery } from '../../../common/validation/zod-validation.pipe';
import { Can, NotPhi } from '../../../shared/authz';
import type { PlatformUserView } from '../dto/account.dto';
import {
  activityQuerySchema,
  platformUserQuerySchema,
  updatePlatformUserSchema,
  type ActivityQuery,
  type PlatformUserQuery,
  type UpdatePlatformUserInput,
} from '../dto/account.schema';
import type { PaginatedActivity } from '../services/account.service';
import {
  PlatformUserService,
  type PaginatedPlatformUsers,
} from '../services/platform-user.service';

/**
 * The admin Users panel (RM M8.2, API §2.10).
 *
 * ## The capability, and why it is `roles.manage`
 *
 * API §2.10 writes the rule as "can:`doctors.manage` **or**
 * `roles.manage`", and `@Can(...)` is deliberately an AND — its own doc
 * comment explains that the narrower reading is the safe one to be wrong
 * about. The two halves of the contract's disjunction are not
 * interchangeable here: this route lists **every** account on the
 * platform, administrators included, and changes what role someone
 * holds. That is the permission matrix's subject, not the doctor
 * directory's, so `roles.manage` is the capability that fits.
 *
 * `doctors.manage` gets its own list at API §3.4 (`GET /doctors`, M9.5),
 * scoped to clinicians and carrying the operational statistics a
 * practice manager needs. Someone holding only `doctors.manage` is
 * served by that route, not by a narrowed version of this one — and
 * narrowing this one by role would put an authorization decision inside
 * a query, where nothing tests it.
 *
 * ## There is no `POST /admin/users`
 *
 * API §2.10 lists one, described as "(invite)". It already exists, with
 * a stronger flow than a POST here would have:
 * `POST /auth/admin-invitations` (ADR-035 §5), guarded by the same
 * `roles.manage`, covering `admin`, `reception`, `laboratory` and
 * `pharmacy`. It mints no password, delivers the token to the invitee's
 * inbox alone, and — for administrators — cannot complete without a TOTP
 * enrolment.
 *
 * Building a second provisioning path here would mean either duplicating
 * those guarantees or, far more likely, quietly not having them. Doctors
 * are deliberately outside both: they self-register and are then
 * verified (M9.3), because their professional registration number is
 * checked against a register rather than typed in by an administrator.
 */
@Can('roles.manage')
@Controller('admin/users')
export class PlatformUserController {
  constructor(private readonly users: PlatformUserService) {}

  /** API §2.10 — the paginated, filterable account list. */
  @NotPhi('user accounts; no clinical data')
  @Get()
  list(
    @Query(zodQuery(platformUserQuerySchema)) query: PlatformUserQuery,
  ): Promise<PaginatedPlatformUsers> {
    return this.users.list(query);
  }

  /** One account, by the `usr_…` id the list returned. */
  @NotPhi('a user account; no clinical data')
  @Get(':userId')
  detail(@Param('userId') userId: string): Promise<PlatformUserView> {
    return this.users.detail(userId);
  }

  /**
   * API §2.8's feed for the account being viewed — RM M29.1's "admin
   * profile view", the other half of `/me/activity`.
   *
   * Nest matches on path shape, so `:userId/activity` cannot be read as
   * a `:userId`; it is declared after the detail route for a reader
   * rather than for the router.
   *
   * The same projection the owner sees — `AccountService.activityFeed`
   * is reused rather than reimplemented, because two projections of one
   * feed drift and nobody compares the two screens.
   *
   * **Not a PHI surface**, and that is a property of the table rather
   * than of this route: `user_activity_log` holds account events, and
   * `shared/activity`'s contract forbids values outright — "a summary
   * names *what changed*, never the value it changed to". So there is no
   * masking question here, unlike every admin projection of a `patients`
   * row (API §4.11).
   */
  @NotPhi('account activity metadata')
  @Get(':userId/activity')
  activity(
    @Param('userId') userId: string,
    @Query(zodQuery(activityQuerySchema)) query: ActivityQuery,
  ): Promise<PaginatedActivity> {
    return this.users.activityFeed(userId, query);
  }

  /**
   * API §2.10 — role and active flag. Soft deactivation only.
   *
   * Returns the updated row so the panel re-renders from the server's
   * answer rather than from its own optimistic copy — which matters
   * here, because several of the service's refusals leave the row
   * unchanged and a client that assumed success would show a role the
   * platform rejected.
   */
  @Patch(':userId')
  update(
    @CurrentUser() actor: AuthenticatedUser,
    @Param('userId') userId: string,
    @Body(zodBody(updatePlatformUserSchema)) body: UpdatePlatformUserInput,
  ): Promise<PlatformUserView> {
    return this.users.update(actor, userId, body);
  }
}
