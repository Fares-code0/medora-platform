import { Injectable } from '@nestjs/common';

import { PolicyService } from '../../../config';
import { PrismaService } from '../../../shared/database';
import type { Prisma, Session } from '../../../generated/prisma/client';
import { UserStatus } from '../../../generated/prisma/enums';

import { SecretService } from './secret.service';

/** Any RFC 4122 textual uuid — the shape of `sessions.id` and `users.id`. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Sessions and their refresh tokens (RM M6.2, M6.3 — DB §A7).
 *
 * One `sessions` row **is** one refresh-token family: the row carries
 * the hash of the token currently valid for it, and M6.3 rotates that
 * hash on every refresh. Reuse of a superseded token is therefore
 * detectable without a second table — the presented hash matches no
 * live row, and the family it belonged to is the one to revoke.
 *
 * The raw token never touches the database, for the reason
 * `SecretService` states: a database read must not be able to mint a
 * session.
 */
export interface SessionContext {
  readonly device?: string | undefined;
  readonly ipAddress?: string | undefined;
}

export interface IssuedSession {
  readonly session: Session;
  /** The value for the `medora_rt` cookie. Never persisted. */
  readonly refreshToken: string;
  /** Seconds, for the cookie's `Max-Age`. */
  readonly ttlSeconds: number;
}

@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly secrets: SecretService,
    private readonly policy: PolicyService,
  ) {}

  /**
   * Starts a session.
   *
   * `singleSessionPerUser` is honoured here rather than at the call site
   * (API §1.2 — "revokes other sessions"), so every path that creates a
   * session obeys it: login today, the 2FA step-up at M6.4, and whatever
   * M8 adds. Revoking *before* the insert means the new session is never
   * itself a candidate, which a `revoke where id != new.id` would have
   * to special-case.
   */
  async start(
    userId: string,
    rememberMe: boolean,
    context: SessionContext = {},
  ): Promise<IssuedSession> {
    const policy = await this.policy.current();

    if (policy.singleSessionPerUser) {
      await this.revokeAllFor(userId);
    }

    const ttlSeconds = rememberMe
      ? policy.refreshTtlRememberSeconds
      : policy.refreshTtlDefaultSeconds;

    const refreshToken = this.secrets.randomToken();
    const session = await this.prisma.db.session.create({
      data: {
        userId,
        refreshTokenHash: this.secrets.hash(refreshToken),
        rememberMe,
        expiresAt: new Date(Date.now() + ttlSeconds * 1_000),
        ...(context.device === undefined ? {} : { device: context.device }),
        ...(context.ipAddress === undefined ? {} : { ipAddress: context.ipAddress }),
      },
    });

    return { session, refreshToken, ttlSeconds };
  }

  /** The live session a refresh token names, or `null`. */
  findLive(refreshToken: string): Promise<Session | null> {
    return this.prisma.db.session.findFirst({
      where: {
        refreshTokenHash: this.secrets.hash(refreshToken),
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });
  }

  /**
   * Rotates the token, slides the expiry, and hands back the new one.
   *
   * Three things happen together and must not be separable:
   *
   *  1. The current hash moves to `previous_token_hash`, which is what
   *     makes a replay of the token just retired detectable at all.
   *  2. A fresh token replaces it.
   *  3. `expires_at` slides forward by the session's own TTL (API §1.5 —
   *     "slides expiry"), so an active user is not signed out mid-shift
   *     while an abandoned session still ages out.
   *
   * The update is conditional on the hash that was presented, and the
   * row count decides. Two refreshes arriving together would otherwise
   * both read a live row and both rotate, leaving one client holding a
   * token that was overwritten a microsecond later — a spurious "reuse"
   * on their next refresh, and a logout for a user who did nothing wrong.
   */
  async rotate(session: Session, presentedToken: string): Promise<IssuedSession | null> {
    const policy = await this.policy.current();
    const ttlSeconds = session.rememberMe
      ? policy.refreshTtlRememberSeconds
      : policy.refreshTtlDefaultSeconds;

    const refreshToken = this.secrets.randomToken();
    const presentedHash = this.secrets.hash(presentedToken);

    const rotated = await this.prisma.db.session.updateMany({
      where: { id: session.id, refreshTokenHash: presentedHash, revokedAt: null },
      data: {
        refreshTokenHash: this.secrets.hash(refreshToken),
        previousTokenHash: presentedHash,
        expiresAt: new Date(Date.now() + ttlSeconds * 1_000),
        lastActiveAt: new Date(),
      },
    });

    if (rotated.count !== 1) return null;

    return {
      session: await this.prisma.db.session.findUniqueOrThrow({ where: { id: session.id } }),
      refreshToken,
      ttlSeconds,
    };
  }

  /**
   * The session whose **previous** token this was — a replay.
   *
   * Finding one is the signal that a token outlived its rotation: either
   * the legitimate client is presenting a token an attacker already
   * spent, or the attacker is presenting one the client spent. Neither
   * is recoverable by asking, so the family is revoked (M6.3, API §1.5).
   *
   * Deliberately not filtered on `revoked_at`: a replay against an
   * already-revoked session is still worth recognising as a replay, and
   * answering it as an ordinary unknown token would hide a second
   * attempt from the trail.
   */
  findByPreviousToken(refreshToken: string): Promise<Session | null> {
    return this.prisma.db.session.findUnique({
      where: { previousTokenHash: this.secrets.hash(refreshToken) },
    });
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.db.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Every live session for a user — the single-session policy, and M6.5's reset.
   *
   * `client` lets a caller revoke inside its own transaction: a password
   * reset revokes in the transaction that writes the new hash, so the two
   * commit together and a failed reset ends nobody's session.
   */
  async revokeAllFor(
    userId: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<number> {
    const result = await client.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  /**
   * Whether an access token's session may still act — PRE-01, owner
   * decisions I4 and O-13 (FINAL).
   *
   * One indexed read, answered by PostgreSQL every time. I2 makes the
   * database the source of truth for security-critical session state,
   * and no cache sits in front of this read: any cache would need the
   * staleness bound C-12 sets, and C-12 is still open. Without a cache
   * there is nothing for it to bound, and "immediate" in O-13 holds in
   * the sense the owner gave it — a revocation, once committed, refuses
   * the next request that reads it.
   *
   * The session must be:
   *
   *  - **the token's own** — `user_id` is matched as well as `id`, so a
   *    token whose `sid` and `sub` disagree is refused rather than
   *    trusted for whichever half happens to be live;
   *  - **not revoked** — logout, "sign out of this session", sign out
   *    everywhere, a password change, a 2FA change, refresh-token reuse,
   *    single-session sign-in and an administrator's suspension all end
   *    a session by setting `revoked_at`, so this one clause makes every
   *    one of them reach requests already in flight;
   *  - **not expired** — `expires_at` is the refresh family's deadline,
   *    and an access token minted near it must not outlive it;
   *
   * and the account must be `ACTIVE` and not soft-deleted. That is the
   * line `RefreshService` already draws for the refresh; drawing it here
   * as well is what stops a suspended user's last access token working
   * for up to `JWT_ACCESS_TTL` after the suspension.
   *
   * The relation filter states `deletedAt: null` itself: the soft-delete
   * extension rewrites only the top-level `where` (see `soft-delete.ts`).
   *
   * Both ids are checked for shape first. The token is signed, so a
   * malformed id means a token this service did not mint; Postgres would
   * answer it with a cast error, which must be a 401, not a 500.
   */
  async isActive(sessionId: string, userId: string): Promise<boolean> {
    if (!UUID.test(sessionId) || !UUID.test(userId)) return false;

    const session = await this.prisma.db.session.findFirst({
      where: {
        id: sessionId,
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: { status: UserStatus.ACTIVE, deletedAt: null },
      },
      select: { id: true },
    });

    return session !== null;
  }

  /**
   * Whether `sessionId` names a session row of `userId`, in any state.
   *
   * The check `@AllowEndedSession()` routes still get (PRE-01). They waive
   * *liveness* — a revoked or expired session, or an account no longer
   * `ACTIVE`, may still log out — but not *identity*: the token's `sid`
   * must name a session that belongs to its `sub`. Without this, a signed
   * token whose two claims disagreed would let logout revoke a session of
   * another account, and a malformed `sid` would reach the revocation as
   * a uuid cast. Same shape check, same 401, as `isActive`.
   */
  async belongsTo(sessionId: string, userId: string): Promise<boolean> {
    if (!UUID.test(sessionId) || !UUID.test(userId)) return false;

    const session = await this.prisma.db.session.findFirst({
      where: { id: sessionId, userId },
      select: { id: true },
    });

    return session !== null;
  }

  async touch(sessionId: string): Promise<void> {
    await this.prisma.db.session.updateMany({
      where: { id: sessionId },
      data: { lastActiveAt: new Date() },
    });
  }
}
