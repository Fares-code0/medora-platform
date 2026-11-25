import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { AppException } from '../../../common/errors/app.exception';
import { ALLOW_ENDED_SESSION_KEY } from '../../../common/auth/allow-ended-session.decorator';
import { AUTHENTICATED_USER, type RequestWithUser } from '../../../common/auth/authenticated-user';
import { IS_PUBLIC_KEY } from '../../../common/auth/public.decorator';
import { AccessTokenService } from '../services/access-token.service';
import { SessionService } from '../services/session.service';

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
      const owned = await this.sessions.belongsTo(user.sessionId, user.id);
      if (!owned) throw AppException.unauthorized('unauthorized', 'Session expired');
      request[AUTHENTICATED_USER] = user;
      return true;
    }

    // Liveness, identity, account status and the role claim in one read; the
    // answer carries the account's current `authz_version`, which keys the
    // permission cache for this request (multi-hospital §2.8–§2.10).
    const authzVersion = await this.sessions.liveAuthzVersion(user.sessionId, user.id, user.role);
    if (authzVersion === null) throw AppException.unauthorized('unauthorized', 'Session expired');

    request[AUTHENTICATED_USER] = { ...user, authzVersion };
    return true;
  }
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
