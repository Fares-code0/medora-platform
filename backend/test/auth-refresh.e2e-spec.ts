import { Logger } from '@nestjs/common';
import { CookieAccessInfo, CookieJar } from 'cookiejar';
import { Client } from 'pg';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigService, PolicyService } from '../src/config';
import { SecretService } from '../src/modules/auth/services/secret.service';
import { SuccessorRetentionService } from '../src/modules/auth/services/successor-retention.service';
import {
  REFRESH_GRACE_WINDOW_SECONDS,
  REFRESH_TX_TIMEOUT_MS,
  SessionService,
} from '../src/modules/auth/services/session.service';
import { EnvelopeService } from '../src/shared/crypto';
import { PrismaService } from '../src/shared/database';
import { JobRegistry } from '../src/shared/jobs';

import {
  type AuthHarness,
  createAuthHarness,
  dataOf,
  endGraceWindow,
  errorBody,
  markVerified,
  registrationBody,
  rotatedSecondsAgo,
  testEmail,
} from './support/auth-app';

/**
 * `POST /auth/refresh` and `POST /auth/logout` (RM M6.3, API §1.5–1.6).
 *
 * The roadmap's verification: "reuse of a rotated token → 401 and the
 * whole family revoked", and "cookie `Path` matches the M0.6-1 ADR and is
 * actually sent by the browser". The second one cannot be checked by
 * asserting the `Set-Cookie` header alone — that only proves what was
 * *offered*. Supertest's agent applies the browser's own matching rules,
 * so a cookie it re-sends to `/api/v1/auth/refresh` is a cookie a browser
 * would re-send.
 */
let harness: AuthHarness;
const REGISTER = '/api/v1/auth/register';
const LOGIN = '/api/v1/auth/login';
const REFRESH = '/api/v1/auth/refresh';
const LOGOUT = '/api/v1/auth/logout';
const PASSWORD = 'Medora123!';

interface SessionPayload {
  user: { id: string; name: string; email: string; role: string; permissions: string[] };
  accessToken: string;
  expiresIn: number;
}

async function seedAccount(local: string): Promise<string> {
  const email = testEmail(local);
  await request(harness.server).post(REGISTER).send(registrationBody({ email }));
  await markVerified(harness.prisma, email);
  return email;
}

function refreshTokenOf(response: { headers: Record<string, unknown> }): string {
  const raw: unknown = response.headers['set-cookie'];
  const cookies = Array.isArray(raw) ? raw : [raw];
  const cookie = cookies.find(
    (value): value is string => typeof value === 'string' && value.startsWith('medora_rt='),
  );
  return /medora_rt=([^;]*)/.exec(cookie ?? '')?.[1] ?? '';
}

/** Signs in and returns the raw refresh token plus the access token. */
async function signIn(email: string): Promise<{ refreshToken: string; accessToken: string }> {
  const response = await request(harness.server)
    .post(LOGIN)
    .send({ email, password: PASSWORD, rememberMe: false });

  return {
    refreshToken: refreshTokenOf(response),
    accessToken: dataOf<SessionPayload>(response).accessToken,
  };
}

/** `DATABASE_URL` without Prisma's `?schema=` query, for a plain `pg` client. */
function plainUrl(): string {
  return (process.env['DATABASE_URL'] ?? '').replace(/\?.*$/, '');
}

function withCookie(token: string): string {
  return `medora_rt=${token}`;
}

/**
 * The one body every refresh refusal carries — unknown, expired, revoked,
 * replayed, or a failed grace check (ADR-013, ADR-045). Any difference
 * between them would let a caller probe the window.
 */
const REFUSAL = { code: 'unauthorized', message: 'Session expired' };

/** Audit rows of `eventType` naming one session. */
function auditCount(eventType: string, sessionId: string): Promise<number> {
  return harness.prisma.auditEvent.count({
    where: { eventType, target: `session:${sessionId}` },
  });
}

/**
 * Ages a session out.
 *
 * `started_at` moves too, because DB §9's `sessions_expires_after_start`
 * CHECK refuses a row that expires before it began — a constraint worth
 * respecting rather than working around, since it is what stops a bug
 * from writing an already-dead session.
 */
async function expireSession(email: string): Promise<void> {
  const past = Date.now() - 60_000;
  await harness.prisma.session.updateMany({
    where: { user: { email } },
    data: { startedAt: new Date(past), expiresAt: new Date(past + 1_000) },
  });
}

beforeAll(async () => {
  harness = await createAuthHarness('refresh');
});

afterAll(async () => {
  await harness.reset();
  await harness.close();
});

beforeEach(async () => {
  await harness.reset();
});

describe('refresh', () => {
  it('returns a new access token and the session user', async () => {
    const email = await seedAccount('amelia');
    const { refreshToken } = await signIn(email);

    const response = await request(harness.server).post(REFRESH).set('Cookie', withCookie(refreshToken));

    expect(response.status).toBe(200);
    const payload = dataOf<SessionPayload>(response);
    // The frontend refreshes before it has a session, so this response is
    // where the shell learns who it is rendering for.
    expect(payload.user.email).toBe(email);
    expect(payload.user.role).toBe('doctor');
    expect(payload.user.permissions).toContain('patients.view');
    expect(payload.expiresIn).toBe(900);
  });

  it('rotates the cookie — the old token stops working', async () => {
    const email = await seedAccount('amelia');
    const { refreshToken: first } = await signIn(email);

    const rotated = await request(harness.server).post(REFRESH).set('Cookie', withCookie(first));
    const second = refreshTokenOf(rotated);

    expect(second).not.toBe(first);
    expect(second.length).toBeGreaterThan(20);

    // Inside ADR-045's 30-second window the old token would be answered
    // with `second` (see "the grace window" below); past it, it is dead.
    await endGraceWindow(harness.prisma, email);

    const replay = await request(harness.server).post(REFRESH).set('Cookie', withCookie(first));
    expect(replay.status).toBe(401);
  });

  it('keeps one session row across rotations rather than growing one per refresh', async () => {
    const email = await seedAccount('amelia');
    let token = (await signIn(email)).refreshToken;

    for (let round = 0; round < 3; round += 1) {
      const response = await request(harness.server).post(REFRESH).set('Cookie', withCookie(token));
      expect(response.status).toBe(200);
      token = refreshTokenOf(response);
    }

    // The row is the family. A row per rotation would be ~2,880 rows per
    // remembered user per month, for a table nothing prunes yet (ADR-007).
    expect(await harness.prisma.session.count({ where: { user: { email } } })).toBe(1);
  });

  it('slides the expiry forward', async () => {
    const email = await seedAccount('amelia');
    const { refreshToken } = await signIn(email);
    const before = await harness.prisma.session.findFirstOrThrow({ where: { user: { email } } });

    await request(harness.server).post(REFRESH).set('Cookie', withCookie(refreshToken));
    const after = await harness.prisma.session.findFirstOrThrow({ where: { user: { email } } });

    // API §1.5 — an active user is not signed out mid-shift, while an
    // abandoned session still ages out.
    expect(after.expiresAt.getTime()).toBeGreaterThan(before.expiresAt.getTime());
  });

  it('is refused for a session that has expired', async () => {
    const email = await seedAccount('amelia');
    const { refreshToken } = await signIn(email);

    await expireSession(email);

    const response = await request(harness.server).post(REFRESH).set('Cookie', withCookie(refreshToken));
    expect(response.status).toBe(401);
  });

  it('is refused with no cookie at all', async () => {
    expect((await request(harness.server).post(REFRESH)).status).toBe(401);
  });

  it('is refused for a token that was never issued', async () => {
    const response = await request(harness.server)
      .post(REFRESH)
      .set('Cookie', withCookie('a-token-nobody-ever-issued'));

    expect(response.status).toBe(401);
    expect(errorBody(response).code).toBe('unauthorized');
  });

  it('is refused once the account is deactivated', async () => {
    const email = await seedAccount('amelia');
    const { refreshToken } = await signIn(email);

    // Soft delete is how M8.2 deactivates an account. A live session must
    // not outlive it.
    await harness.prisma.user.update({ where: { email }, data: { deletedAt: new Date() } });

    const response = await request(harness.server).post(REFRESH).set('Cookie', withCookie(refreshToken));
    expect(response.status).toBe(401);
  });

  describe('reuse detection', () => {
    it('revokes the session when a rotated token comes back', async () => {
      const email = await seedAccount('amelia');
      const { refreshToken: stolen } = await signIn(email);

      // The attacker refreshes first, taking the new token.
      const attacker = await request(harness.server).post(REFRESH).set('Cookie', withCookie(stolen));
      expect(attacker.status).toBe(200);
      const attackerToken = refreshTokenOf(attacker);

      // The real client then presents the one it still holds — later than
      // ADR-045's grace window, which is the only case reuse detection can
      // still tell apart from a retry.
      await endGraceWindow(harness.prisma, email);
      const victim = await request(harness.server).post(REFRESH).set('Cookie', withCookie(stolen));
      expect(victim.status).toBe(401);

      // By now two parties hold tokens for one session and there is no way
      // to tell which is the user, so the session ends for both.
      const session = await harness.prisma.session.findFirstOrThrow({ where: { user: { email } } });
      expect(session.revokedAt).not.toBeNull();

      const afterRevocation = await request(harness.server)
        .post(REFRESH)
        .set('Cookie', withCookie(attackerToken));
      expect(afterRevocation.status).toBe(401);
    });

    it("leaves the user's other sessions alone", async () => {
      const email = await seedAccount('amelia');
      const compromised = (await signIn(email)).refreshToken;
      const otherDevice = (await signIn(email)).refreshToken;

      await request(harness.server).post(REFRESH).set('Cookie', withCookie(compromised));
      await endGraceWindow(harness.prisma, email);
      const replay = await request(harness.server)
        .post(REFRESH)
        .set('Cookie', withCookie(compromised));
      expect(replay.status).toBe(401);

      // The row is the family: a replay on the phone does not sign the
      // user out of the workstation.
      const stillWorks = await request(harness.server)
        .post(REFRESH)
        .set('Cookie', withCookie(otherDevice));
      expect(stillWorks.status).toBe(200);
    });

    it('does not fire for a token that merely expired', async () => {
      const email = await seedAccount('amelia');
      const { refreshToken } = await signIn(email);
      await expireSession(email);

      await request(harness.server).post(REFRESH).set('Cookie', withCookie(refreshToken));

      // An expired session is not a compromised one; revoking on expiry
      // would make every returning user look like an incident.
      const session = await harness.prisma.session.findFirstOrThrow({ where: { user: { email } } });
      expect(session.revokedAt).toBeNull();
    });
  });

  /**
   * ADR-045 §Concurrency — the refresh decision is one transaction over
   * one row locked `FOR UPDATE`.
   *
   * Every interleaving here is **forced**, not hoped for. A separate
   * PostgreSQL connection takes the session's row lock first, the
   * requests under test are started one at a time, and each is let go
   * only once PostgreSQL itself reports it waiting on that lock
   * (`pg_stat_activity`, `pg_blocking_pids`). PostgreSQL grants a
   * contended row lock to its waiters in arrival order, so releasing the
   * holder runs them in exactly the order they were started. If the
   * refresh did not take the lock, no request would ever be seen waiting
   * and these specs fail on that, rather than passing by luck.
   */
  describe('concurrent refreshes, serialized on the row lock (ADR-045)', () => {
    let holder: Client;
    let observer: Client;

    beforeEach(async () => {
      holder = new Client({ connectionString: plainUrl() });
      observer = new Client({ connectionString: plainUrl() });
      await Promise.all([holder.connect(), observer.connect()]);
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      // A spec that failed mid-way must not leave the lock held.
      await holder.query('ROLLBACK').catch(() => undefined);
      await Promise.all([holder.end(), observer.end()]);
    });

    async function sessionIdOf(email: string): Promise<string> {
      return (await harness.prisma.session.findFirstOrThrow({ where: { user: { email } } })).id;
    }

    /** Opens a transaction on `holder` that holds the row lock until `release`. */
    async function holdRowLock(sessionId: string): Promise<() => Promise<void>> {
      await holder.query('BEGIN');
      await holder.query('SELECT id FROM sessions WHERE id = $1 FOR UPDATE', [sessionId]);
      return async () => {
        await holder.query('COMMIT');
      };
    }

    /**
     * Resolves once `count` backends are waiting, directly or behind one
     * another, on a lock `holder` holds. Bounded: a request that never
     * waits fails the spec here instead of hanging it.
     */
    async function waitersBehindHolder(count: number): Promise<void> {
      const holderPid = (await holder.query<{ pid: number }>('SELECT pg_backend_pid() AS pid'))
        .rows[0]?.pid;
      const deadline = Date.now() + 10_000;
      for (;;) {
        const { rows } = await observer.query<{ pid: number; blockers: number[] }>(
          `SELECT pid, pg_blocking_pids(pid) AS blockers
             FROM pg_stat_activity
            WHERE wait_event_type = 'Lock' AND datname = current_database()`,
        );
        const chained = new Set<number>([holderPid ?? -1]);
        let grew = true;
        while (grew) {
          grew = false;
          for (const row of rows) {
            if (!chained.has(row.pid) && row.blockers.some((pid) => chained.has(pid))) {
              chained.add(row.pid);
              grew = true;
            }
          }
        }
        if (chained.size - 1 >= count) return;
        if (Date.now() > deadline) {
          throw new Error(
            `expected ${String(count)} backend(s) waiting on the session row lock, saw ${String(chained.size - 1)}`,
          );
        }
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

    /** Starts a cookie refresh now (supertest sends on `.then`). */
    function startRefresh(token: string): Promise<request.Response> {
      return request(harness.server)
        .post(REFRESH)
        .set('Cookie', withCookie(token))
        .then((response) => response);
    }

    /** N simultaneous refreshes of one token, released together. */
    async function burst(token: string, sessionId: string, n: number): Promise<request.Response[]> {
      const release = await holdRowLock(sessionId);
      const inFlight: Promise<request.Response>[] = [];
      for (let i = 1; i <= n; i++) {
        inFlight.push(startRefresh(token));
        await waitersBehindHolder(i);
      }
      await release();
      return Promise.all(inFlight);
    }

    it.each([2, 3, 5])(
      '%i simultaneous refreshes of one token: one rotation, one successor for all, no reuse alarm',
      async (n) => {
        const email = await seedAccount(`burst-${String(n)}`);
        const { refreshToken } = await signIn(email);
        const sessionId = await sessionIdOf(email);

        const responses = await burst(refreshToken, sessionId, n);

        expect(responses.map((response) => response.status)).toEqual(Array(n).fill(200));
        const issued = new Set(responses.map(refreshTokenOf));
        expect(issued.size).toBe(1);
        const [successor = ''] = [...issued];
        expect(successor).not.toBe(refreshToken);

        // Exactly one rotation: the presented token is one generation back,
        // the single successor is current — one chain, not n.
        const sessions = harness.app.get(SessionService);
        expect((await sessions.findLive(successor))?.id).toBe(sessionId);
        expect((await sessions.findByPreviousToken(refreshToken))?.id).toBe(sessionId);
        const row = await harness.prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
        expect(row.revokedAt).toBeNull();
        expect(await auditCount('auth.refresh_reuse_detected', sessionId)).toBe(0);
        expect(await auditCount('auth.refresh_grace_replay_accepted', sessionId)).toBe(n - 1);

        // And the one successor refreshes.
        const next = await startRefresh(successor);
        expect(next.status).toBe(200);
      },
    );

    it('a mobile and a web refresh of one token at once converge too', async () => {
      const email = await seedAccount('burst-mixed');
      const { refreshToken } = await signIn(email);
      const sessionId = await sessionIdOf(email);

      const release = await holdRowLock(sessionId);
      const web = startRefresh(refreshToken);
      await waitersBehindHolder(1);
      const mobile = request(harness.server)
        .post(REFRESH)
        .set('X-Client-Type', 'mobile')
        .send({ refreshToken })
        .then((response) => response);
      await waitersBehindHolder(2);
      await release();

      const [webResponse, mobileResponse] = await Promise.all([web, mobile]);
      expect(webResponse.status).toBe(200);
      expect(mobileResponse.status).toBe(200);
      expect(dataOf<{ refreshToken: string }>(mobileResponse).refreshToken).toBe(
        refreshTokenOf(webResponse),
      );
      expect(await auditCount('auth.refresh_reuse_detected', sessionId)).toBe(0);
    });

    /**
     * The defect this design closes: a retry of T0 reading T1 as current
     * while a legitimate T1 → T2 rotation commits, and being handed T1
     * after T2 already existed.
     */
    describe('a retry of T0 racing the legitimate rotation T1 → T2', () => {
      async function rotatedOnceLocked(local: string) {
        const email = await seedAccount(local);
        const { refreshToken: t0 } = await signIn(email);
        const first = await startRefresh(t0);
        expect(first.status).toBe(200);
        return { email, t0, t1: refreshTokenOf(first), sessionId: await sessionIdOf(email) };
      }

      it('rotation first: the retry is refused — it is never handed T1 once T2 exists', async () => {
        const { t0, t1, sessionId } = await rotatedOnceLocked('race-rot-first');

        const release = await holdRowLock(sessionId);
        const rotation = startRefresh(t1);
        await waitersBehindHolder(1);
        const retry = startRefresh(t0);
        await waitersBehindHolder(2);
        await release();

        const [rotated, retried] = await Promise.all([rotation, retry]);
        expect(rotated.status).toBe(200);
        const t2 = refreshTokenOf(rotated);
        expect(t2).not.toBe(t1);

        // T0 is now two generations old: the plain 401 (ADR-026's gap),
        // with no cookie at all — in particular, not T1.
        expect(retried.status).toBe(401);
        expect(errorBody(retried)).toEqual(REFUSAL);
        expect(refreshTokenOf(retried)).toBe('');

        // T1 is the previous token and in its window: it re-delivers T2.
        const late = await startRefresh(t1);
        expect(late.status).toBe(200);
        expect(refreshTokenOf(late)).toBe(t2);
        expect(await auditCount('auth.refresh_reuse_detected', sessionId)).toBe(0);
      });

      it('retry first: it receives T1 while T1 is still current, and T1 then rotates normally', async () => {
        const { t0, t1, sessionId } = await rotatedOnceLocked('race-retry-first');
        const sessions = harness.app.get(SessionService);

        const release = await holdRowLock(sessionId);
        const retry = startRefresh(t0);
        await waitersBehindHolder(1);
        const rotation = startRefresh(t1);
        await waitersBehindHolder(2);
        await release();

        const [retried, rotated] = await Promise.all([retry, rotation]);
        // The retry held the lock first: T1 was current when it was chosen
        // and stayed current until the retry committed.
        expect(retried.status).toBe(200);
        expect(refreshTokenOf(retried)).toBe(t1);
        // Then the rotation, which the retry did not disturb.
        expect(rotated.status).toBe(200);
        const t2 = refreshTokenOf(rotated);
        expect(t2).not.toBe(t1);
        expect((await sessions.findLive(t2))?.id).toBe(sessionId);
        expect((await sessions.findByPreviousToken(t1))?.id).toBe(sessionId);

        // The client that got T1 from the retry presents it: inside the
        // window it converges on T2, the current token — not a reuse.
        const followUp = await startRefresh(t1);
        expect(followUp.status).toBe(200);
        expect(refreshTokenOf(followUp)).toBe(t2);
        // T0 is two generations old now.
        expect((await startRefresh(t0)).status).toBe(401);

        expect(await auditCount('auth.refresh_reuse_detected', sessionId)).toBe(0);
        expect(
          (await harness.prisma.session.findUniqueOrThrow({ where: { id: sessionId } })).revokedAt,
        ).toBeNull();
      });
    });

    /**
     * Review finding 1. The holder locks and releases **without writing**,
     * so PostgreSQL has no newer row version to re-evaluate against: only a
     * decision read *after* the lock sees the clock as it is when the
     * waiter proceeds. Both specs release only once the database clock has
     * carried the row past its limit while the request was observed waiting.
     */
    describe('a lock wait across a time limit, behind a holder that writes nothing', () => {
      /** Until `predicate` (SQL over `sessions s` for `id = $1`) is true on the DB clock. */
      async function untilDb(sessionId: string, predicate: string): Promise<void> {
        const deadline = Date.now() + 15_000;
        for (;;) {
          const { rows } = await observer.query<{ ok: boolean }>(
            `SELECT (${predicate}) AS ok FROM sessions s WHERE s.id = $1`,
            [sessionId],
          );
          if (rows[0]?.ok === true) return;
          if (Date.now() > deadline) throw new Error(`database never reached: ${predicate}`);
          await new Promise((resolve) => setImmediate(resolve));
        }
      }

      it('a retry that waited past 30 s is reuse, not grace — even though it queued at 28 s', async () => {
        const email = await seedAccount('wait-past-window');
        const { refreshToken: t0 } = await signIn(email);
        await startRefresh(t0);
        const sessionId = await sessionIdOf(email);
        await rotatedSecondsAgo(harness.prisma, email, 28);

        const release = await holdRowLock(sessionId);
        const retry = startRefresh(t0);
        await waitersBehindHolder(1);
        await untilDb(sessionId, `s.rotated_at <= clock_timestamp() - interval '30 seconds'`);
        await release();

        const retried = await retry;
        expect(retried.status).toBe(401);
        expect(errorBody(retried)).toEqual(REFUSAL);
        expect(refreshTokenOf(retried)).toBe('');
        const row = await harness.prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
        expect(row.revokedAt).not.toBeNull();
        expect(row.successorTokenCt).toBeNull();
        expect(await auditCount('auth.refresh_grace_replay_accepted', sessionId)).toBe(0);
        expect(await auditCount('auth.refresh_reuse_detected', sessionId)).toBe(1);
      });

      it('a session that expired during the wait is refused and its expiry is not slid', async () => {
        const email = await seedAccount('wait-past-expiry');
        const { refreshToken } = await signIn(email);
        const sessionId = await sessionIdOf(email);
        await harness.prisma.$executeRaw`
          UPDATE sessions SET expires_at = clock_timestamp() + interval '2 seconds'
           WHERE id = ${sessionId}::uuid`;
        const before = await harness.prisma.session.findUniqueOrThrow({ where: { id: sessionId } });

        const release = await holdRowLock(sessionId);
        const refresh = startRefresh(refreshToken);
        await waitersBehindHolder(1);
        await untilDb(sessionId, 's.expires_at <= clock_timestamp()');
        await release();

        const refused = await refresh;
        expect(refused.status).toBe(401);
        expect(errorBody(refused)).toEqual(REFUSAL);
        expect(refreshTokenOf(refused)).toBe('');
        const after = await harness.prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
        expect(after.expiresAt.getTime()).toBe(before.expiresAt.getTime());
        expect(after.refreshTokenHash).toBe(before.refreshTokenHash);
        expect(after.rotatedAt).toBeNull();
        expect(after.successorTokenCt).toBeNull();
      });
    });

    it(
      `a lock wait past REFRESH_TX_TIMEOUT_MS is a retryable 500, not a refusal`,
      async () => {
        const email = await seedAccount('wait-timeout');
        const { refreshToken } = await signIn(email);
        const sessionId = await sessionIdOf(email);
        const before = await harness.prisma.session.findUniqueOrThrow({ where: { id: sessionId } });

        const release = await holdRowLock(sessionId);
        const timedOut = await startRefresh(refreshToken);
        await release();

        // Not the 401 that signs a client out, and nothing was decided.
        expect(timedOut.status).toBe(500);
        expect(refreshTokenOf(timedOut)).toBe('');
        const after = await harness.prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
        expect(after.refreshTokenHash).toBe(before.refreshTokenHash);
        expect(after.revokedAt).toBeNull();

        // The same token works once the lock is gone.
        const retried = await startRefresh(refreshToken);
        expect(retried.status).toBe(200);
      },
      REFRESH_TX_TIMEOUT_MS + 15_000,
    );

    it('a sweep never waits on a locked lapsed row: it returns at once, clears the unlocked ones, and takes the locked one next time', async () => {
      const lapsed = await Promise.all(
        ['held', 'free-a', 'free-b'].map(async (tag) => {
          const email = await seedAccount(`skip-locked-${tag}`);
          const { refreshToken } = await signIn(email);
          await startRefresh(refreshToken);
          await endGraceWindow(harness.prisma, email);
          return { email, sessionId: await sessionIdOf(email) };
        }),
      );
      const [held, ...free] = lapsed;
      if (held === undefined) throw new Error('fixture');

      // Another connection holds the row: a refresh, a revocation, anything.
      const release = await holdRowLock(held.sessionId);
      const waited = Symbol('waited');
      const outcome = await Promise.race([
        harness.app.get(SessionService).clearLapsedSuccessors(),
        new Promise<typeof waited>((resolve) => {
          setTimeout(() => {
            resolve(waited);
          }, 3_000).unref();
        }),
      ]);
      expect(outcome).not.toBe(waited);

      const { rows } = await observer.query<{ id: string; has: boolean }>(
        'SELECT id::text, successor_token_ct IS NOT NULL AS has FROM sessions WHERE id = ANY($1::uuid[])',
        [lapsed.map((one) => one.sessionId)],
      );
      const has = new Map(rows.map((row) => [row.id, row.has]));
      expect(has.get(held.sessionId)).toBe(true);
      for (const one of free) expect(has.get(one.sessionId)).toBe(false);

      await release();
      await harness.app.get(SessionService).clearLapsedSuccessors();
      expect(
        (await harness.prisma.session.findUniqueOrThrow({ where: { id: held.sessionId } }))
          .successorTokenCt,
      ).toBeNull();
    });

    it('N concurrent replays outside the window: identical 401s, one revocation, 1 critical + N−1 warning audits', async () => {
      const email = await seedAccount('burst-replay');
      const { refreshToken: t0 } = await signIn(email);
      await startRefresh(t0);
      const sessionId = await sessionIdOf(email);
      await endGraceWindow(harness.prisma, email);

      const responses = await burst(t0, sessionId, 3);

      expect(responses.map((response) => response.status)).toEqual([401, 401, 401]);
      for (const response of responses) {
        expect(errorBody(response)).toEqual(REFUSAL);
        expect(refreshTokenOf(response)).toBe('');
      }
      // The one that revoked raises the critical row; the two that found the
      // family already revoked are recorded one level down.
      expect(await auditCount('auth.refresh_reuse_detected', sessionId)).toBe(1);
      expect(await auditCount('auth.refresh_replay_on_revoked_session', sessionId)).toBe(2);
      expect(
        (await harness.prisma.session.findUniqueOrThrow({ where: { id: sessionId } })).revokedAt,
      ).not.toBeNull();
    });

    describe('a retry racing a revocation', () => {
      it('revocation first: the retry is issued nothing', async () => {
        const email = await seedAccount('race-revoke-first');
        const { refreshToken: t0 } = await signIn(email);
        await startRefresh(t0);
        const sessionId = await sessionIdOf(email);

        // The revocation's own transaction holds the lock: the shape of a
        // logout or a sign-out-everywhere that has not committed yet.
        await holder.query('BEGIN');
        await holder.query('UPDATE sessions SET revoked_at = clock_timestamp() WHERE id = $1', [
          sessionId,
        ]);
        const retry = startRefresh(t0);
        await waitersBehindHolder(1);
        await holder.query('COMMIT');

        const retried = await retry;
        expect(retried.status).toBe(401);
        expect(errorBody(retried)).toEqual(REFUSAL);
        expect(refreshTokenOf(retried)).toBe('');
        expect(await auditCount('auth.refresh_grace_replay_accepted', sessionId)).toBe(0);
      });

      it('retry first: it is answered before the revocation lands, and nothing survives it', async () => {
        const email = await seedAccount('race-revoke-second');
        const { refreshToken: t0 } = await signIn(email);
        const t1 = refreshTokenOf(await startRefresh(t0));
        const sessionId = await sessionIdOf(email);
        const sessions = harness.app.get(SessionService);

        const release = await holdRowLock(sessionId);
        const retry = startRefresh(t0);
        await waitersBehindHolder(1);
        const revocation = sessions.revoke(sessionId);
        await waitersBehindHolder(2);
        await release();

        const [retried] = await Promise.all([retry, revocation]);
        // Answered while the session was still live, with its current token.
        expect(retried.status).toBe(200);
        expect(refreshTokenOf(retried)).toBe(t1);

        // The revocation then committed: neither token refreshes, and no
        // successor is left at rest.
        const row = await harness.prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
        expect(row.revokedAt).not.toBeNull();
        expect(row.successorTokenCt).toBeNull();
        expect((await startRefresh(t1)).status).toBe(401);
        expect((await startRefresh(t0)).status).toBe(401);
      });
    });

    it.each([
      ['the registry job sweep', 'job'],
      ['the RA-045.2 fallback tick', 'fallback'],
    ] as const)(
      '%s, reaching a row an in-window retry holds, skips it without waiting, and the next sweep clears it',
      async (_label, sweeper) => {
        const sessions = harness.app.get(SessionService);
        const prisma = harness.app.get(PrismaService);

        /**
         * One run of the race. `inconclusive` when the retry, on a loaded
         * machine, reached its decision only after the window had already
         * closed — the database itself says so (the decision read's
         * `inGraceWindow`), and that run proves nothing about the sweep, so
         * it is repeated on a fresh session instead of asserted loosely.
         */
        async function race(attempt: number): Promise<'done' | 'inconclusive'> {
          const email = await seedAccount(`race-sweep-${sweeper}-${String(attempt)}`);
          const { refreshToken: t0 } = await signIn(email);
          const t1 = refreshTokenOf(await startRefresh(t0));
          const sessionId = await sessionIdOf(email);

          // 29 s ago by the database clock: inside the window when the retry
          // decides, outside it within about a second — short enough that the
          // paused transaction stays far inside REFRESH_TX_TIMEOUT_MS.
          await rotatedSecondsAgo(harness.prisma, email, 29);

          // Pause the retry's transaction right after its post-lock read —
          // the statement that decides the window — with the lock still held.
          let paused!: (inWindow: boolean) => void;
          const decided = new Promise<boolean>((resolve) => {
            paused = resolve;
          });
          let open!: () => void;
          const gate = new Promise<void>((resolve) => {
            open = resolve;
          });
          const transaction = prisma.$transaction.bind(prisma) as (
            fn: (tx: unknown) => Promise<unknown>,
            options?: unknown,
          ) => Promise<unknown>;
          let rawCalls = 0;
          vi.spyOn(prisma, '$transaction').mockImplementationOnce(((
            fn: (tx: unknown) => Promise<unknown>,
            options?: unknown,
          ) =>
            transaction(
              (tx) =>
                fn(
                  new Proxy(tx as object, {
                    get(target, key, receiver) {
                      const value: unknown = Reflect.get(target, key, receiver);
                      if (key !== '$queryRaw' || typeof value !== 'function') return value;
                      return async (...args: unknown[]) => {
                        const result: unknown = await (
                          value as (...a: unknown[]) => Promise<unknown>
                        ).apply(target, args);
                        rawCalls++;
                        // 1st: lock_timeout; 2nd: the lock; 3rd: the decision read.
                        if (rawCalls === 3) {
                          const inWindow =
                            (result as { inGraceWindow?: boolean }[])[0]?.inGraceWindow === true;
                          paused(inWindow);
                          if (inWindow) await gate;
                        }
                        return result;
                      };
                    },
                  }),
                ),
              options,
            )) as never);

          const retry = startRefresh(t0);
          if (!(await decided)) {
            await retry;
            return 'inconclusive';
          }

          // Let the database clock carry the row past its window.
          for (;;) {
            const { rows } = await observer.query<{ lapsed: boolean }>(
              `SELECT rotated_at <= clock_timestamp() - interval '30 seconds' AS lapsed
               FROM sessions WHERE id = $1`,
              [sessionId],
            );
            if (rows[0]?.lapsed === true) break;
            await new Promise((resolve) => setImmediate(resolve));
          }

          // The sweep now matches the row, which the retry holds locked. It
          // claims rows `FOR UPDATE SKIP LOCKED`, so it must return without
          // waiting and leave this row alone. A fresh fallback instance, so
          // the harness's own timer cannot make this tick a skipped overlap.
          const sweepOnce = (): Promise<number> =>
            sweeper === 'job'
              ? sessions.clearLapsedSuccessors()
              : new SuccessorRetentionService(sessions, harness.app.get(ConfigService)).tick();
          const waited = Symbol('waited');
          const first = await Promise.race([
            sweepOnce(),
            new Promise<typeof waited>((resolve) => {
              setTimeout(() => {
                resolve(waited);
              }, 3_000).unref();
            }),
          ]);
          expect(first).not.toBe(waited);
          // Skipped, not cleared: the successor the retry is answering with
          // is still on the row (a plain read is not blocked by the lock).
          const { rows: held } = await observer.query<{ has: boolean }>(
            'SELECT successor_token_ct IS NOT NULL AS has FROM sessions WHERE id = $1',
            [sessionId],
          );
          expect(held[0]?.has).toBe(true);

          open();
          const retried = await retry;
          // Decided inside the window, under the lock: the successor is
          // re-delivered even though the window closed while it was answered.
          expect(retried.status).toBe(200);
          expect(refreshTokenOf(retried)).toBe(t1);

          // The next sweep, with the lock gone, takes the row it skipped.
          // State, not the count: every suite's app runs a fallback sweeper
          // (RA-045.2), and another one may be the one that clears it.
          await expect(sweepOnce()).resolves.toBeGreaterThanOrEqual(0);
          const row = await harness.prisma.session.findUniqueOrThrow({ where: { id: sessionId } });
          expect(row.successorTokenCt).toBeNull();
          expect(row.revokedAt).toBeNull();
          // The current token is unaffected.
          expect((await startRefresh(t1)).status).toBe(200);
          return 'done';
        }

        for (let attempt = 1; attempt <= 3; attempt++) {
          if ((await race(attempt)) === 'done') return;
        }
        throw new Error('no attempt reached its decision inside the window');
      },
      60_000,
    );
  });

  /**
   * ADR-045 — the retired token, re-presented within 30 seconds of its
   * rotation, is answered with the successor that rotation issued.
   *
   * Every case that is *not* a legitimate retry must still land on
   * ADR-026's reuse path (revoke + critical audit) or on the plain 401,
   * with the same body as every other refresh failure.
   */
  describe('the grace window (ADR-045)', () => {
    async function sessionOf(email: string) {
      return harness.prisma.session.findFirstOrThrow({ where: { user: { email } } });
    }

    /** Signs in and rotates once; the rotation's response is the one "lost". */
    async function rotatedOnce(
      local: string,
    ): Promise<{ email: string; first: string; second: string }> {
      const email = await seedAccount(local);
      const { refreshToken: first } = await signIn(email);
      const rotated = await request(harness.server).post(REFRESH).set('Cookie', withCookie(first));
      expect(rotated.status).toBe(200);
      return { email, first, second: refreshTokenOf(rotated) };
    }

    /** The reuse path: 401, the family revoked, one critical audit row. */
    async function expectReuse(email: string, presented: string): Promise<void> {
      const response = await request(harness.server)
        .post(REFRESH)
        .set('Cookie', withCookie(presented));

      expect(response.status).toBe(401);
      expect(errorBody(response)).toEqual(REFUSAL);
      expect(refreshTokenOf(response)).toBe('');

      const session = await sessionOf(email);
      expect(session.revokedAt).not.toBeNull();
      expect(await auditCount('auth.refresh_grace_replay_accepted', session.id)).toBe(0);
      const reuse = await harness.prisma.auditEvent.findFirst({
        where: { eventType: 'auth.refresh_reuse_detected', target: `session:${session.id}` },
      });
      expect(reuse?.severity).toBe('CRITICAL');
    }

    it('answers a lost response with the identical token, and revokes nothing (web cookie)', async () => {
      const { email, first, second } = await rotatedOnce('grace-web');
      const before = await sessionOf(email);

      const retry = await request(harness.server).post(REFRESH).set('Cookie', withCookie(first));

      expect(retry.status).toBe(200);
      // The same successor, not a third token: the client that did get
      // the first response and the one that did not now hold one token.
      expect(refreshTokenOf(retry)).toBe(second);
      const payload = dataOf<SessionPayload>(retry);
      expect(payload.user.email).toBe(email);
      expect(payload.accessToken.length).toBeGreaterThan(20);

      const after = await sessionOf(email);
      expect(after.revokedAt).toBeNull();
      // Not rotated again, and the expiry is not slid by a retry.
      expect(after.refreshTokenHash).toBe(before.refreshTokenHash);
      expect(after.previousTokenHash).toBe(before.previousTokenHash);
      expect(after.expiresAt.getTime()).toBe(before.expiresAt.getTime());
      expect(after.rotatedAt?.getTime()).toBe(before.rotatedAt?.getTime());

      expect(await auditCount('auth.refresh_reuse_detected', after.id)).toBe(0);
      const grace = await harness.prisma.auditEvent.findFirst({
        where: { eventType: 'auth.refresh_grace_replay_accepted', target: `session:${after.id}` },
      });
      expect(grace?.severity).toBe('INFO');
      expect(grace?.category).toBe('AUTHENTICATION');
      // The row says which session, never which token.
      expect(JSON.stringify(grace)).not.toContain(first);
      expect(JSON.stringify(grace)).not.toContain(second);

      // The re-delivered token is the live one.
      const next = await request(harness.server).post(REFRESH).set('Cookie', withCookie(second));
      expect(next.status).toBe(200);
    });

    it('answers a lost response with the identical token in the body (mobile)', async () => {
      const email = await seedAccount('grace-mobile');
      const login = await request(harness.server)
        .post(LOGIN)
        .set('X-Client-Type', 'mobile')
        .send({ email, password: PASSWORD, rememberMe: false });
      const first = dataOf<{ refreshToken: string }>(login).refreshToken;

      const lost = await request(harness.server)
        .post(REFRESH)
        .set('X-Client-Type', 'mobile')
        .send({ refreshToken: first });
      const second = dataOf<{ refreshToken: string }>(lost).refreshToken;

      const retry = await request(harness.server)
        .post(REFRESH)
        .set('X-Client-Type', 'mobile')
        .send({ refreshToken: first });

      expect(retry.status).toBe(200);
      expect(dataOf<{ refreshToken: string }>(retry).refreshToken).toBe(second);
      // Body, not cookie — the wire format of ADR-034 is unchanged.
      expect(refreshTokenOf(retry)).toBe('');

      const session = await sessionOf(email);
      expect(session.revokedAt).toBeNull();
      expect(await auditCount('auth.refresh_reuse_detected', session.id)).toBe(0);
      expect(await auditCount('auth.refresh_grace_replay_accepted', session.id)).toBe(1);
    });

    it('converges five concurrent refreshes of one token on one successor', async () => {
      const email = await seedAccount('grace-burst');
      const { refreshToken } = await signIn(email);

      const responses = await Promise.all(
        Array.from({ length: 5 }, () =>
          request(harness.server).post(REFRESH).set('Cookie', withCookie(refreshToken)),
        ),
      );

      expect(responses.map((response) => response.status)).toEqual([200, 200, 200, 200, 200]);
      const issued = new Set(responses.map(refreshTokenOf));
      expect(issued.size).toBe(1);
      const [successor] = [...issued];
      expect(successor).not.toBe(refreshToken);

      // One row, one hash chain: the presented token one generation back,
      // the single successor current, and the family alive.
      expect(await harness.prisma.session.count({ where: { user: { email } } })).toBe(1);
      const session = await sessionOf(email);
      expect(session.revokedAt).toBeNull();
      const sessions = harness.app.get(SessionService);
      expect((await sessions.findLive(successor ?? ''))?.id).toBe(session.id);
      expect((await sessions.findByPreviousToken(refreshToken))?.id).toBe(session.id);
      expect(await auditCount('auth.refresh_reuse_detected', session.id)).toBe(0);
      expect(await auditCount('auth.refresh_grace_replay_accepted', session.id)).toBe(4);
    });

    it('treats the retired token as reuse once the window has passed', async () => {
      const { email, first } = await rotatedOnce('grace-late');

      await endGraceWindow(harness.prisma, email);

      await expectReuse(email, first);
    });

    /**
     * ADR-045 §Clock: `rotated_at > clock_timestamp() - 30 s` is grace,
     * anything older is reuse — evaluated by PostgreSQL, so the fixtures
     * set `rotated_at` relative to the database's clock, never the app's.
     * The inside case is 0.1 s from the boundary, so it reads the row's age
     * from the database clock immediately **after** the decision as well:
     * if that age is still under 30 s, the decision (which happened
     * earlier) was certainly inside the window and must be grace. A slow
     * machine that let the age cross 30 s proves nothing either way, so the
     * attempt is repeated on a fresh session rather than asserted loosely.
     */
    describe(`exactly ${String(REFRESH_GRACE_WINDOW_SECONDS)} seconds, by the database clock`, () => {
      afterEach(() => {
        vi.useRealTimers();
      });

      it('is grace 29.9 s after the rotation', async () => {
        for (let attempt = 1; attempt <= 5; attempt++) {
          const { email, first, second } = await rotatedOnce(`grace-edge-in-${String(attempt)}`);
          await rotatedSecondsAgo(harness.prisma, email, 29.9);
          // Kept before the call: a reuse verdict revokes the row, and the
          // trigger then clears `rotated_at`, so it cannot be read back after.
          const rotatedAt = (await sessionOf(email)).rotatedAt;
          if (rotatedAt === null) throw new Error('fixture: rotated_at should be set');

          const outcome = await harness.app.get(SessionService).refresh(first);
          const [aged] = await harness.prisma.$queryRaw<{ seconds: number }[]>`
            SELECT extract(epoch FROM (clock_timestamp() - ${rotatedAt}::timestamptz))::float8
                   AS seconds`;
          // Not decisive: the age crossed 30 s before it could be read back.
          if (aged === undefined || aged.seconds >= REFRESH_GRACE_WINDOW_SECONDS) continue;

          expect(outcome.kind).toBe('grace');
          expect(outcome.kind === 'grace' ? outcome.refreshToken : '').toBe(second);
          return;
        }
        throw new Error('no attempt read the row back while it was still inside the window');
      }, 60_000);

      it('is reuse 30.0 s after the rotation — the boundary itself is outside', async () => {
        const { email, first } = await rotatedOnce('grace-edge-at');
        await rotatedSecondsAgo(harness.prisma, email, 30);

        expect((await harness.app.get(SessionService).refresh(first)).kind).toBe('reuse');
        expect((await sessionOf(email)).revokedAt).not.toBeNull();
      });

      it('is reuse an hour after the rotation', async () => {
        const { email, first } = await rotatedOnce('grace-edge-hour');
        await rotatedSecondsAgo(harness.prisma, email, 3_600);

        expect((await harness.app.get(SessionService).refresh(first)).kind).toBe('reuse');
      });

      it('stamps rotated_at from the database clock even when the app clock is an hour off', async () => {
        const email = await seedAccount('grace-stamp');
        const { refreshToken } = await signIn(email);
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.now() + 3_600_000);

        expect((await harness.app.get(SessionService).refresh(refreshToken)).kind).toBe('rotated');

        vi.useRealTimers();
        const [skew] = await harness.prisma.$queryRaw<{ seconds: number }[]>`
          SELECT abs(extract(epoch FROM (clock_timestamp() - s.rotated_at)))::float8 AS seconds
            FROM sessions s JOIN users u ON u.id = s.user_id
           WHERE u.email = ${email}`;
        expect(skew?.seconds).toBeLessThan(60);
      });

      it.each([
        ['ten minutes ahead', 600_000, 5, 'grace'],
        ['ten minutes behind', -600_000, 31, 'reuse'],
        ['a day ahead', 86_400_000, 29, 'grace'],
        ['a day behind', -86_400_000, 30.5, 'reuse'],
      ] as const)('is unmoved by an app clock %s', async (_label, skewMs, rotatedAgo, expected) => {
        const { email, first } = await rotatedOnce(`grace-skew-${String(skewMs)}`);
        await rotatedSecondsAgo(harness.prisma, email, rotatedAgo);
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.now() + skewMs);

        expect((await harness.app.get(SessionService).refresh(first)).kind).toBe(expected);
      });
    });

    it('is reuse when the stored successor is no longer the current token', async () => {
      // The successor itself rotated, but a stale ciphertext survived next
      // to the retired hash — a write that bypassed `rotate`, or a
      // database edit. The binding still matches; the successor is dead.
      const { email, first, second } = await rotatedOnce('grace-stale');
      const generationOne = await sessionOf(email);

      // `second` rotates to a third token; the row moves on.
      await request(harness.server).post(REFRESH).set('Cookie', withCookie(second)).expect(200);

      // Put generation one's retired hash and ciphertext back, fresh.
      await harness.prisma.session.update({
        where: { id: generationOne.id },
        data: {
          previousTokenHash: generationOne.previousTokenHash,
          successorTokenCt: generationOne.successorTokenCt,
          rotatedAt: new Date(),
        },
      });

      await expectReuse(email, first);
    });

    it('does not reach back two generations, inside the window or not', async () => {
      const { email, first, second } = await rotatedOnce('grace-two-gen');
      const third = refreshTokenOf(
        await request(harness.server).post(REFRESH).set('Cookie', withCookie(second)),
      );
      expect(third).not.toBe('');

      // `first` is two rotations old. ADR-026 keeps one generation, so it
      // matches nothing — no successor is re-delivered for it — and it is
      // the plain 401 rather than a revocation (ADR-026's accepted gap).
      const stale = await request(harness.server).post(REFRESH).set('Cookie', withCookie(first));
      expect(stale.status).toBe(401);
      expect(errorBody(stale)).toEqual(REFUSAL);
      expect(refreshTokenOf(stale)).toBe('');

      const session = await sessionOf(email);
      expect(await auditCount('auth.refresh_grace_replay_accepted', session.id)).toBe(0);
      // The previous generation (`second`) still re-delivers `third`, and
      // only `third`: the window follows the newest rotation.
      const retry = await request(harness.server).post(REFRESH).set('Cookie', withCookie(second));
      expect(retry.status).toBe(200);
      expect(refreshTokenOf(retry)).toBe(third);
    });

    it('gives a revoked session nothing, and keeps no successor on it', async () => {
      const email = await seedAccount('grace-revoked');
      const login = await request(harness.server)
        .post(LOGIN)
        .send({ email, password: PASSWORD, rememberMe: false });
      const first = refreshTokenOf(login);
      const rotated = await request(harness.server).post(REFRESH).set('Cookie', withCookie(first));
      const { accessToken } = dataOf<SessionPayload>(rotated);
      expect((await sessionOf(email)).successorTokenCt).not.toBeNull();

      await request(harness.server)
        .post(LOGOUT)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);

      const revoked = await sessionOf(email);
      expect(revoked.revokedAt).not.toBeNull();
      expect(revoked.successorTokenCt).toBeNull();
      expect(revoked.rotatedAt).toBeNull();

      const retry = await request(harness.server).post(REFRESH).set('Cookie', withCookie(first));
      expect(retry.status).toBe(401);
      expect(errorBody(retry)).toEqual(REFUSAL);
      expect(refreshTokenOf(retry)).toBe('');
      expect(await auditCount('auth.refresh_grace_replay_accepted', revoked.id)).toBe(0);
    });

    it('drops the successor on every revocation path, not only SessionService', async () => {
      // `sessions_clear_revoked_successor`: a raw revocation — the shape
      // the account-security, password-reset and administration modules
      // write — must not leave the ciphertext behind either.
      const { email } = await rotatedOnce('grace-trigger');

      await harness.prisma.session.updateMany({
        where: { user: { email } },
        data: { revokedAt: new Date() },
      });

      const session = await sessionOf(email);
      expect(session.successorTokenCt).toBeNull();
      expect(session.rotatedAt).toBeNull();
    });

    it('gives an expired session nothing', async () => {
      const { email, first } = await rotatedOnce('grace-expired');
      await harness.prisma.session.updateMany({
        where: { user: { email } },
        data: { startedAt: new Date(Date.now() - 60_000), expiresAt: new Date(Date.now() - 1_000) },
      });

      const retry = await request(harness.server).post(REFRESH).set('Cookie', withCookie(first));

      expect(retry.status).toBe(401);
      expect(errorBody(retry)).toEqual(REFUSAL);
      expect(refreshTokenOf(retry)).toBe('');
      expect(
        await auditCount('auth.refresh_grace_replay_accepted', (await sessionOf(email)).id),
      ).toBe(0);
    });

    it('fails closed on a tampered ciphertext — reuse, never a 500', async () => {
      const { email, first } = await rotatedOnce('grace-tamper');
      const session = await sessionOf(email);
      const bytes = Uint8Array.from(session.successorTokenCt ?? []);
      bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0x01;
      await harness.prisma.session.update({
        where: { id: session.id },
        data: { successorTokenCt: bytes },
      });

      await expectReuse(email, first);
    });

    it('fails closed on a ciphertext bound to another session', async () => {
      const victim = await rotatedOnce('grace-bound-a');
      const other = await rotatedOnce('grace-bound-b');
      const otherRow = await sessionOf(other.email);

      // A valid envelope under the current key, copied from another row.
      await harness.prisma.session.updateMany({
        where: { user: { email: victim.email } },
        data: { successorTokenCt: otherRow.successorTokenCt },
      });

      await expectReuse(victim.email, victim.first);
    });

    it('fails closed on a ciphertext bound to another previous token', async () => {
      const { email, first, second } = await rotatedOnce('grace-bound-prev');
      const session = await sessionOf(email);
      const envelope = harness.app.get(EnvelopeService);

      // Right session, right successor, wrong retired hash.
      await harness.prisma.session.update({
        where: { id: session.id },
        data: {
          successorTokenCt: envelope.encrypt(
            JSON.stringify({ v: 1, sid: session.id, prev: '0'.repeat(64), token: second }),
          ),
        },
      });

      await expectReuse(email, first);
    });

    it('fails closed on a well-sealed plaintext that is not an envelope', async () => {
      const { email, first } = await rotatedOnce('grace-garbage');
      const envelope = harness.app.get(EnvelopeService);
      await harness.prisma.session.updateMany({
        where: { user: { email } },
        data: { successorTokenCt: envelope.encrypt('not json at all') },
      });

      await expectReuse(email, first);
    });

    it('replaces the ciphertext on every rotation', async () => {
      const { email, second } = await rotatedOnce('grace-replace');
      const generationOne = (await sessionOf(email)).successorTokenCt;

      await request(harness.server).post(REFRESH).set('Cookie', withCookie(second)).expect(200);
      const generationTwo = (await sessionOf(email)).successorTokenCt;

      expect(generationOne).not.toBeNull();
      expect(generationTwo).not.toBeNull();
      expect(Buffer.from(generationTwo ?? []).equals(Buffer.from(generationOne ?? []))).toBe(false);
    });

    it('gives a suspended account nothing inside the window, and ends the session', async () => {
      const { email, first } = await rotatedOnce('grace-suspended');
      await harness.prisma.user.update({ where: { email }, data: { status: 'SUSPENDED' } });

      const retry = await request(harness.server).post(REFRESH).set('Cookie', withCookie(first));

      expect(retry.status).toBe(401);
      expect(errorBody(retry)).toEqual(REFUSAL);
      expect(refreshTokenOf(retry)).toBe('');
      const session = await sessionOf(email);
      expect(session.revokedAt).not.toBeNull();
      expect(session.successorTokenCt).toBeNull();
    });

    /**
     * RA-045.1: past the window the successor is never honoured, so it
     * must not stay at rest either. The sweep clears lapsed rows only —
     * a session still inside its window keeps its successor and its retry.
     */
    it('sweeps lapsed successors and leaves those still inside the window', async () => {
      const idle = await rotatedOnce('grace-sweep-idle');
      const fresh = await rotatedOnce('grace-sweep-fresh');
      await endGraceWindow(harness.prisma, idle.email);

      const job = harness.app.get(JobRegistry).findRunnable('auth.refresh-successor-sweep');
      if (job === null) throw new Error('the sweep should be registered as runnable');
      const outcome = await job.handler({
        now: new Date(),
        attempt: 1,
        trigger: 'manual',
        correlationId: 'grace-sweep',
      });
      // A count, not "at least this row": any suite's fallback sweeper
      // (RA-045.2) may have cleared it first. The row state is the claim.
      expect(typeof outcome['cleared']).toBe('number');

      const idleRow = await sessionOf(idle.email);
      expect(idleRow.successorTokenCt).toBeNull();
      expect(idleRow.revokedAt).toBeNull();
      const freshRow = await sessionOf(fresh.email);
      expect(freshRow.successorTokenCt).not.toBeNull();

      // The idle session's current token is untouched and still refreshes;
      // its retired one stays the reuse it already was.
      const live = await request(harness.server)
        .post(REFRESH)
        .set('Cookie', withCookie(idle.second));
      expect(live.status).toBe(200);

      const retry = await request(harness.server)
        .post(REFRESH)
        .set('Cookie', withCookie(fresh.first));
      expect(retry.status).toBe(200);
      expect(refreshTokenOf(retry)).toBe(fresh.second);
    });

    /**
     * RA-045.2: the bound must not depend on `JOBS_ENABLED`. Every instance
     * runs `SuccessorRetentionService` — a sweep at bootstrap and on its own
     * timer. The timer is unit-tested with fake timers
     * (`successor-retention.service.spec.ts`); here each tick and each
     * bootstrap is driven directly against PostgreSQL, with every age set on
     * the database clock.
     */
    describe('the worker-independent fallback sweep (RA-045.2)', () => {
      function fallback(sessions = harness.app.get(SessionService)): SuccessorRetentionService {
        return new SuccessorRetentionService(sessions, harness.app.get(ConfigService));
      }

      it('runs in this process although JOBS_ENABLED is off, and its tick clears a lapsed successor only', async () => {
        expect(harness.app.get(ConfigService).jobsEnabled).toBe(false);
        // The application's own instance is armed.
        expect(harness.app.get(SuccessorRetentionService).scheduled).toBe(true);

        const lapsed = await rotatedOnce('fallback-lapsed');
        const inWindow = await rotatedOnce('fallback-in-window');
        await endGraceWindow(harness.prisma, lapsed.email);
        await rotatedSecondsAgo(harness.prisma, inWindow.email, 25);

        await expect(fallback().tick()).resolves.toBeGreaterThanOrEqual(0);

        expect((await sessionOf(lapsed.email)).successorTokenCt).toBeNull();
        expect((await sessionOf(inWindow.email)).successorTokenCt).not.toBeNull();
        // The in-window retry still works after the sweep.
        const retry = await request(harness.server)
          .post(REFRESH)
          .set('Cookie', withCookie(inWindow.first));
        expect(retry.status).toBe(200);
        expect(refreshTokenOf(retry)).toBe(inWindow.second);
      });

      it('clears what lapsed while nothing ran, at bootstrap, then arms its timer; shutdown disarms it', async () => {
        const lapsed = await rotatedOnce('fallback-bootstrap');
        await endGraceWindow(harness.prisma, lapsed.email);
        const instance = fallback();
        expect(instance.scheduled).toBe(false);

        await instance.onApplicationBootstrap();

        expect((await sessionOf(lapsed.email)).successorTokenCt).toBeNull();
        expect(instance.scheduled).toBe(true);
        await instance.onModuleDestroy();
        expect(instance.scheduled).toBe(false);
        expect(await instance.tick()).toBe(0);
      });

      it('coexists with the registry job when jobs are on: both run at once, no error, one outcome', async () => {
        const lapsed = await rotatedOnce('fallback-with-job');
        const inWindow = await rotatedOnce('fallback-with-job-fresh');
        await endGraceWindow(harness.prisma, lapsed.email);
        const job = harness.app.get(JobRegistry).findRunnable('auth.refresh-successor-sweep');
        if (job === null) throw new Error('the sweep should be registered as runnable');

        const [byJob, byFallback] = await Promise.all([
          job.handler({ now: new Date(), attempt: 1, trigger: 'manual', correlationId: 'both' }),
          fallback().tick(),
        ]);

        expect(typeof byJob['cleared']).toBe('number');
        expect(byFallback).toBeGreaterThanOrEqual(0);
        const row = await sessionOf(lapsed.email);
        expect(row.successorTokenCt).toBeNull();
        // Clearing the ciphertext is the only side effect: not revoked, and
        // the current token still refreshes.
        expect(row.revokedAt).toBeNull();
        expect((await sessionOf(inWindow.email)).successorTokenCt).not.toBeNull();
        const live = await request(harness.server)
          .post(REFRESH)
          .set('Cookie', withCookie(lapsed.second));
        expect(live.status).toBe(200);
      });

      it('two instances, each with its own connection pool, sweeping at once: no error, every lapsed row cleared once', async () => {
        const config = harness.app.get(ConfigService);
        const second = new PrismaService(config);
        await second.$connect();
        try {
          const otherSessions = new SessionService(
            second,
            harness.app.get(SecretService),
            harness.app.get(PolicyService),
            harness.app.get(EnvelopeService),
          );
          const lapsed = await Promise.all(
            ['a', 'b', 'c'].map((tag) => rotatedOnce(`fallback-two-${tag}`)),
          );
          const inWindow = await rotatedOnce('fallback-two-fresh');
          for (const one of lapsed) await endGraceWindow(harness.prisma, one.email);

          const results = await Promise.all([fallback().tick(), fallback(otherSessions).tick()]);

          for (const cleared of results) expect(cleared).toBeGreaterThanOrEqual(0);
          for (const one of lapsed) {
            const row = await sessionOf(one.email);
            expect(row.successorTokenCt).toBeNull();
            expect(row.revokedAt).toBeNull();
          }
          expect((await sessionOf(inWindow.email)).successorTokenCt).not.toBeNull();
        } finally {
          await second.$disconnect();
        }
      });
    });

    it('treats a retired token as reuse once its successor has been swept', async () => {
      const { email, first } = await rotatedOnce('grace-swept-reuse');
      await endGraceWindow(harness.prisma, email);
      await harness.app.get(SessionService).clearLapsedSuccessors();
      expect((await sessionOf(email)).successorTokenCt).toBeNull();

      await expectReuse(email, first);
    });
  });

  /**
   * ADR-045 §Encryption: the successor is at rest only as ciphertext. The
   * row (every column, as PostgreSQL renders it), the audit rows and every
   * log line the refresh paths write — grace, rotation, reuse — are
   * scanned for any refresh token in clear.
   */
  describe('no refresh token is ever written in clear (ADR-045)', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('keeps every token out of the session row, the audit rows and the logs', async () => {
      const captured: string[] = [];
      const text = (value: unknown): string => {
        if (typeof value === 'string') return value;
        if (value instanceof Uint8Array) return Buffer.from(value).toString('latin1');
        try {
          return JSON.stringify(value) ?? String(value);
        } catch {
          return String(value);
        }
      };
      const record = (...args: unknown[]): void => {
        captured.push(args.map(text).join(' '));
      };
      for (const method of ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const) {
        vi.spyOn(Logger.prototype, method).mockImplementation(record);
      }
      for (const stream of [process.stdout, process.stderr]) {
        const write = stream.write.bind(stream);
        vi.spyOn(stream, 'write').mockImplementation((chunk: unknown, ...rest: unknown[]) => {
          captured.push(text(chunk));
          return (write as (...args: unknown[]) => boolean)(chunk, ...rest);
        });
      }

      const email = await seedAccount('plaintext-scan');
      const { refreshToken: t0 } = await signIn(email);
      const rotated = await request(harness.server).post(REFRESH).set('Cookie', withCookie(t0));
      const t1 = refreshTokenOf(rotated);
      const retry = await request(harness.server).post(REFRESH).set('Cookie', withCookie(t0));
      expect(retry.status).toBe(200);
      expect(refreshTokenOf(retry)).toBe(t1);

      // The row while it holds a successor: every column, as text, and
      // the ciphertext's raw bytes.
      const [held] = await harness.prisma.$queryRaw<{ dump: string; ct: Uint8Array | null }[]>`
        SELECT row_to_json(s)::text AS dump, s.successor_token_ct AS ct
          FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE u.email = ${email}`;
      expect(held?.ct).not.toBeNull();

      // And the reuse path, which logs at error level.
      await endGraceWindow(harness.prisma, email);
      const replay = await request(harness.server).post(REFRESH).set('Cookie', withCookie(t0));
      expect(replay.status).toBe(401);

      const [ended] = await harness.prisma.$queryRaw<{ dump: string }[]>`
        SELECT row_to_json(s)::text AS dump
          FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE u.email = ${email}`;
      const session = await harness.prisma.session.findFirstOrThrow({ where: { user: { email } } });
      const audits = await harness.prisma.auditEvent.findMany({
        where: { target: `session:${session.id}` },
      });
      expect(audits.map((row) => row.eventType).sort()).toEqual([
        'auth.login',
        'auth.refresh_grace_replay_accepted',
        'auth.refresh_reuse_detected',
      ]);
      // The reuse path did log — so the scan below covered a real line.
      expect(captured.some((line) => line.includes('Refresh token reuse detected'))).toBe(true);

      const haystacks = [
        held?.dump ?? '',
        Buffer.from(held?.ct ?? []).toString('latin1'),
        Buffer.from(held?.ct ?? []).toString('utf8'),
        ended?.dump ?? '',
        JSON.stringify(audits),
        ...captured,
      ];
      for (const token of [t0, t1]) {
        expect(token.length).toBeGreaterThan(20);
        for (const haystack of haystacks) expect(haystack.includes(token)).toBe(false);
      }
    });
  });

  /**
   * Review M1: a retired token replayed against a session that was already
   * revoked for another reason — here, a logout — must still leave a trace.
   * Not the critical reuse row (nothing is revoked by it, and the family
   * already ended), but `auth.refresh_replay_on_revoked_session` at
   * `warning`, with the same 401 every refusal carries and no token in the
   * row or the logs.
   */
  describe('a retired token replayed after the session was already revoked', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('is the identical 401, recorded once as a warning, never critical, and never in clear', async () => {
      const captured: string[] = [];
      const text = (value: unknown): string => {
        if (typeof value === 'string') return value;
        try {
          return JSON.stringify(value) ?? String(value);
        } catch {
          return String(value);
        }
      };
      for (const method of ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const) {
        vi.spyOn(Logger.prototype, method).mockImplementation((...args: unknown[]) => {
          captured.push(args.map(text).join(' '));
        });
      }

      const email = await seedAccount('replay-after-logout');
      const login = await request(harness.server)
        .post(LOGIN)
        .send({ email, password: PASSWORD, rememberMe: false });
      const t0 = refreshTokenOf(login);
      const rotated = await request(harness.server).post(REFRESH).set('Cookie', withCookie(t0));
      const t1 = refreshTokenOf(rotated);
      const { accessToken } = dataOf<SessionPayload>(rotated);

      // The family ends for an ordinary reason.
      await request(harness.server)
        .post(LOGOUT)
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(204);

      // Later — outside any window — the retired token turns up.
      const replay = await request(harness.server).post(REFRESH).set('Cookie', withCookie(t0));

      expect(replay.status).toBe(401);
      expect(errorBody(replay)).toEqual(REFUSAL);
      expect(refreshTokenOf(replay)).toBe('');

      const session = await harness.prisma.session.findFirstOrThrow({ where: { user: { email } } });
      expect(await auditCount('auth.refresh_replay_on_revoked_session', session.id)).toBe(1);
      expect(await auditCount('auth.refresh_reuse_detected', session.id)).toBe(0);
      const row = await harness.prisma.auditEvent.findFirstOrThrow({
        where: {
          eventType: 'auth.refresh_replay_on_revoked_session',
          target: `session:${session.id}`,
        },
      });
      expect(row.severity).toBe('WARNING');
      expect(row.category).toBe('AUTHENTICATION');
      expect(captured.some((line) => line.includes('already-revoked session'))).toBe(true);

      const [dump] = await harness.prisma.$queryRaw<{ dump: string }[]>`
        SELECT row_to_json(s)::text AS dump FROM sessions s WHERE s.id = ${session.id}::uuid`;
      for (const token of [t0, t1]) {
        for (const haystack of [dump?.dump ?? '', JSON.stringify(row), ...captured]) {
          expect(haystack.includes(token)).toBe(false);
        }
      }
    });
  });

  describe('a session started without a request context', () => {
    it('stores no device and no address, and is live', async () => {
      const email = await seedAccount('amelia');
      const user = await harness.prisma.user.findUniqueOrThrow({ where: { email } });
      const sessions = harness.app.get(SessionService);

      // `req.ip` is `undefined` once the client's socket has gone, so the
      // controller can hand `start` an empty address. Nothing is invented.
      const issued = await sessions.start(user.id, false);

      expect(issued.session.device).toBeNull();
      expect(issued.session.ipAddress).toBeNull();
      expect((await sessions.findLive(issued.refreshToken))?.id).toBe(issued.session.id);
    });
  });

  describe('the mobile variant (API §1.5)', () => {
    it('accepts the token in the body when X-Client-Type is mobile', async () => {
      const email = await seedAccount('amelia');
      const { refreshToken } = await signIn(email);

      const response = await request(harness.server)
        .post(REFRESH)
        .set('X-Client-Type', 'mobile')
        .send({ refreshToken });

      expect(response.status).toBe(200);
      expect(dataOf<SessionPayload>(response).user.email).toBe(email);
    });

    it('ignores a body token when a cookie is present', async () => {
      const email = await seedAccount('amelia');
      const { refreshToken } = await signIn(email);

      // The header is a fallback selector, not an override: a browser must
      // not be talked into using a body token by a header an attacker set.
      const response = await request(harness.server)
        .post(REFRESH)
        .set('X-Client-Type', 'mobile')
        .set('Cookie', withCookie(refreshToken))
        .send({ refreshToken: 'a-token-nobody-ever-issued' });

      expect(response.status).toBe(200);
    });

    it('ignores a body token without the header', async () => {
      const email = await seedAccount('amelia');
      const { refreshToken } = await signIn(email);

      expect((await request(harness.server).post(REFRESH).send({ refreshToken })).status).toBe(401);
    });
  });

  /**
   * ADR-011's real risk is not what the server *offers* — the login spec
   * already asserts the attributes — but what a client **returns**. A
   * cookie scoped to the wrong path is set successfully and then never
   * sent again, and silent refresh stops working with no error anywhere.
   *
   * So the header the server actually produced is fed to a real cookie
   * implementation (`cookiejar`, the one superagent itself uses) and
   * asked what it would send where. Supertest's own agent cannot answer
   * this over plain HTTP: the cookie is `Secure`, and the library models
   * neither a browser's localhost exemption nor TLS.
   */
  describe('the cookie a client would actually send back', () => {
    async function jarFrom(email: string): Promise<CookieJar> {
      const login = await request(harness.server)
        .post(LOGIN)
        .send({ email, password: PASSWORD, rememberMe: false });

      const raw: unknown = login.headers['set-cookie'];
      const headers = (Array.isArray(raw) ? raw : [raw]).filter(
        (value): value is string => typeof value === 'string',
      );

      const jar = new CookieJar();
      jar.setCookies(headers);
      return jar;
    }

    const sentTo = (jar: CookieJar, path: string): string[] =>
      jar.getCookies(new CookieAccessInfo('localhost', path, true, false)).map((c) => c.name);

    it('is returned to the auth routes', async () => {
      const jar = await jarFrom(await seedAccount('amelia'));

      expect(sentTo(jar, '/api/v1/auth/refresh')).toContain('medora_rt');
      expect(sentTo(jar, '/api/v1/auth/logout')).toContain('medora_rt');
    });

    it('is not attached to any other request', async () => {
      const jar = await jarFrom(await seedAccount('amelia'));

      // The scoping is what keeps a 30-day credential off every clinical
      // request, where a logging middleware or a proxy could capture it.
      expect(sentTo(jar, '/api/v1/patients')).toEqual([]);
      expect(sentTo(jar, '/api/v1/health')).toEqual([]);
      expect(sentTo(jar, '/')).toEqual([]);
    });

    it('is withheld from an insecure connection', async () => {
      const jar = await jarFrom(await seedAccount('amelia'));

      expect(sentTo(jar, '/api/v1/auth/refresh')).toContain('medora_rt');
      // Same jar, same path, `secure: false` — the Secure attribute is
      // the only thing that changed the answer.
      const overPlainHttp = jar
        .getCookies(new CookieAccessInfo('localhost', '/api/v1/auth/refresh', false, false))
        .map((cookie) => cookie.name);
      expect(overPlainHttp).toEqual([]);
    });
  });
});

describe('logout', () => {
  it('answers 204, revokes the session and clears the cookie', async () => {
    const email = await seedAccount('amelia');
    const { refreshToken, accessToken } = await signIn(email);

    const response = await request(harness.server)
      .post(LOGOUT)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(response.status).toBe(204);
    expect(refreshTokenOf(response)).toBe('');

    const session = await harness.prisma.session.findFirstOrThrow({ where: { user: { email } } });
    expect(session.revokedAt).not.toBeNull();

    const afterLogout = await request(harness.server).post(REFRESH).set('Cookie', withCookie(refreshToken));
    expect(afterLogout.status).toBe(401);
  });

  it('clears the cookie with the attributes it was set with', async () => {
    const email = await seedAccount('amelia');
    const { accessToken } = await signIn(email);

    const response = await request(harness.server)
      .post(LOGOUT)
      .set('Authorization', `Bearer ${accessToken}`);

    const raw: unknown = response.headers['set-cookie'];
    const cookies = Array.isArray(raw) ? raw : [raw];
    const cleared = cookies.find(
      (value): value is string => typeof value === 'string' && value.startsWith('medora_rt='),
    );

    // A browser matches a deletion by name, domain and path — omit the
    // path and the cookie survives the logout.
    expect(cleared).toContain('Path=/api/v1/auth');
    expect(cleared).toContain('HttpOnly');
  });

  it('requires an access token', async () => {
    expect((await request(harness.server).post(LOGOUT)).status).toBe(401);
  });

  it('refuses a forged token', async () => {
    const email = await seedAccount('amelia');
    const { accessToken } = await signIn(email);
    const tampered = `${accessToken.slice(0, -4)}AAAA`;

    const response = await request(harness.server)
      .post(LOGOUT)
      .set('Authorization', `Bearer ${tampered}`);

    expect(response.status).toBe(401);
  });

  it('ends only the session the token names', async () => {
    const email = await seedAccount('amelia');
    const first = await signIn(email);
    await signIn(email);

    await request(harness.server).post(LOGOUT).set('Authorization', `Bearer ${first.accessToken}`);

    const live = await harness.prisma.session.count({
      where: { user: { email }, revokedAt: null },
    });
    expect(live).toBe(1);
  });
});
