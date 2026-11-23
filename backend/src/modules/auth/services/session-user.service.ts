/**
 * `GET /auth/session` — the caller, as the shell knows them (RM M8.1).
 *
 * ## Why the row is re-read instead of echoing the token
 *
 * The access token already carries the role and the permission list, so
 * answering this from the token would cost nothing. It would also be
 * wrong in the one case the endpoint exists for: `displayName` and
 * `email` are **not** in the token, and the shell renders both. Reading
 * the row is what makes a renamed user's name change on the next boot
 * rather than on the next sign-in.
 *
 * ## Permissions still come from the token, deliberately
 *
 * API §1.11 fixes them for the life of the access token — "permissions
 * are static per session (changes apply at next issue)". Re-resolving
 * them here would produce a `SessionUser` whose capability list
 * disagrees with the one the guards are enforcing for the very same
 * request, and the frontend's `useCan()` would show a button the API
 * then refuses. One source per token life, and it is the token.
 *
 * ## A deleted or deactivated account is a 401, not a 404
 *
 * The soft-delete extension filters `deletedAt`, and the status check is
 * explicit. Both mean the same thing to a client holding a valid token
 * for an account that can no longer be used: the session is over. 401 is
 * what `ApiClient` turns into a sign-out; a 404 would render as a broken
 * page with the user still apparently signed in.
 */

import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';
import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import type { HospitalContext } from '../../../common/auth/hospital-context';
import { UserStatus } from '../../../generated/prisma/enums';
import { HospitalContextService } from '../../../shared/authz';
import { IdentityRepository } from '../repositories/identity.repository';
import type { SessionUserPayload } from './login.service';

export interface CurrentSessionUserPayload extends SessionUserPayload {
  readonly activeHospital: { readonly id: string; readonly name: string } | null;
  readonly adminScope:
    | { readonly type: 'platform' }
    | {
        readonly type: 'hospital';
        readonly hospital: { readonly id: string; readonly name: string };
      }
    | null;
}

@Injectable()
export class SessionUserService {
  constructor(
    private readonly identity: IdentityRepository,
    private readonly contexts: HospitalContextService,
  ) {}

  async current(principal: AuthenticatedUser): Promise<CurrentSessionUserPayload> {
    const user = await this.identity.findById(principal.id);

    if (user === null || user.status !== UserStatus.ACTIVE) {
      throw AppException.unauthorized('unauthorized', 'Session expired');
    }

    // Phase 22, shadow mode: server-derived, resolved only for this route and
    // shared with any other reader in the request. A lookup failure reads as
    // unresolved (both fields null) — it never fails the session call.
    const hospitalContext = await this.contexts.forRequest(principal);

    return {
      id: user.publicId,
      name: user.displayName,
      email: user.email,
      // The role is read back rather than taken from the token for the
      // same reason the name is: an administrator who changed it wants
      // the change visible, and the guards read the token's copy anyway.
      role: user.role.code,
      permissions: principal.permissions,
      ...sessionHospitalScope(hospitalContext),
    };
  }
}
function sessionHospitalScope(
  context: HospitalContext,
): Pick<CurrentSessionUserPayload, 'activeHospital' | 'adminScope'> {
  if (context.kind === 'platform') {
    return { activeHospital: null, adminScope: { type: 'platform' } };
  }

  if (context.kind === 'hospital') {
    const hospital = { id: context.hospitalId, name: context.hospitalName };
    if (context.source === 'doctor_employment') {
      return { activeHospital: hospital, adminScope: null };
    }
    return { activeHospital: null, adminScope: { type: 'hospital', hospital } };
  }

  return { activeHospital: null, adminScope: null };
}
