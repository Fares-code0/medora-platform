import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AppException } from '../../../common/errors/app.exception';
import { ALLOW_ENDED_SESSION_KEY } from '../../../common/auth/allow-ended-session.decorator';
import {
  AUTHENTICATED_USER,
  type AuthenticatedUser,
  type RequestWithUser,
} from '../../../common/auth/authenticated-user';
import { IS_PUBLIC_KEY } from '../../../common/auth/public.decorator';
import { PermissionResolver } from '../../../shared/authz';
import { AccessTokenService } from '../services/access-token.service';
import { SessionService } from '../services/session.service';

import { isOwnAccountRoute } from './own-account-routes';

/**
 * Bearer-token authentication (RM M6.2; M7.1 layers role and permission
 * guards over it).
 *
 * Registered globally, so **every route requires a token unless it says
 * otherwise**. The inversion is the point: a route added in a later
 * milestone by someone who did not think about authentication is
 * protected, and a route that should be open has to say so where a
 * reviewer can see it. The alternative — opting in per controller —
 * fails silently in the direction that matters.
 *
 * ## The signature, then the session (PRE-01)
 *
 * A valid signature proves the token was minted here; it does not prove
 * the session behind it is still live. Owner decisions I4 and O-13
 * (FINAL) make the second check policy: every protected request is
 * refused once its session is revoked or expired, or its account stops
 * being `ACTIVE`. `SessionService.isActive` answers that from
 * PostgreSQL on every request — one primary-key read, uncached (I2;
 * C-12 is open, so there is no cache whose staleness it could bound).
 *
 * Before PRE-01 this guard did no database read, and a revoked
 * session's access token kept working until it expired (up to
 * `JWT_ACCESS_TTL`, 900 s) — MRR-01 in the MFA recovery risk register.
 *
 * The one route that relaxes the check is logout (`@AllowEndedSession()`,
 * read from the handler only), whose idempotent contract needs it. It
 * waives liveness and keeps identity: the token's session must still
 * exist and belong to its subject (`SessionService.belongsTo`). The
 * marker's own comment says why that grants nothing.
 *
 * ## Permissions apply on the next request (G4, ADR-047)
 *
 * The same read returns `users.permission_version`, which the database
 * bumps in the same transaction as every permission change. It is attached
 * to the principal, so `PermissionResolver` uses a cached set only at that
 * exact version. And when the token's `pv` claim differs from it (or is
 * absent), the token's `permissions` claim is stale: it is replaced, here,
 * by a fresh resolution, so nothing downstream that reads
 * `user.permissions` can be granted anything by an old claim. A failure to
 * re-resolve propagates and the request is refused — fail closed.
 *
 * None of this revokes a session or answers 401: an ordinary permission
 * change takes effect on the same token. A *role* change is still refused
 * 401 through the role check above (ADR-046; its session is not revoked).
 *
 * ## Doctor lifecycle (#18)
 *
 * The same read refuses a doctor whose employment has ended (401, as a
 * dead session) and reports a suspended doctor, whom this guard then
 * confines to `OWN_ACCOUNT_ROUTES` — every other route is 403
 * `practice_suspended`. Unverified and on-vacation doctors are not
 * affected here; clinical access is decided by the authorization layer.
 *
 * ## 401 and not 403
 *
 * ADR-013: 401 is reserved for authentication and token problems, and
 * the frontend's client treats it as "refresh once, then log out". A
 * missing or expired token is exactly that situation. An authenticated
 * user who lacks a permission is 403, which is M7's guard, not this one.
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessTokens: AccessTokenService,
    private readonly sessions: SessionService,
    private readonly permissions: PermissionResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      // Handler first: a public route inside an otherwise guarded
      // controller must win, which `getAllAndOverride` gives in this order.
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic === true) return true;

    const request = context.switchToHttp().getRequest<Request & RequestWithUser>();
    const token = bearerToken(request);
    if (token === undefined) throw AppException.unauthorized();

    const user = await this.accessTokens.verify(token);
    if (user === null) throw AppException.unauthorized();

    // Read from the handler alone, never the class: the exception is for
    // one route, and a controller-level marker must not be able to waive
    // the check for every route it declares.
    const allowEnded = this.reflector.get<boolean | undefined>(
      ALLOW_ENDED_SESSION_KEY,
      context.getHandler(),
    );

    // The same 401 the refresh answers for a dead session, and for the
    // same reason: the client's next move — refresh once, then sign out
    // (ADR-013) — is identical whether the session was revoked, expired
    // or its account suspended, and a caller who could tell those apart
    // could probe account state with a stolen token.
    //
    // An `@AllowEndedSession()` route waives liveness, not identity: the
    // session must still exist and belong to the token's subject.
    //
    // Every other route also requires the account to still hold the
    // token's role (F3, ADR-046): a role changed after the token was minted
    // is refused here, and the client's one refresh mints a token for the
    // current role. Logout keeps working for a demoted account.
    if (allowEnded === true) {
      if (!(await this.sessions.belongsTo(user.sessionId, user.id))) {
        throw AppException.unauthorized('unauthorized', 'Session expired');
      }
      // No version was read, so the principal carries none: the resolver
      // then never serves this request from cache (G4). The permission
      // claim is dropped for the same reason — nothing on an ended session
      // is authorized by a claim that cannot be checked.
      request[AUTHENTICATED_USER] = withoutVersion(user);
      return true;
    }

    // One statement: the session check, the role check, the doctor
    // lifecycle and the account's authoritative permission version (G4,
    // ADR-047; #18). A doctor whose employment has ended answers `null`.
    const account = await this.sessions.activePermissionVersion(user.sessionId, user.id, user.role);
    if (account === null) throw AppException.unauthorized('unauthorized', 'Session expired');

    // #18: a suspended doctor keeps their own account and nothing else.
    // Decided from the row just read, on every request — never from a
    // claim — and against an allow-list, so an unlisted route is refused.
    // 403, not 401: the session is valid, and a 401 would send the client
    // into refresh-then-sign-out for a state a refresh cannot change.
    if (account.practiceSuspended && !isOwnAccountRoute(context)) {
      throw practiceSuspended();
    }

    const version = account.permissionVersion;

    // A token whose `pv` matches was resolved at this version, so its claim
    // is current. Otherwise it is stale (or predates the claim) and is
    // replaced; a resolution failure throws and the request is refused.
    const permissions =
      user.permissionVersion === version
        ? user.permissions
        : [
            ...(await this.permissions.permissionsFor({
              userId: user.id,
              roleCode: user.role,
              sessionId: user.sessionId,
              permissionVersion: version,
            })),
          ].sort();

    request[AUTHENTICATED_USER] = { ...user, permissions, permissionVersion: version };
    return true;
  }
}

/**
 * 403 `practice_suspended` — a suspended doctor on a route outside their
 * own account (#18). It tells the caller only what their own sign-in
 * already showed them: this account is suspended from practice.
 */
function practiceSuspended(): AppException {
  return new AppException(HttpStatus.FORBIDDEN, {
    message: 'Your practice is suspended. Only your own account is available.',
    code: 'practice_suspended',
  });
}

/** The principal for a route that read no version: no version, no claim. */
function withoutVersion(user: AuthenticatedUser): AuthenticatedUser {
  const { permissionVersion: _ignored, ...rest } = user;
  return { ...rest, permissions: [] };
}

/**
 * `Authorization: Bearer <token>`.
 *
 * The scheme is compared case-insensitively — RFC 7235 says it is
 * case-insensitive, and a client sending `bearer` is not the failure
 * anyone wants to debug — and the token is not trimmed beyond the single
 * separating space, because a token with whitespace in it is not a token
 * this service issued.
 */
function bearerToken(request: Request): string | undefined {
  const header = request.headers.authorization;
  if (header === undefined) return undefined;

  const separator = header.indexOf(' ');
  if (separator === -1) return undefined;
  if (header.slice(0, separator).toLowerCase() !== 'bearer') return undefined;

  const token = header.slice(separator + 1);
  return token.length > 0 ? token : undefined;
}
