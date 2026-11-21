import { Inject, Injectable, Logger } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';
import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import { UserStatus } from '../../../generated/prisma/enums';
import { IdentityRepository } from '../repositories/identity.repository';

import { AccessTokenService } from './access-token.service';
import type { AuthenticatedPayload, RequestContext } from './login.service';
import { PermissionService } from './permission.service';
import { SessionService } from './session.service';

/**
 * `POST /auth/refresh` and `POST /auth/logout` (RM M6.3, API §1.5–1.6).
 *
 * ## Rotation, and what makes reuse detectable
 *
 * Every refresh retires the presented token and issues a new one. On its
 * own that is not enough to notice theft: once the stored hash is
 * overwritten, a replayed token matches nothing and looks exactly like a
 * random string. The session row therefore keeps one generation back
 * (`previous_token_hash`, M6.3's migration), which turns the canonical
 * theft into an observable event — the attacker refreshes with the
 * stolen token, the real client presents the one it still holds, and
 * that presentation is recognised as a replay rather than as garbage.
 *
 * The response is **to revoke the family**, not to refuse the request.
 * By the time a replay is seen, two parties hold tokens for one session
 * and there is no way to tell which is the user. Ending the session
 * costs the real user one sign-in and costs the attacker everything.
 *
 * ## Why the whole `SessionUser` comes back
 *
 * API §1.5 returns the user as well as the token, and the frontend's
 * boot sequence is the reason: it refreshes before it has a session, so
 * this response is where the shell learns who it is rendering for. A
 * token-only response would force a second round trip on every page load.
 */
@Injectable()
export class RefreshService {
  private readonly logger = new Logger(RefreshService.name);

  constructor(
    private readonly sessions: SessionService,
    private readonly identity: IdentityRepository,
    private readonly permissions: PermissionService,
    private readonly accessTokens: AccessTokenService,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
  ) {}

  async refresh(
    presentedToken: string,
    context: RequestContext = {},
  ): Promise<{ payload: AuthenticatedPayload; refreshToken: string; ttlSeconds: number }> {
    const live = await this.sessions.findLive(presentedToken);

    if (live === null) {
      await this.handlePossibleReplay(presentedToken, context);
      throw expiredSession();
    }

    const rotated = await this.sessions.rotate(live, presentedToken);
    // Lost a race with a concurrent refresh. Not a replay — the token was
    // live a moment ago — so the family stands and the client retries.
    if (rotated === null) throw expiredSession();

    const user = await this.identity.findById(live.userId);
    // The account was deleted, suspended, locked or deactivated between
    // the sign-in and now. Soft delete hides the row from `findById`;
    // the three non-ACTIVE statuses do not, and have to be checked here
    // explicitly (M8.2, ADR-035 §6).
    //
    // **This is the line that makes suspension mean anything.** `login`
    // refuses a non-ACTIVE account, but an administrator suspends
    // someone who is *already signed in* — that is the situation
    // suspension exists for. Without this check the suspended session
    // rotates its refresh token indefinitely and the account keeps
    // working forever, which made the administrative lever a no-op for
    // exactly the case it was pulled in. The session is revoked as well
    // as refused, so the family cannot be retried.
    if (user === null || user.status !== UserStatus.ACTIVE) {
      await this.sessions.revoke(live.id);
      throw expiredSession();
    }

    const permissions = await this.permissions.resolve(user.id, user.roleId, user.role.code);
    const principal: AuthenticatedUser = {
      id: user.id,
      publicId: user.publicId,
      role: user.role.code,
      permissions,
      sessionId: live.id,
    };

    const { accessToken, expiresIn } = await this.accessTokens.issue(principal);

    return {
      payload: {
        user: {
          id: user.publicId,
          name: user.displayName,
          email: user.email,
          role: user.role.code,
          permissions,
        },
        accessToken,
        expiresIn,
      },
      refreshToken: rotated.refreshToken,
      ttlSeconds: rotated.ttlSeconds,
    };
  }

  /** Revokes the session behind an access token (API §1.6). */
  async logout(user: AuthenticatedUser, context: RequestContext = {}): Promise<void> {
    await this.sessions.revoke(user.sessionId);

    await this.audit.record({
      action: 'auth.logout',
      actor: {
        userId: user.id,
        role: user.role,
        ...(context.ipAddress === undefined ? {} : { ipAddress: context.ipAddress }),
      },
      entityType: 'session',
      entityId: user.sessionId,
    });
  }

  /**
   * A token that matches no live session may still be a replay.
   *
   * Logged at error level and audited with a system actor: nobody is
   * authenticated at this point, and attributing the event to the
   * account whose session it was would read as though that user did it.
   * `shared/audit`'s contract calls a null actor "the system itself",
   * which is what noticed this.
   */
  private async handlePossibleReplay(
    presentedToken: string,
    context: RequestContext,
  ): Promise<void> {
    const replayed = await this.sessions.findByPreviousToken(presentedToken);
    if (replayed === null) return;

    await this.sessions.revoke(replayed.id);

    this.logger.error({ sessionId: replayed.id }, 'Refresh token reuse detected; session revoked');

    await this.audit.record({
      action: 'auth.refresh_reuse_detected',
      actor: {
        userId: null,
        role: null,
        ...(context.ipAddress === undefined ? {} : { ipAddress: context.ipAddress }),
      },
      entityType: 'session',
      entityId: replayed.id,
      // The subject id is metadata rather than the actor: it says whose
      // session was ended, not who ended it.
      metadata: { userId: replayed.userId, reason: 'refresh_token_reuse' },
    });
  }
}

/**
 * 401 for every refresh failure — unknown, expired, revoked, replayed.
 *
 * ADR-013 makes 401 the client's "refresh once, then log out" signal, and
 * this *is* the refresh, so the client hard-logs-out. One shape for all
 * four cases because the client's next move is the same in each, and a
 * caller who could tell them apart could probe for live sessions.
 */
function expiredSession(): AppException {
  return AppException.unauthorized('unauthorized', 'Session expired');
}
