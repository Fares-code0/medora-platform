import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AUTHENTICATED_USER, type RequestWithUser } from '../../../common/auth/authenticated-user';
import { IS_PUBLIC_KEY } from '../../../common/auth/public.decorator';
import { AppException } from '../../../common/errors/app.exception';
import { PolicyService } from '../../../config';

/**
 * Shown when an administrator switched maintenance on without writing a
 * message. The settings panel allows an empty one (`maintenanceMessage`
 * is `text(300)`), and a 503 with an empty `message` would leave the
 * client nothing to display.
 */
export const DEFAULT_MAINTENANCE_MESSAGE = 'Medora is undergoing maintenance. Please try again later.';

/** The role that keeps working through a maintenance window. */
const ADMIN_ROLE = 'admin';

/**
 * Maintenance mode (RM M38.3, API §19.7).
 *
 * > API §19.7 — "via 19.2 general slice — when on, middleware returns 503
 * > + message to non-admin requests"
 *
 * The flag has been settable since M24.6 and resolved by `PolicyService`
 * (database over `MAINTENANCE_MODE`), but nothing read it: an
 * administrator could switch maintenance on and every user carried on as
 * before. This is the reader.
 *
 * ## Why a guard and not middleware
 *
 * §19.7 says "middleware", but the decision it describes needs the
 * caller's role, and the role is known only once `AccessTokenGuard` has
 * verified the token. Nest middleware runs before every guard, so a
 * middleware would have to verify the token a second time. A global
 * guard registered after authentication reads the principal that is
 * already there — the behaviour §19.7 states, in the place that can
 * implement it.
 *
 * ## Who passes
 *
 * - **Administrators** — the contract's exception, and the people who
 *   switch it off again.
 * - **`@Public()` routes** — sign-in, refresh, registration, the
 *   invitation flow and the health probe. An administrator has to be able
 *   to *obtain* a session during a window, which means login cannot be
 *   closed to an anonymous caller who has not yet said who they are; and
 *   an orchestrator's health check must keep answering, or a maintenance
 *   window becomes a restart loop. A non-administrator who signs in is
 *   refused on the first authenticated call that follows.
 *
 * Everyone else receives 503 `service_unavailable` carrying the
 * configured message (API §0.3: 5xx carries `ref`).
 *
 * ## Cost
 *
 * The flag is read on each authenticated, non-administrator request.
 * `PolicyService.current()` is deliberately uncached (M3.3: caching a
 * policy needs M31's invalidation story), so this is one small read of
 * `platform_settings` per request — the price of a switch that takes
 * effect immediately on every instance. Caching it is M31's.
 */
@Injectable()
export class MaintenanceModeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly policy: PolicyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic === true) return true;

    const request = context.switchToHttp().getRequest<Request & RequestWithUser>();
    // Registered after `AccessTokenGuard`, so a non-public route always
    // has a principal here. Its absence is not ours to decide.
    if (request[AUTHENTICATED_USER]?.role === ADMIN_ROLE) return true;

    const { maintenanceMode, maintenanceMessage } = await this.policy.current();
    if (!maintenanceMode) return true;

    const message = maintenanceMessage.trim();
    throw new AppException(HttpStatus.SERVICE_UNAVAILABLE, {
      message: message.length > 0 ? message : DEFAULT_MAINTENANCE_MESSAGE,
      code: 'service_unavailable',
    });
  }
}
