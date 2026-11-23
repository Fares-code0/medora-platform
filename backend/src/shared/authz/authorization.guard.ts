/**
 * The authorization guard (RM M7.1, API §0.4, MG §11.3).
 *
 * Reads `@Public`, `@Authenticated`, `@Roles` and `@Can` off the handler
 * — falling back to the controller class — and decides. Handler metadata
 * wins, so a class-wide `@Roles('admin')` can be narrowed on one route
 * without being repeated on the others.
 *
 * It runs *after* M6's `AccessTokenGuard`, which has already rejected an
 * unauthenticated caller on any route that is not `@Public()`. So the
 * 401 branch below is a belt-and-braces check rather than the usual
 * path: it fires only if this guard is ever mounted without that one.
 *
 * ## An unmarked route denies
 *
 * This is the one choice here worth arguing about, and it is the
 * opposite of the common default. Usually a guard that finds no metadata
 * waves the request through, on the theory that authentication already
 * happened. In a system whose rows are medical records, that turns a
 * forgotten decorator — the single most likely authorization mistake
 * anyone will make on this codebase — into a PHI disclosure that no test
 * fails on and no reviewer sees.
 *
 * Denying inverts the failure. The route 403s the first time it is
 * called in development, the author adds the capability they meant, and
 * the mistake costs a minute instead of a breach. `@Public()` and
 * `@Authenticated()` are how a route opts out deliberately, in a way
 * `grep` can enumerate.
 *
 * ## 401 versus 403
 *
 * ADR-013 is strict about this: 401 means *authentication*, and the
 * frontend's `ApiClient` reacts to it by running its single-flight
 * refresh and then logging the user out. An authorization failure
 * answered with 401 would silently sign a clinician out mid-shift rather
 * than telling them they lack a capability. So: no principal → 401;
 * every other refusal → 403.
 *
 * Neither response names the capability that was missing. A 403 body
 * reading "requires patients.revealIdentity" is a description of the
 * platform's internals, handed to whoever is probing for it.
 */

import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AppException } from '../../common/errors/app.exception';
import { PermissionResolver } from './permission-resolver.service';
import { AUTHENTICATED_USER, type RequestWithUser } from '../../common/auth/authenticated-user';
import { IS_PUBLIC_KEY } from '../../common/auth/public.decorator';
import { AdminScopeService } from './admin-scope.service';
import {
  AUTHENTICATED_METADATA,
  CAN_METADATA,
  PLATFORM_SCOPE_METADATA,
  ROLES_METADATA,
} from './authz.decorators';
import { principalOf } from './authz.types';
import type { Permission, PlatformRole } from './authz.types';

@Injectable()
export class AuthorizationGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly resolver: PermissionResolver,
    private readonly scopes: AdminScopeService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets) === true) {
      return true;
    }

    const roles = this.reflector.getAllAndOverride<readonly PlatformRole[]>(
      ROLES_METADATA,
      targets,
    );
    const capabilities = this.reflector.getAllAndOverride<readonly Permission[]>(
      CAN_METADATA,
      targets,
    );

    const authenticatedOnly =
      this.reflector.getAllAndOverride<boolean>(AUTHENTICATED_METADATA, targets) === true;

    const requiredRoles = roles ?? [];
    const requiredCapabilities = capabilities ?? [];

    // Deny-by-default. See the header — this is the point of the guard,
    // not an edge case in it.
    //
    // An *empty* list counts as no rule, not as a rule everything
    // satisfies: `@Can()` with no arguments would otherwise admit every
    // authenticated principal to a route whose author plainly meant to
    // name a capability and did not. Saying "any signed-in user" requires
    // `@Authenticated()`, which is a claim rather than an omission.
    if (!authenticatedOnly && requiredRoles.length === 0 && requiredCapabilities.length === 0) {
      throw AppException.forbidden();
    }

    // The same slot M6's AccessTokenGuard writes. One principal on the
    // request, not two — see `authz.decorators.ts` on why a second was
    // removed rather than kept alongside.
    const request = context.switchToHttp().getRequest<Request & RequestWithUser>();
    const user = request[AUTHENTICATED_USER];

    if (user === undefined) {
      throw AppException.unauthorized();
    }

    const principal = principalOf(user);

    // Compared as strings: `roleCode` may be a seeded role with no
    // matrix column, which `PlatformRole` cannot express and which no
    // `@Roles(...)` list can name.
    const roleAllowed = requiredRoles.some((role) => role === principal.roleCode);
    if (requiredRoles.length > 0 && !roleAllowed) {
      throw AppException.forbidden();
    }

    if (!(await this.resolver.canAll(principal, requiredCapabilities))) {
      throw AppException.forbidden();
    }

    const platformOnly =
      this.reflector.getAllAndOverride<boolean>(PLATFORM_SCOPE_METADATA, targets) === true;

    // Administrative tiering (§2.2, §2.3, OD-07). An administrator acting
    // through a capability or role rule needs a resolved scope: platform
    // (explicit grant) or exactly one hospital. An unmapped or ambiguous
    // administrator is refused rather than inferred to be platform-wide;
    // self-service `@Authenticated()` routes are unaffected. A platform-tier
    // route additionally refuses a Hospital Admin.
    if (principal.roleCode === 'admin' && !authenticatedOnly) {
      const scope = await this.scopes.scopeOf(user);
      if (scope.kind === 'none') throw AppException.forbidden();
      if (platformOnly && scope.kind !== 'platform') throw AppException.forbidden();
    } else if (platformOnly) {
      throw AppException.forbidden();
    }

    return true;
  }
}
