import { timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { PolicyService } from '../../../config';
import { EnvelopeService, sessionRefreshSuccessorAad } from '../../../shared/crypto';
import { PrismaService } from '../../../shared/database';
import type { Prisma, Session } from '../../../generated/prisma/client';
import { UserStatus } from '../../../generated/prisma/enums';

import { SecretService } from './secret.service';

/** Any RFC 4122 textual uuid — the shape of `sessions.id` and `users.id`. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * How long after a rotation the token it retired may still be answered
 * with the successor it issued, instead of being treated as reuse
 * (ADR-045, owner decision 2026-11-21).
 *
 * Thirty seconds covers the three ways a legitimate client re-presents a
 * just-rotated token — a response lost in flight and retried, two tabs
 * sharing one cookie, and concurrent refreshes from one client — all of
 * which happen within a request timeout or two of the rotation. It is
 * short enough that a stolen, retired token replayed later still lands
 * on ADR-026's reuse path and revokes the family.
 *
 * A fixed constant, deliberately not a `PolicyService` value or an
 * environment variable: the session lifetimes there are layered so an
 * administrator can tune them, and this one is a security bound the ADR
 * fixes. Widening it widens the window in which a retired token is
 * silently honoured, so changing it is an ADR amendment, not a setting.
 */
export const REFRESH_GRACE_WINDOW_SECONDS = 30;

/**
 * Bounds on `SessionService.refresh`'s transaction (ADR-045 §Concurrency).
 *
 * - `REFRESH_TX_MAX_WAIT_MS` — Prisma's wait to obtain a pooled connection.
 * - `REFRESH_TX_TIMEOUT_MS` — Prisma's limit on the whole transaction.
 * - `REFRESH_LOCK_TIMEOUT_MS` — PostgreSQL's `lock_timeout`, set locally
 *   in the transaction. This is the one that bounds the row-lock wait:
 *   Prisma's timeout does **not** interrupt a statement that is blocked on
 *   a lock (observed: a refresh behind a held lock did not return within
 *   20 s), so without it a stuck holder would hang every refresh of that
 *   session. Shorter than the transaction timeout so the lock wait fails
 *   first, as PostgreSQL error 55P03.
 *
 * Exceeding any of them is a retryable 500, never a refusal: nothing was
 * decided and nothing rotated.
 */
export const REFRESH_TX_MAX_WAIT_MS = 2_000;
export const REFRESH_TX_TIMEOUT_MS = 5_000;
export const REFRESH_LOCK_TIMEOUT_MS = 4_000;

/**
 * What `successor_token_ct` decrypts to.
 *
 * The token is bound to the row it was written for and to the token it
 * replaced — inside the authenticated plaintext, and (since the review of
 * 2026-11-21) also as GCM additional data: `sessionRefreshSuccessorAad`
 * names the purpose and `sessions.id`, so a ciphertext copied onto another
 * row, or into another `EnvelopeService` column, fails authentication
 * before its plaintext is even parsed.
 */
export interface SuccessorEnvelope {
  readonly v: 1;
  /** `sessions.id` the successor belongs to. */
  readonly sid: string;
  /** The hash the rotation retired — `previous_token_hash` at write time. */
  readonly prev: string;
  /** The successor refresh token itself. */
  readonly token: string;
}

/**
 * The one `sessions` row `SessionService.refresh` locks, with every
 * time-dependent fact already decided by **the database clock** in the
 * statement that took the lock (ADR-045 §Clock). Nothing in this shape is
 * a timestamp the application compares: app-server skew cannot move the
 * window.
 */
export interface LockedSessionRow {
  readonly id: string;
  readonly userId: string;
  readonly refreshTokenHash: string;
  readonly previousTokenHash: string | null;
  readonly rememberMe: boolean;
  readonly successorTokenCt: Uint8Array | null;
  readonly revoked: boolean;
  /** `expires_at > clock_timestamp()`. */
  readonly live: boolean;
  /** `rotated_at > clock_timestamp() - REFRESH_GRACE_WINDOW_SECONDS`. */
  readonly inGraceWindow: boolean;
  /** Whole seconds left before `expires_at`, at least 1 — the grace cookie's `Max-Age`. */
  readonly remainingSeconds: number;
  /** `users.status = 'active'` and not soft-deleted. */
  readonly accountActive: boolean;
}

/**
 * What the locked row says to do with the presented token. Pure: decided
 * by `decideRefresh` from the row and the presented hash alone.
 *
 * - `rotate` — the current token, on a live session of an active account.
 * - `grace` — the previous token, inside the window, with a successor that
 *   opens, is bound to this row and this retired hash, and **is still the
 *   row's current token**: re-deliver it.
 * - `reuse` — the previous token, failing any grace check: ADR-026.
 * - `deactivate` — would have succeeded, but the account is no longer
 *   active: end the session and refuse (M8.2, ADR-035 §6), not audited as
 *   reuse.
 * - `refuse` — the current token of a revoked or expired session.
 */
export type RefreshDecision =
  | { readonly kind: 'rotate' }
  | { readonly kind: 'grace'; readonly refreshToken: string }
  | { readonly kind: 'reuse' }
  | { readonly kind: 'deactivate' }
  | { readonly kind: 'refuse' };

/**
 * What `SessionService.refresh` committed. Every refusal is `refused`, so
 * the caller cannot tell them apart either — one 401 for all of them.
 */
export type RefreshOutcome =
  | {
      readonly kind: 'rotated' | 'grace';
      readonly sessionId: string;
      readonly userId: string;
      /** The current refresh token: new on `rotated`, re-delivered on `grace`. */
      readonly refreshToken: string;
      /** The cookie's `Max-Age`: a fresh TTL on rotation, what is left on grace. */
      readonly ttlSeconds: number;
    }
  | {
      readonly kind: 'reuse';
      readonly sessionId: string;
      readonly userId: string;
      /** This transaction revoked the session — the one that reports the event. */
      readonly revokedNow: boolean;
    }
  | { readonly kind: 'refused' };

/** The raw row `refresh`'s locking query returns. */
interface LockedRowRecord {
  id: string;
  userId: string;
  refreshTokenHash: string;
  previousTokenHash: string | null;
  rememberMe: boolean;
  successorTokenCt: Uint8Array | null;
  revoked: boolean;
  live: boolean;
  inGraceWindow: boolean;
  remainingSeconds: number;
  accountActive: boolean;
}

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
    private readonly envelope: EnvelopeService,
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
   * The whole refresh decision, in one transaction over one locked row
   * (ADR-045 §Concurrency).
   *
   * ## Why a lock, and not the compare-and-set this replaced
   *
   * The previous shape read the row, then rotated with a conditional
   * `UPDATE`, and answered a retired token from a *separate* read. A grace
   * retry could therefore read T1 as current while a concurrent T1 → T2
   * rotation committed, and hand the client T1 after it had already been
   * superseded. Here the row is locked (`SELECT … FOR UPDATE`) by the
   * statement that finds it — by `refresh_token_hash` **or**
   * `previous_token_hash` — and every check and every write happens while
   * the lock is held, so:
   *
   *  - a re-delivered successor is the row's current token at the moment
   *    it is chosen, and stays current until this transaction commits;
   *  - two requests presenting one predecessor serialize on the row: the
   *    first rotates, every later one finds the token one generation back
   *    and is answered with that one successor — never a second chain;
   *  - a reuse revokes in the same transaction that decided it, once.
   *
   * Under READ COMMITTED a waiter that wakes after another transaction
   * rotated the row re-evaluates the `WHERE` against the new version
   * (PostgreSQL's EvalPlanQual), and the `OR` still matches it as the
   * previous token — so the loser of a race lands on the grace branch with
   * the winner's row, not on "unknown".
   *
   * ## Lock first, then read (review finding 1)
   *
   * The locking statement selects **only the id**. Every fact the decision
   * uses — the hashes, the ciphertext, `live`, `inGraceWindow`, the
   * remaining TTL and the account status — is read by a **second**
   * statement, after the lock is held. A projection in the locking
   * statement itself is computed *before* the row-lock wait, and
   * EvalPlanQual recomputes it only when the holder modified the row: a
   * holder that released without writing (a grace answer, a refusal, a
   * rollback, any `SELECT … FOR UPDATE`) would leave a window or expiry
   * judged at the start of the wait. The second statement also re-reads
   * `users`, which `FOR UPDATE OF s` neither locks nor refreshes.
   *
   * ## Why `FOR UPDATE` and not `FOR NO KEY UPDATE`
   *
   * A rotation changes `refresh_token_hash`, which carries a unique index,
   * and PostgreSQL takes the `FOR UPDATE` row lock for such an `UPDATE`
   * anyway. Taking the weaker lock first would make every rotation a lock
   * *upgrade* inside the transaction, which is the shape that deadlocks.
   *
   * ## Why this cannot deadlock with the other session writers
   *
   * The transaction takes exactly one row lock (`LIMIT 1`, `FOR UPDATE OF
   * s` — the joined `users` row is read, not locked) and then writes only
   * that row; it never waits on a second lock while holding the first.
   * `revokeAllFor`, the account-security and administration revocations
   * and the re-encryption compare-and-set each lock session rows and may
   * wait on this one (the successor sweep skips it instead: `SKIP LOCKED`),
   * but this one never waits on them, so no
   * cycle can form through it. The audit row is written after commit, on
   * the dispatcher's own connection.
   *
   * ## Time
   *
   * Every comparison is made by PostgreSQL against `clock_timestamp()` —
   * the wall clock at evaluation, not `now()`, which inside a transaction
   * is its *start* and would let a request that waited on the lock judge
   * the window by when it began waiting. `rotated_at` is written from the
   * same clock, truncated to the column's millisecond precision (rounding
   * could stamp up to half a millisecond in the future and widen the
   * window by that much). No application timestamp enters the decision.
   */
  async refresh(presentedToken: string): Promise<RefreshOutcome> {
    const presentedHash = this.secrets.hash(presentedToken);
    // Read before the transaction: the lock is held for as little as
    // possible, and the policy cache may go to the database.
    const policy = await this.policy.current();

    return this.prisma.$transaction(
      async (tx) => {
        // 0. Bound the lock wait; `true` makes it local to this transaction.
        await tx.$queryRaw`SELECT set_config('lock_timeout', ${`${String(REFRESH_LOCK_TIMEOUT_MS)}ms`}, true)`;

        // 1. Take the lock. Nothing time-dependent is read here (finding 1).
        const locked = await tx.$queryRaw<{ id: string }[]>`
        SELECT s.id::text AS "id"
          FROM sessions s
         WHERE s.refresh_token_hash = ${presentedHash}
            OR s.previous_token_hash = ${presentedHash}
         LIMIT 1
           FOR UPDATE OF s`;
        const lockedId = locked[0]?.id;
        if (lockedId === undefined) return { kind: 'refused' } as const;

        // 2. With the lock held: every fact the decision uses, on the
        //    database clock as it reads *now*, and the account as it is now.
        const records = await tx.$queryRaw<LockedRowRecord[]>`
        SELECT s.id::text                                  AS "id",
               s.user_id::text                             AS "userId",
               s.refresh_token_hash                        AS "refreshTokenHash",
               s.previous_token_hash                       AS "previousTokenHash",
               s.remember_me                               AS "rememberMe",
               s.successor_token_ct                        AS "successorTokenCt",
               (s.revoked_at IS NOT NULL)                  AS "revoked",
               (s.expires_at > clock_timestamp())          AS "live",
               (s.rotated_at IS NOT NULL
                 AND s.rotated_at > clock_timestamp()
                       - ${REFRESH_GRACE_WINDOW_SECONDS}::int * interval '1 second')
                                                           AS "inGraceWindow",
               GREATEST(1, CEIL(EXTRACT(EPOCH FROM (s.expires_at - clock_timestamp()))))::int
                                                           AS "remainingSeconds",
               (u.status = 'active' AND u.deleted_at IS NULL) AS "accountActive"
          FROM sessions s
          JOIN users u ON u.id = s.user_id
         WHERE s.id = ${lockedId}::uuid`;

        const record = records[0];
        if (record === undefined) return { kind: 'refused' } as const;
        const row = toLockedRow(record);

        const decision = decideRefresh(row, presentedHash, this.secrets, (ciphertext) =>
          openSuccessor(this.envelope, ciphertext, row.id),
        );

        switch (decision.kind) {
          case 'refuse':
            return { kind: 'refused' } as const;

          case 'deactivate':
            await this.revokeLocked(tx, row.id);
            return { kind: 'refused' } as const;

          case 'reuse': {
            // Reported (logged and audited) only by the transaction that
            // actually revoked: N concurrent replays of one retired token are
            // one reuse event, not N (review finding 3). The others get the
            // same 401 and write nothing.
            const revokedNow = await this.revokeLocked(tx, row.id);
            return { kind: 'reuse', sessionId: row.id, userId: row.userId, revokedNow } as const;
          }

          case 'grace':
            // No write: not rotated again, `expires_at` not slid. The lock is
            // what makes the read above authoritative until commit.
            return {
              kind: 'grace',
              sessionId: row.id,
              userId: row.userId,
              refreshToken: decision.refreshToken,
              ttlSeconds: row.remainingSeconds,
            } as const;

          case 'rotate': {
            const ttlSeconds = row.rememberMe
              ? policy.refreshTtlRememberSeconds
              : policy.refreshTtlDefaultSeconds;
            const refreshToken = this.secrets.randomToken();
            const successor: SuccessorEnvelope = {
              v: 1,
              sid: row.id,
              prev: presentedHash,
              token: refreshToken,
            };
            const ciphertext = sealSuccessor(this.envelope, successor);

            // The predicate restates what the lock already guarantees; a
            // count other than 1 would mean the lock did not hold, and the
            // transaction is rolled back rather than issuing anything.
            const updated = await tx.$executeRaw`
            UPDATE sessions
               SET refresh_token_hash  = ${this.secrets.hash(refreshToken)},
                   previous_token_hash = ${presentedHash},
                   rotated_at          = date_trunc('milliseconds', clock_timestamp()),
                   successor_token_ct  = ${ciphertext},
                   expires_at          = clock_timestamp() + ${ttlSeconds}::int * interval '1 second',
                   last_active_at      = clock_timestamp()
             WHERE id = ${row.id}::uuid
               AND refresh_token_hash = ${presentedHash}
               AND revoked_at IS NULL`;
            if (updated !== 1) {
              throw new Error('Refresh rotation matched no row while holding its lock');
            }

            return {
              kind: 'rotated',
              sessionId: row.id,
              userId: row.userId,
              refreshToken,
              ttlSeconds,
            } as const;
          }
        }
      },
      // Explicit, so the failure mode is a stated one (review finding 2): a
      // refresh that cannot get a connection, or whose lock wait outlives
      // the timeout, fails with a retryable 500 and rolls back — it is not
      // a refusal, and must not be answered with the 401 that signs a
      // client out.
      { maxWait: REFRESH_TX_MAX_WAIT_MS, timeout: REFRESH_TX_TIMEOUT_MS },
    );
  }

  /**
   * Revokes the row this transaction holds locked, on the same clock as
   * the decision. `sessions_clear_revoked_successor` would clear the
   * successor anyway; stating it keeps the intent visible. `true` only
   * when **this** statement revoked it — `false` when it was already
   * revoked.
   */
  private async revokeLocked(tx: Prisma.TransactionClient, sessionId: string): Promise<boolean> {
    const revoked = await tx.$executeRaw`
      UPDATE sessions
         SET revoked_at = clock_timestamp(), rotated_at = NULL, successor_token_ct = NULL
       WHERE id = ${sessionId}::uuid
         AND revoked_at IS NULL`;
    return revoked === 1;
  }

  /**
   * The session whose **previous** token this was, in any state, or `null`.
   *
   * A plain read, outside any lock — **not** part of the refresh decision.
   * `refresh()` finds the row by `refresh_token_hash` or
   * `previous_token_hash` under `FOR UPDATE` and decides grace, reuse or
   * refusal itself (ADR-045); nothing on the request path calls this. It
   * is kept as a read helper (the e2e specs use it to assert which
   * generation a token belongs to). Not filtered on `revoked_at`.
   */
  findByPreviousToken(refreshToken: string): Promise<Session | null> {
    return this.prisma.db.session.findUnique({
      where: { previousTokenHash: this.secrets.hash(refreshToken) },
    });
  }

  /**
   * Ends a session, and drops the successor it may hold (ADR-045).
   *
   * A revoked row is never rotated again, so a successor left on it would
   * be a live-looking token at rest for the rest of the row's retention.
   * The `sessions_clear_revoked_successor` trigger enforces the same for
   * every other writer; clearing here keeps the intent visible.
   */
  async revoke(sessionId: string): Promise<void> {
    await this.prisma.db.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date(), rotatedAt: null, successorTokenCt: null },
    });
  }

  /**
   * Drops every successor whose grace window has closed (ADR-045, RA-045.1).
   *
   * Past the window a successor is never honoured again — `refresh`
   * refuses it on `rotated_at` alone, by the database clock, whether or
   * not this has run — but until the next rotation or revocation it would
   * stay at rest as an idle session's live token. This nulls it.
   *
   * The predicate is the exact complement of the grace check, on the same
   * clock: `rotated_at <= clock_timestamp() - 30 s` here, `>` there. So no
   * row is ever both in its window and eligible for clearing, and the
   * application's clock (the job's `now`) is deliberately not used.
   *
   * **It never waits on a lock** (review L1/L2). The rows are claimed with
   * `FOR UPDATE SKIP LOCKED`, in `id` order, and only the claimed rows are
   * updated. A row a refresh, a revocation, another sweeper or anything
   * else holds locked is skipped and picked up by the next run — so the
   * retention bound gains at most one sweep interval per skip, and in
   * exchange this statement cannot block bootstrap or shutdown, cannot
   * deadlock with another sweeper or with `revokeAllFor`, and never holds a
   * row a refresh is waiting for. The lapsed predicate is restated in the
   * `UPDATE` so a row is cleared only if it is still lapsed when written.
   * `rotated_at` is kept: it is not a secret, and without the ciphertext it
   * cannot answer a grace check. Returns the rows cleared.
   */
  async clearLapsedSuccessors(): Promise<number> {
    return this.prisma.$executeRaw`
      WITH lapsed AS (
        SELECT id
          FROM sessions
         WHERE successor_token_ct IS NOT NULL
           AND rotated_at <= clock_timestamp()
                 - ${REFRESH_GRACE_WINDOW_SECONDS}::int * interval '1 second'
         ORDER BY id
           FOR UPDATE SKIP LOCKED
      )
      UPDATE sessions s
         SET successor_token_ct = NULL
        FROM lapsed
       WHERE s.id = lapsed.id
         AND s.successor_token_ct IS NOT NULL
         AND s.rotated_at <= clock_timestamp()
               - ${REFRESH_GRACE_WINDOW_SECONDS}::int * interval '1 second'`;
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
      data: { revokedAt: new Date(), rotatedAt: null, successorTokenCt: null },
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
   * When `roleCode` is given (the token's `role` claim), the account must
   * also **still hold that role** (audit F3, issue #23, ADR-046). Role and
   * permission claims are fixed when the token is minted (API §1.11); a
   * role change after that would otherwise leave the old role's
   * permissions working for up to `JWT_ACCESS_TTL`. A mismatch is the same
   * 401 as any dead session, and the client's next move is the same — one
   * refresh, which mints a token from the current role (`RefreshService`
   * re-reads it), so the change applies at the next issue *and* the stale
   * token stops working now. Same row, same read: no extra query.
   *
   * Both ids are checked for shape first. The token is signed, so a
   * malformed id means a token this service did not mint; Postgres would
   * answer it with a cast error, which must be a 401, not a 500.
   */
  async isActive(sessionId: string, userId: string, roleCode?: string): Promise<boolean> {
    if (!UUID.test(sessionId) || !UUID.test(userId)) return false;

    const session = await this.prisma.db.session.findFirst({
      where: {
        id: sessionId,
        userId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: {
          status: UserStatus.ACTIVE,
          deletedAt: null,
          ...(roleCode === undefined ? {} : { role: { is: { code: roleCode } } }),
        },
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

/**
 * Constant-time equality of two hex SHA-256 digests. A length mismatch is
 * `false` rather than a throw — `timingSafeEqual` would otherwise turn a
 * malformed envelope into an exception, which here must mean "not a retry".
 */
function sameDigest(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

/**
 * Seals a successor for `sessions.successor_token_ct`, bound by AAD to its
 * purpose and to `successor.sid` (ADR-045 §Encryption).
 */
export function sealSuccessor(
  envelope: EnvelopeService,
  successor: SuccessorEnvelope,
): Uint8Array<ArrayBuffer> {
  return envelope.encrypt(JSON.stringify(successor), sessionRefreshSuccessorAad(successor.sid));
}

/**
 * Decrypts and shape-checks a successor envelope, or `null`.
 *
 * The AAD names `sessionId`; an envelope sealed for another row, or for
 * another purpose, fails GCM authentication here. Every failure is the
 * same `null` and none is logged with its detail: the caller treats it as
 * reuse, and neither the ciphertext nor the token inside it may reach a
 * log line.
 */
export function openSuccessor(
  envelope: EnvelopeService,
  ciphertext: Uint8Array,
  sessionId: string,
): SuccessorEnvelope | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(envelope.decrypt(ciphertext, sessionRefreshSuccessorAad(sessionId)));
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as Record<string, unknown>;
  if (
    candidate['v'] !== 1 ||
    typeof candidate['sid'] !== 'string' ||
    typeof candidate['prev'] !== 'string' ||
    typeof candidate['token'] !== 'string'
  ) {
    return null;
  }

  return {
    v: 1,
    sid: candidate['sid'],
    prev: candidate['prev'],
    token: candidate['token'],
  };
}

/**
 * What to do with a presented refresh token, given the row it locked
 * (ADR-045). Pure, so every branch is unit-testable without a database;
 * `SessionService.refresh` supplies the row from inside its lock.
 *
 * The previous token is a **grace** retry only when every one of these
 * holds — anything else is `reuse`, including a decrypt failure, which
 * fails closed (a ciphertext nobody can open is not evidence of a retry):
 *
 *  1. the session is not revoked and not expired;
 *  2. it was rotated less than `REFRESH_GRACE_WINDOW_SECONDS` ago, by the
 *     database clock (`inGraceWindow`);
 *  3. the successor ciphertext opens — under a key in the ring, with this
 *     session's AAD — and parses;
 *  4. the plaintext names this session and the hash just presented;
 *  5. the successor still hashes to the row's **current**
 *     `refresh_token_hash`. The row is locked, so "current" cannot change
 *     before the answer commits: a successor that has itself rotated is
 *     never re-delivered.
 */
export function decideRefresh(
  row: LockedSessionRow,
  presentedHash: string,
  secrets: SecretService,
  open: (ciphertext: Uint8Array) => SuccessorEnvelope | null,
): RefreshDecision {
  if (sameDigest(row.refreshTokenHash, presentedHash)) {
    if (row.revoked || !row.live) return { kind: 'refuse' };
    if (!row.accountActive) return { kind: 'deactivate' };
    return { kind: 'rotate' };
  }

  // The lock query matched on one of the two hashes; this is the other.
  if (row.previousTokenHash === null || !sameDigest(row.previousTokenHash, presentedHash)) {
    return { kind: 'refuse' };
  }

  const successor = graceSuccessor(row, presentedHash, secrets, open);
  if (successor === null) return { kind: 'reuse' };
  if (!row.accountActive) return { kind: 'deactivate' };
  return { kind: 'grace', refreshToken: successor };
}

/** The successor to re-deliver, or `null` when any grace check fails. */
function graceSuccessor(
  row: LockedSessionRow,
  presentedHash: string,
  secrets: SecretService,
  open: (ciphertext: Uint8Array) => SuccessorEnvelope | null,
): string | null {
  if (row.revoked || !row.live || !row.inGraceWindow) return null;
  if (row.successorTokenCt === null) return null;

  const envelope = open(row.successorTokenCt);
  if (envelope === null) return null;
  if (envelope.sid !== row.id) return null;
  if (!sameDigest(envelope.prev, presentedHash)) return null;
  if (!secrets.matches(envelope.token, row.refreshTokenHash)) return null;

  return envelope.token;
}

function toLockedRow(record: LockedRowRecord): LockedSessionRow {
  return {
    id: record.id,
    userId: record.userId,
    refreshTokenHash: record.refreshTokenHash,
    previousTokenHash: record.previousTokenHash,
    rememberMe: record.rememberMe,
    successorTokenCt:
      record.successorTokenCt === null ? null : Uint8Array.from(record.successorTokenCt),
    revoked: record.revoked,
    live: record.live,
    inGraceWindow: record.inGraceWindow,
    remainingSeconds: Number(record.remainingSeconds),
    accountActive: record.accountActive,
  };
}
