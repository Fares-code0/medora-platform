import { Inject, Injectable, Logger } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';
import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import { UserStatus } from '../../../generated/prisma/enums';
import { IdentityRepository } from '../repositories/identity.repository';

import { AccessTokenService } from './access-token.service';
import type { AuthenticatedPayload, RequestContext } from './login.service';
import { PermissionService } from './permission.service';
import { type RefreshOutcome, SessionService } from './session.service';

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
 * ## The grace window (ADR-045)
 *
 * A retired token is not always a stolen one. A rotation whose response
 * was lost, two tabs sharing one cookie, and concurrent refreshes all
 * re-present the token a rotation retired a moment ago, and treating
 * those as theft signed users out for nothing. For
 * `REFRESH_GRACE_WINDOW_SECONDS` after a rotation, the retired token is
 * therefore answered with **the same successor** the rotation issued —
 * no second rotation, no sliding — plus a fresh access token, and an
 * `info` audit row. After the window, or when any of
 * `decideRefresh`'s checks fails, the family is revoked exactly as above.
 * The decision is made inside one transaction holding the session row
 * locked (`SessionService.refresh`), so a re-delivered successor is
 * always the session's current token.
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
    // One transaction over one locked row decides and commits everything
    // (ADR-045 §Concurrency). What follows runs only after that commit, so
    // an audit row or a log line never describes a decision that rolled
    // back, and each request produces at most one of them.
    const outcome = await this.sessions.refresh(presentedToken);

    switch (outcome.kind) {
      // Unknown, two generations old, or the current token of an ended
      // session — and, identically on the wire, every other refusal below.
      case 'refused':
        throw expiredSession();

      // One critical row per revocation: only the request whose transaction
      // revoked the session reports reuse. A replay that finds the family
      // already ended — by a logout, a reset, an administrator, or a
      // concurrent replay — is still recorded, as a warning. Same 401.
      case 'reuse':
        if (outcome.revokedNow) await this.reportReplay(outcome, context);
        else await this.reportReplayOnRevoked(outcome, context);
        throw expiredSession();

      case 'rotated':
        return this.issue(outcome, outcome.refreshToken, outcome.ttlSeconds);

      case 'grace': {
        // Not rotated again and `expires_at` not slid: the retry receives
        // exactly the token the rotation issued, which is still the
        // session's current one, so every caller converges on one token.
        const result = await this.issue(outcome, outcome.refreshToken, outcome.ttlSeconds);

        // `info`, not `warning`: this is the expected shape of a lost
        // response, a second tab or a concurrent refresh. It is audited so
        // that a window being used much more often than retries explain is
        // visible. System actor for the reason `reportReplay` gives.
        await this.audit.record({
          action: 'auth.refresh_grace_replay_accepted',
          actor: {
            userId: null,
            role: null,
            ...(context.ipAddress === undefined ? {} : { ipAddress: context.ipAddress }),
          },
          entityType: 'session',
          entityId: outcome.sessionId,
          metadata: { userId: outcome.userId },
        });

        return result;
      }
    }
  }

  /** The access token and session user for a refresh that succeeded. */
  private async issue(
    live: { readonly sessionId: string; readonly userId: string },
    refreshToken: string,
    ttlSeconds: number,
  ): Promise<{ payload: AuthenticatedPayload; refreshToken: string; ttlSeconds: number }> {
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
      await this.sessions.revoke(live.sessionId);
      throw expiredSession();
    }

    // §2.6: termination revokes every session when it happens; this is the
    // second line, for a session that predates it or survived a failure.
    if (await this.permissions.isTerminated(user.id, user.role.code)) {
      await this.sessions.revoke(live.sessionId);
      throw expiredSession();
    }

    const permissions = await this.permissions.resolve(user.id, user.roleId, user.role.code);
    const principal: AuthenticatedUser = {
      id: user.id,
      publicId: user.publicId,
      role: user.role.code,
      permissions,
      sessionId: live.sessionId,
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
      refreshToken,
      ttlSeconds,
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
   * A superseded token that failed ADR-045's grace checks: a replay.
   *
   * Logged at error level and audited with a system actor: nobody is
   * authenticated at this point, and attributing the event to the
   * account whose session it was would read as though that user did it.
   * `shared/audit`'s contract calls a null actor "the system itself",
   * which is what noticed this.
   *
   * The revocation itself was committed by `SessionService.refresh`, in
   * the transaction that decided this was reuse; this only reports it,
   * after that commit, once per request. On the dispatcher (which never
   * throws, and writes on its own connection) rather than inside the
   * transaction: an audit outage must not stop the revocation, and a
   * process that dies between commit and this line loses the row, not the
   * revocation — the safe way round.
   */
  private async reportReplay(
    replayed: Extract<RefreshOutcome, { kind: 'reuse' }>,
    context: RequestContext,
  ): Promise<void> {
    this.logger.error(
      { sessionId: replayed.sessionId },
      'Refresh token reuse detected; session revoked',
    );

    await this.audit.record({
      action: 'auth.refresh_reuse_detected',
      actor: {
        userId: null,
        role: null,
        ...(context.ipAddress === undefined ? {} : { ipAddress: context.ipAddress }),
      },
      entityType: 'session',
      entityId: replayed.sessionId,
      // The subject id is metadata rather than the actor: it says whose
      // session was ended, not who ended it.
      metadata: { userId: replayed.userId, reason: 'refresh_token_reuse' },
    });
  }

  /**
   * A retired token presented against a session that was already revoked
   * (ADR-045, review M1). Nothing is revoked here — the family had ended
   * before this request: by a logout, a password reset, an administrator,
   * a sign-out everywhere, or a concurrent replay that already raised the
   * critical `auth.refresh_reuse_detected`. Recorded at `warning`, with the
   * same system actor and no token, because a stolen retired token tried
   * after the victim signed out is still worth finding.
   */
  private async reportReplayOnRevoked(
    replayed: Extract<RefreshOutcome, { kind: 'reuse' }>,
    context: RequestContext,
  ): Promise<void> {
    this.logger.warn(
      { sessionId: replayed.sessionId },
      'Retired refresh token presented against an already-revoked session',
    );

    await this.audit.record({
      action: 'auth.refresh_replay_on_revoked_session',
      actor: {
        userId: null,
        role: null,
        ...(context.ipAddress === undefined ? {} : { ipAddress: context.ipAddress }),
      },
      entityType: 'session',
      entityId: replayed.sessionId,
      metadata: { userId: replayed.userId, reason: 'refresh_token_replay_on_revoked_session' },
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
