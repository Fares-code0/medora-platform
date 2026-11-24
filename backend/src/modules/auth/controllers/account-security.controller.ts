import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { CurrentUser } from '../../../common/auth/current-user.decorator';
import { zodBody, zodQuery } from '../../../common/validation/zod-validation.pipe';
import { Authenticated, NotPhi, OutsideClinicalStanding } from '../../../shared/authz';
import type {
  ActiveSessionView,
  LoginEventView,
  Paginated,
  TrustedDeviceView,
} from '../dto/account-security.dto';
import {
  historyQuerySchema,
  registerDeviceSchema,
  type HistoryQuery,
  type RegisterDeviceInput,
} from '../dto/account-security.schema';
import { AccountSecurityService } from '../services/account-security.service';

/**
 * Sessions, trusted devices and sign-in history (RM M8.3–M8.5,
 * API §2.4–2.7).
 *
 * Three resources and one controller, against this codebase's usual
 * one-resource-one-controller habit. They are one *screen* — Settings →
 * Security renders all three panels from one `SecuritySettings` document
 * — and, more to the point, one authorization rule with one subject: the
 * token. Splitting them into three files would triple the surface on
 * which that rule could be got wrong, for no gain in clarity.
 *
 * `@Authenticated()` at class level is the whole decision, for the
 * reason the decorator documents: there is no `userId` parameter on any
 * route here to substitute, and a patient holds zero capabilities
 * (ADR-030 §6), so a `@Can(...)` would deny the audience `GET
 * /me/sessions` exists for.
 *
 * The routes live in the auth module rather than users because sessions,
 * trusted devices and login events are the identity aggregate
 * `IdentityRepository` documents — the same reason `POST /me/password`
 * and `POST /me/2fa/*` are here despite their `/me` paths.
 */
@Authenticated()
// F-09: on the allowlist for an account outside clinical standing.
@OutsideClinicalStanding()
@Controller('me')
export class AccountSecurityController {
  constructor(private readonly security: AccountSecurityService) {}

  /** API §2.4 — the live sessions, current one flagged. */
  @NotPhi('the caller’s own sessions')
  @Get('sessions')
  sessions(@CurrentUser() user: AuthenticatedUser): Promise<readonly ActiveSessionView[]> {
    return this.security.sessions(user);
  }

  /**
   * API §2.5 — sign out everywhere else.
   *
   * Declared **before** `DELETE /sessions/:sessionId` would matter if
   * they shared a method; they do not, so the order is for a reader
   * rather than for the router. `POST` and not `DELETE` because the
   * contract says so, and because it returns a count the client
   * reconciles its list against.
   */
  @Post('sessions/revoke-others')
  @HttpCode(HttpStatus.OK)
  revokeOthers(@CurrentUser() user: AuthenticatedUser): Promise<{ revoked: number }> {
    return this.security.revokeOtherSessions(user);
  }

  /** API §2.5 — revoke one. 404 for a session that is not the caller's. */
  @Delete('sessions/:sessionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId') sessionId: string,
  ): Promise<void> {
    return this.security.revokeSession(user, sessionId);
  }

  /** API §2.6 — the devices this account trusts. */
  @NotPhi('the caller’s own devices')
  @Get('devices')
  devices(@CurrentUser() user: AuthenticatedUser): Promise<readonly TrustedDeviceView[]> {
    return this.security.devices(user.id);
  }

  /** API §2.6 — trust a device. 201 with the created row. */
  @Post('devices')
  @HttpCode(HttpStatus.CREATED)
  addDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Body(zodBody(registerDeviceSchema)) body: RegisterDeviceInput,
  ): Promise<TrustedDeviceView> {
    return this.security.addDevice(user, body);
  }

  /** API §2.6 — stop trusting a device. Soft-removed, never deleted. */
  @Delete('devices/:deviceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  removeDevice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('deviceId') deviceId: string,
  ): Promise<void> {
    return this.security.removeDevice(user, deviceId);
  }

  /** API §2.7 — paginated sign-in history. Failures included. */
  @NotPhi('the caller’s own sign-in history')
  @Get('login-history')
  loginHistory(
    @CurrentUser() user: AuthenticatedUser,
    @Query(zodQuery(historyQuerySchema)) query: HistoryQuery,
  ): Promise<Paginated<LoginEventView>> {
    return this.security.loginHistory(user.id, query);
  }
}
