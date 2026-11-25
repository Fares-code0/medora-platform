import { Body, Controller, Get, Patch, Query } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { zodBody, zodQuery } from '../../../common/validation/zod-validation.pipe';
import { Authenticated, NotPhi, OutsideClinicalStanding } from '../../../shared/authz';
import type { AccountView } from '../dto/account.dto';
import {
  activityQuerySchema,
  updateAccountSchema,
  type ActivityQuery,
  type UpdateAccountInput,
} from '../dto/account.schema';
import { AccountService, type PaginatedActivity } from '../services/account.service';

/**
 * The caller's own account settings and activity (RM M8.1, M8.6 —
 * API §2.1, §2.2, §2.8).
 *
 * ## Why these three are here and `/me/password` is not
 *
 * The split follows what a route *needs*, not what its path says. These
 * read and write columns on `users` and rows in `user_activity_log`, and
 * nothing else — no hasher, no session revoker, no envelope key. The
 * password and 2FA routes need all three, which is why they stayed in
 * the auth module (`account-password.controller.ts` says so), and why
 * M2.2's zone 1 would have made moving them here impossible anyway.
 *
 * ## `@Authenticated()` is the whole authorization decision
 *
 * There is no `userId` parameter on any route here; the subject is the
 * token. A `@Can(...)` would deny patients, who hold zero capabilities
 * (ADR-030 §6) and who have an account settings screen like anyone else.
 */
@Authenticated()
// F-09: on the allowlist for an account outside clinical standing.
@OutsideClinicalStanding()
@Controller('me')
export class AccountController {
  /** API §2.1 — the Account panel's document. */
  constructor(private readonly accounts: AccountService) {}

  @NotPhi('the caller’s own account')

  @Get('account')
  account(@CurrentUser() user: AuthenticatedUser): Promise<AccountView> {
    return this.accounts.account(user.id);
  }

  /**
   * API §2.2 — username and phone.
   *
   * Returns the updated document rather than 204 so the client re-renders
   * from the server's answer: the username is lower-cased server-side,
   * and a client that kept its own optimistic copy would show `Amelia`
   * where the platform stored `amelia`.
   */
  @Patch('account')
  updateAccount(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(updateAccountSchema)) body: UpdateAccountInput,
  ): Promise<AccountView> {
    return this.accounts.updateAccount(user, body);
  }

  /** API §2.8 — the caller's own activity feed. */
  @NotPhi('the caller’s own activity')
  @Get('activity')
  activity(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(activityQuerySchema)) query: ActivityQuery,
  ): Promise<PaginatedActivity> {
    return this.accounts.activityFeed(user.id, query);
  }
}
