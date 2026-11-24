import {
  applyDecorators,
  createParamDecorator,
  Injectable,
  SetMetadata,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AUTHENTICATED_USER, type RequestWithUser } from '../../common/auth/authenticated-user';
import { AppException } from '../../common/errors/app.exception';
import { AdminScopeService, type ResolvedAdminScope } from './admin-scope.service';

/**
 * Which administrative scopes a route admits (S5).
 *
 * | Mode | Platform Admin | Hospital Admin | Unmapped / ambiguous admin |
 * | --- | --- | --- | --- |
 * | `platform` | yes | **403** | **403** |
 * | `any` | yes, platform-wide | yes, its hospital's rows only (other rows 404) | **403** |
 * | `hospital` | **403** (hospital operations carry patient identities; OD-07: no automatic PHI) | yes, its hospital's rows only | **403** |
 *
 * ## 403, not 404, for a missing scope
 *
 * A missing or wrong administrative scope is a missing **capability** for
 * the whole route, exactly what `AuthorizationGuard` answers 403 for, with
 * the same generic body (`forbidden`, no hint of what was missing). 404 is
 * kept for its ADR-022 meaning: a **row** outside a scope the caller does
 * have. A Hospital Admin asking for another hospital's department gets 404;
 * a Hospital Admin calling a platform-only route gets 403.
 */
export type AdminScopeMode = 'platform' | 'any' | 'hospital';

export interface AdminScopeRule {
  readonly mode: AdminScopeMode;
  /**
   * Non-admin roles the route's own `@Roles`/`@Can` rule admits that this
   * guard lets through **without** an administrative scope (the handler
   * receives `null`). Every other non-admin principal is refused: an
   * administrative route is not widened by a permission override.
   */
  readonly otherRoles?: readonly string[];
}

export const ADMIN_SCOPE_METADATA = 'medora:authz:admin-scope';
const ADMIN_SCOPE_ON_REQUEST = Symbol('ADMIN_SCOPE_ON_REQUEST');

type RequestWithAdminScope = Request &
  RequestWithUser & { [ADMIN_SCOPE_ON_REQUEST]?: ResolvedAdminScope | null };

@Injectable()
export class AdminScopeGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly scopes: AdminScopeService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.getAllAndOverride<AdminScopeRule | undefined>(
      ADMIN_SCOPE_METADATA,
      [context.getHandler(), context.getClass()],
    );
    // A guard mounted without a rule is a wiring mistake: fail closed.
    if (rule === undefined) throw AppException.forbidden();

    const request = context.switchToHttp().getRequest<RequestWithAdminScope>();
    const user = request[AUTHENTICATED_USER];
    if (user === undefined) throw AppException.unauthorized();

    if (user.role !== 'admin') {
      if (rule.otherRoles?.includes(user.role) === true) {
        request[ADMIN_SCOPE_ON_REQUEST] = null;
        return true;
      }
      throw AppException.forbidden();
    }

    const scope = await this.scopes.forRequest(user);
    if (scope.kind === 'none') throw AppException.forbidden();
    if (rule.mode === 'platform' && scope.kind !== 'platform') throw AppException.forbidden();
    if (rule.mode === 'hospital' && scope.kind !== 'hospital') throw AppException.forbidden();

    request[ADMIN_SCOPE_ON_REQUEST] = scope;
    return true;
  }
}

/**
 * Declares the route's administrative scope and mounts `AdminScopeGuard`.
 * Runs after the global authentication and authorization guards, so the
 * route's `@Roles`/`@Can` rule still applies first.
 */
export function AdminScoped(
  mode: AdminScopeMode,
  options: { readonly otherRoles?: readonly string[] } = {},
): MethodDecorator & ClassDecorator {
  const rule: AdminScopeRule = { mode, ...options };
  return applyDecorators(SetMetadata(ADMIN_SCOPE_METADATA, rule), UseGuards(AdminScopeGuard));
}

/**
 * The scope `AdminScopeGuard` resolved for this request. Throws (403) on a
 * route without the guard, or for a non-admin role let through by
 * `otherRoles`, so a handler can never act on an unresolved scope.
 */
export const CurrentAdminScope = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ResolvedAdminScope => {
    const scope = context.switchToHttp().getRequest<RequestWithAdminScope>()[
      ADMIN_SCOPE_ON_REQUEST
    ];
    if (scope === undefined || scope === null) throw AppException.forbidden();
    return scope;
  },
);

/**
 * For a route whose rule names `otherRoles`: the administrator's resolved
 * scope, or `null` for a non-admin role the rule let through. Throws (403)
 * on a route without the guard.
 */
export const CurrentAdminScopeOrOtherRole = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ResolvedAdminScope | null => {
    const scope = context.switchToHttp().getRequest<RequestWithAdminScope>()[
      ADMIN_SCOPE_ON_REQUEST
    ];
    if (scope === undefined) throw AppException.forbidden();
    return scope;
  },
);
