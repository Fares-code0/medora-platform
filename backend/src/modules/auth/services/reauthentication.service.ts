import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import { ReauthenticationPort } from '../../../shared/authz';
import { IdentityRepository } from '../repositories/identity.repository';

import { CredentialLockoutService } from './credential-lockout.service';
import { PasswordService } from './password.service';
import { SessionService } from './session.service';

/**
 * `POST /me/password/verify` — the lock screen's re-authentication
 * (`docs/handoff/auth-seam.md` §4.1, A-07; Multi-Hospital checklist A5).
 *
 * ## Why a route rather than a second login
 *
 * The web client's lock screen spent a real `POST /auth/login`. That is a
 * true password check, but it **minted a second session**, and the one the
 * lock screen interrupted stayed live until its refresh TTL ran out — so
 * every unlock left an orphan session on the account's device list and a
 * refresh token nobody was going to use or revoke. This route checks the
 * password **for the session that is already open** and answers 204: no
 * token, no cookie, no new session row.
 *
 * It also lets a two-factor account unlock in place. Login answers such an
 * account with a step-up challenge, and the lock screen has no field for
 * a code. The session being unlocked already completed its second factor
 * at sign-in; the lock screen re-proves the knowledge factor for the
 * person now at the keyboard, which is what an idle lock is for.
 *
 * ## The guess budget is the sign-in budget
 *
 * A lock screen is, by definition, a live session on a workstation its
 * owner walked away from — the one place an attacker can guess passwords
 * without first having to sign in. So a wrong password here spends from
 * the **same** counter sign-in does (`CredentialLockoutService`), and the
 * guess that reaches the policy's limit:
 *
 *  1. locks the account for `lockoutMinutes`, exactly as sign-in would;
 *  2. **revokes the session being unlocked**, so the next refresh fails
 *     and the client is returned to the sign-in page — a locked account
 *     must not keep a working session behind a lock screen;
 *  3. answers 429 `rate_limited` with `Retry-After`.
 *
 * A request while the account is already locked is answered the same
 * way, and also revokes the session: the lock may have been earned at the
 * sign-in form by someone else, and it applies to every way in.
 *
 * A wrong password below the limit is **401 `invalid_credentials`** — the
 * code `POST /me/password` already uses for a wrong current password, so
 * a client that discriminates 401s by code (RM M39.4) treats it as a
 * failed check rather than an expired token.
 *
 * ## Audited both ways
 *
 * `auth.reauthenticate` on success and `auth.reauthenticate_failed` on
 * every refusal, the second at `warning`: a run of failures against one
 * live session is the row an investigator of a walked-away workstation
 * looks for.
 */
@Injectable()
export class ReauthenticationService implements OnModuleInit {
  constructor(
    private readonly identity: IdentityRepository,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly lockout: CredentialLockoutService,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
    private readonly port?: ReauthenticationPort,
  ) {}

  /**
   * Binds this service to the shared kernel's `ReauthenticationPort`, so
   * Exceptional Access and Emergency Override re-prove the password through
   * exactly this check (fix-list item 5). Optional only for unit tests that
   * construct the service by hand.
   */
  onModuleInit(): void {
    this.port?.bind(this);
  }

  async verify(principal: AuthenticatedUser, password: string): Promise<void> {
    const user = await this.identity.findById(principal.id);
    if (user?.credentials == null) throw AppException.notFound('Account not found');

    const lockedFor = this.lockout.remainingSeconds(user.credentials);
    if (lockedFor > 0) {
      await this.refuse(principal, user.publicId, 'locked');
      await this.sessions.revoke(principal.sessionId);
      throw AppException.rateLimited(lockedFor, 'Too many failed attempts');
    }

    if (!(await this.passwords.verify(user.credentials.passwordHash, password))) {
      const locked = await this.lockout.recordFailure(user.id);
      await this.refuse(principal, user.publicId, locked > 0 ? 'locked' : 'invalid_credentials');

      if (locked > 0) {
        await this.sessions.revoke(principal.sessionId);
        throw AppException.rateLimited(locked, 'Too many failed attempts');
      }

      throw AppException.unauthorized('invalid_credentials', 'Password is not correct');
    }

    await this.lockout.clear(user.id);

    await this.audit.record({
      action: 'auth.reauthenticate',
      actor: { userId: principal.id, role: principal.role, sessionId: principal.sessionId },
      entityType: 'user',
      entityId: user.publicId,
    });
  }

  private async refuse(
    principal: AuthenticatedUser,
    userPublicId: string,
    reason: 'invalid_credentials' | 'locked',
  ): Promise<void> {
    await this.audit.record({
      action: 'auth.reauthenticate_failed',
      actor: { userId: principal.id, role: principal.role, sessionId: principal.sessionId },
      entityType: 'user',
      entityId: userPublicId,
      metadata: { reason },
    });
  }
}
