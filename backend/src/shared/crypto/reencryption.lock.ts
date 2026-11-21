import { Injectable } from '@nestjs/common';
import { Client } from 'pg';

import { ConfigService } from '../../config';

/**
 * One re-encryption at a time, across every machine that can reach the
 * database (review findings F6, R2, R3, R8).
 *
 * A PostgreSQL **session** advisory lock, held on a connection of its own
 * for the whole run — and **every envelope write of the run is executed on
 * that same session** (`guardedSwap`), as one statement that re-checks the
 * lock in the same snapshot as the UPDATE. Not taken through Prisma:
 * Prisma hands each query to whichever pooled connection is free.
 *
 * What each property rests on:
 *
 * - **Exclusive.** `pg_try_advisory_lock` succeeds for one session per
 *   database; a second run is refused at once rather than queued.
 * - **No write after the lock is lost (R2).** A session lock is lost only
 *   when its session ends (this code never unlocks mid-run). Writes run on
 *   that session, so once it has ended there is nothing left to write
 *   through; and each write is guarded in-statement — `UPDATE … AND
 *   <this backend holds the lock>` — so a statement that somehow reaches a
 *   backend without the lock writes nothing and the run stops.
 * - **Pinned and verified (R3).** The backend pid is recorded when the lock
 *   is taken. Every later statement on the session returns
 *   `pg_backend_pid()`, and every write is admitted in-statement only on
 *   that exact backend; a different pid means a pooler moved the session,
 *   and the run fails closed with nothing written. That part is
 *   **deterministic**. Transaction-mode pooling is also *detected* and
 *   refused up front — a fresh connection that already holds the lock
 *   shares a server session; a later connection handed the lock holder's
 *   backend is a pooler lending it out — but that detection is **best
 *   effort**: a pooler that happens to keep giving this session the same
 *   backend passes it, and the run is then safe for the reason above, not
 *   supported. Session-mode pooling and direct connections pass every
 *   check (verified against PgBouncer 1.22 in both modes).
 * - **Bounded waits (R8).** Connect timeout, client-side query timeout,
 *   server `statement_timeout` and `lock_timeout`, and TCP keepalive. A
 *   timeout on the lock session is treated as a lost lock: the run stops
 *   and the connection is closed, which ends the session and its lock.
 * - **Released by a crash.** The lock belongs to the session, so a killed
 *   process or a dropped network ends it (a blackholed network: once the
 *   server's own TCP keepalive gives up; until then new runs are refused,
 *   which is the safe direction).
 */

/**
 * The two-integer form of the advisory key, so it is legible in
 * `pg_locks` (`classid`, `objid`): ASCII "MEDO" and "RKEY".
 */
export const REENCRYPTION_LOCK_CLASS = 0x4d45444f;
export const REENCRYPTION_LOCK_OBJECT = 0x524b4559;

/** R8 bounds. Generous for one-row statements; short enough that a hung run ends. */
export const LOCK_CONNECT_TIMEOUT_MS = 10_000;
export const LOCK_QUERY_TIMEOUT_MS = 30_000;
export const LOCK_STATEMENT_TIMEOUT = '25s';
export const LOCK_ROW_LOCK_TIMEOUT = '10s';
export const LOCK_KEEPALIVE_INITIAL_DELAY_MS = 10_000;
export const LOCK_RELEASE_TIMEOUT_MS = 5_000;
/** Fresh connections opened after locking to see whether one is handed the lock holder's backend. */
export const AFFINITY_PROBES = 3;
/** Unlock attempts when backing out of a lock taken through a pooler. */
export const UNLOCK_ATTEMPTS = 8;

/**
 * The lock session's `application_name` while it holds the lock (review
 * finding S4): `medora-reencrypt:<runId>:<mode>`, at most 57 of PostgreSQL's
 * 63 characters. `--status` reads it from `pg_stat_activity` to know which
 * run owns the lock — a dry run writes no audit row, and a confirm run
 * holds the lock briefly before its `started` row exists, so the audit
 * trail alone cannot say.
 */
export const LOCK_APPLICATION_PREFIX = 'medora-reencrypt:';

export type LockRunMode = 'confirm' | 'dry-run';

/** Who the run holding the lock is, as far as the lock session says. */
export interface LockIdentity {
  readonly runId: string;
  readonly mode: LockRunMode;
}

/** The lock's current owner. `runId: null` with `held: true`: a holder that did not identify itself. */
export interface LockHolder {
  readonly held: boolean;
  readonly runId: string | null;
  readonly mode: LockRunMode | null;
}

const LOCK_APPLICATION_PATTERN =
  /^medora-reencrypt:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(confirm|dry-run)$/;

export function lockApplicationName(identity: LockIdentity): string {
  return `${LOCK_APPLICATION_PREFIX}${identity.runId}:${identity.mode}`;
}

/** The identity in an `application_name`, or `null` if it is not one this code wrote. */
export function parseLockApplicationName(name: string | null | undefined): LockIdentity | null {
  const match = typeof name === 'string' ? LOCK_APPLICATION_PATTERN.exec(name) : null;
  const runId = match?.[1];
  const mode = match?.[2];
  if (runId === undefined || (mode !== 'confirm' && mode !== 'dry-run')) return null;
  return { runId, mode };
}

/** The R8 bounds, as one value so a test can shorten them without touching the defaults. */
export interface LockTimeouts {
  readonly connectMs: number;
  readonly queryMs: number;
  /** Server `statement_timeout`, as PostgreSQL parses it (`'25s'`). */
  readonly statement: string;
  /** Server `lock_timeout`: how long a write waits on a row live traffic holds. */
  readonly rowLock: string;
  readonly keepAliveInitialDelayMs: number;
}

export const DEFAULT_LOCK_TIMEOUTS: LockTimeouts = {
  connectMs: LOCK_CONNECT_TIMEOUT_MS,
  queryMs: LOCK_QUERY_TIMEOUT_MS,
  statement: LOCK_STATEMENT_TIMEOUT,
  rowLock: LOCK_ROW_LOCK_TIMEOUT,
  keepAliveInitialDelayMs: LOCK_KEEPALIVE_INITIAL_DELAY_MS,
};

/** The subset of `pg.Client` the lock uses — a seam for the pooling tests. */
export interface LockSessionClient {
  connect(): Promise<void>;
  query<R extends object>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: R[]; rowCount: number | null }>;
  end(): Promise<void>;
  on(event: 'error', listener: (error: Error) => void): unknown;
}

/** A key column of the row being swapped, compared as `uuid` or as `text`. */
export interface SwapKey {
  readonly column: string;
  readonly value: string;
  readonly compareAs: 'uuid' | 'text';
}

/** One compare-and-set: `UPDATE table SET column = to WHERE column = from AND keys…`. */
export interface SwapSpec {
  readonly table: string;
  readonly column: string;
  readonly keys: readonly SwapKey[];
  readonly from: Uint8Array;
  readonly to: Uint8Array;
}

export interface HeldLock {
  /** The server backend the lock lives on. */
  readonly backendPid: number;
  /** Throws `ReencryptionLockLostError` unless this session, on the same backend, still holds the lock. */
  assertHeld(): Promise<void>;
  /**
   * The compare-and-set, on the lock's session, guarded in-statement by the
   * lock. `true`: written. `false`: the bytes had changed. Throws
   * `ReencryptionLockLostError` — **with nothing written** — when the
   * statement found the lock not held or ran on another backend, and
   * whenever the session fails (then the outcome of the statement is
   * unknown, which the caller must report as such).
   */
  guardedSwap(spec: SwapSpec): Promise<boolean>;
  /** Unlocks and closes. `released: false` when the unlock could not be confirmed. */
  release(): Promise<{ released: boolean }>;
}

export class ReencryptionLockedError extends Error {
  constructor() {
    super(
      'Another re-encryption is running against this database (PostgreSQL advisory lock held). Nothing was done.',
    );
    this.name = 'ReencryptionLockedError';
  }
}

export class ReencryptionLockLostError extends Error {
  /** `true` when a write statement was in flight and its outcome is unknown. */
  readonly writeOutcomeUnknown: boolean;

  constructor(reason: string, options: { cause?: unknown; writeOutcomeUnknown?: boolean } = {}) {
    super(
      `The re-encryption lock was lost (${reason}); the run stopped and wrote nothing further.`,
      {
        cause: options.cause,
      },
    );
    this.name = 'ReencryptionLockLostError';
    this.writeOutcomeUnknown = options.writeOutcomeUnknown ?? false;
  }
}

/** The connection is pooled in a way a session lock cannot survive (R3). */
export class ReencryptionPoolerDetectedError extends Error {
  constructor(readonly evidence: string) {
    super(
      `The database connection behaves like a transaction-mode pooler (${evidence}). A session advisory lock cannot be held through one, so nothing was done. Point DATABASE_URL for this command at PostgreSQL directly or at a session-mode pooler.`,
    );
    this.name = 'ReencryptionPoolerDetectedError';
  }
}

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function quoted(identifier: string): string {
  /* v8 ignore next 3 -- identifiers are constants in EnvelopeReencryptionService */
  if (!IDENTIFIER.test(identifier)) {
    throw new Error(`Refusing an unexpected SQL identifier: ${identifier}`);
  }
  return `"${identifier}"`;
}

/** `true` when this session (`pg_backend_pid()`) holds the advisory lock. */
const HELD_HERE = `EXISTS (
  SELECT 1 FROM pg_locks
  WHERE locktype = 'advisory' AND granted
    AND pid = pg_backend_pid()
    AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
    AND classid = $1::int4::oid AND objid = $2::int4::oid AND objsubid = 2
)`;

const LOCK_KEY = [REENCRYPTION_LOCK_CLASS, REENCRYPTION_LOCK_OBJECT] as const;

function bytes(view: Uint8Array): Buffer {
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength);
}

function pidOf(rows: readonly { pid?: unknown }[]): number | null {
  const pid = rows[0]?.pid;
  return typeof pid === 'number' ? pid : null;
}

@Injectable()
export class ReencryptionLock {
  private readonly url: string;

  constructor(config: ConfigService) {
    this.url = config.env.DATABASE_URL;
  }

  /** The R8 bounds. Overridden only by tests that need them short. */
  protected timeouts(): LockTimeouts {
    return DEFAULT_LOCK_TIMEOUTS;
  }

  /** A dedicated connection with the R8 bounds. Overridden by the pooling tests. */
  protected createClient(): LockSessionClient {
    const timeouts = this.timeouts();
    return new Client({
      connectionString: this.url,
      connectionTimeoutMillis: timeouts.connectMs,
      query_timeout: timeouts.queryMs,
      keepAlive: true,
      keepAliveInitialDelayMillis: timeouts.keepAliveInitialDelayMs,
      application_name: 'medora-reencrypt-lock',
    }) as unknown as LockSessionClient;
  }

  /**
   * The held lock, or `null` when another session holds it. Throws
   * `ReencryptionPoolerDetectedError` when the connection is shared by a
   * pooler, and lets a connection or timeout error through — in every
   * throwing case the client is closed and no lock is left behind by this
   * code (a lock the pooler kept on a server connection is reported in the
   * error).
   */
  async acquire(identity?: LockIdentity): Promise<HeldLock | null> {
    const client = this.createClient();
    // An error event after connect (server restart, network) must not
    // crash the process; the next statement on the session fails instead.
    client.on('error', () => undefined);
    await client.connect();

    let locked = false;
    let lockedOn: number | null = null;
    try {
      // Server-side bounds, set in their own statement rather than as
      // startup parameters, which a session-mode PgBouncer would refuse.
      // The run's identity goes in the same statement, **before** the lock
      // is taken, so a session seen holding the lock always names its run
      // (S4) — there is no moment when it holds the lock anonymously.
      const setup = await client.query<{ pid: number }>(
        `SELECT pg_backend_pid() AS pid,
                set_config('statement_timeout', $1, false) AS st,
                set_config('lock_timeout', $2, false) AS lt,
                set_config('application_name', $3, false) AS app`,
        [
          this.timeouts().statement,
          this.timeouts().rowLock,
          identity === undefined ? 'medora-reencrypt-lock' : lockApplicationName(identity),
        ],
      );
      const pid = pidOf(setup.rows);
      /* v8 ignore next -- pg_backend_pid() always answers */
      if (pid === null) throw new Error('pg_backend_pid() returned nothing');

      // A brand-new connection cannot already hold the lock — unless a
      // pooler handed it a server session another client took it on.
      const already = await client.query<{ pid: number; held: boolean }>(
        `SELECT pg_backend_pid() AS pid, ${HELD_HERE} AS held`,
        LOCK_KEY,
      );
      if (already.rows[0]?.held === true) {
        throw new ReencryptionPoolerDetectedError(
          'a new connection already holds the advisory lock, so it shares a server session with another client',
        );
      }
      if (pidOf(already.rows) !== pid) {
        throw new ReencryptionPoolerDetectedError(
          'consecutive statements ran on different server backends',
        );
      }

      const taken = await client.query<{ pid: number; locked: boolean }>(
        'SELECT pg_backend_pid() AS pid, pg_try_advisory_lock($1::int4, $2::int4) AS locked',
        LOCK_KEY,
      );
      locked = taken.rows[0]?.locked === true;
      lockedOn = pidOf(taken.rows);
      if (pidOf(taken.rows) !== pid) {
        throw new ReencryptionPoolerDetectedError(
          'the lock was taken on a different server backend than the one the session started on',
        );
      }
      if (!locked) {
        await closeQuietly(client);
        return null;
      }

      // Independent connections must never land on the lock holder's
      // backend. Through a transaction-mode pooler with the lock holder
      // idle, one usually does — usually, not always: this detection is
      // best effort, and the pid-bound write guard is what makes a pooled
      // run safe when it is missed.
      for (let attempt = 0; attempt < AFFINITY_PROBES; attempt++) {
        const probe = this.createClient();
        probe.on('error', () => undefined);
        try {
          await probe.connect();
          const seen = await probe.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
          if (pidOf(seen.rows) === pid) {
            throw new ReencryptionPoolerDetectedError(
              'a second connection was given the lock holder’s server backend',
            );
          }
        } finally {
          await closeQuietly(probe);
        }
      }

      const held = new Session(client, pid);
      try {
        await held.assertHeld();
      } catch (error) {
        // Moments after taking the lock, a statement ran on another backend
        // (or found no lock): the connection is pooled, not lost. Seen with
        // a real PgBouncer in transaction mode when an idle server
        // connection answered the probe.
        throw error instanceof ReencryptionLockLostError
          ? new ReencryptionPoolerDetectedError(
              'right after the lock was taken, the session answered from a different server backend',
            )
          : error;
      }
      return held;
    } catch (error) {
      let orphaned: number | null = null;
      if (locked) {
        // Undo the lock. Through a transaction-mode pooler the unlock may
        // land on another backend (it then answers `false`), so it is
        // retried; if it never reaches the backend that holds the lock,
        // that backend is named so an operator can end it.
        orphaned = lockedOn;
        for (let attempt = 0; attempt < UNLOCK_ATTEMPTS && orphaned !== null; attempt++) {
          const result = await client
            .query<{ unlocked: boolean }>(
              'SELECT pg_advisory_unlock($1::int4, $2::int4) AS unlocked',
              LOCK_KEY,
            )
            .catch(() => null);
          if (result === null) break;
          if (result.rows[0]?.unlocked === true) orphaned = null;
        }
      }
      await closeQuietly(client);
      throw orphaned !== null && error instanceof ReencryptionPoolerDetectedError
        ? new ReencryptionPoolerDetectedError(
            `${error.evidence}; the lock it took could not be released and remains on server backend ${String(orphaned)} — end it with SELECT pg_terminate_backend(${String(orphaned)}) or let the pooler recycle that connection`,
          )
        : error;
    }
  }

  /** Whether any session in this database holds the lock now. */
  async isHeldAnywhere(): Promise<boolean> {
    return (await this.holder()).held;
  }

  /**
   * Who holds the lock now (S4): the run id and mode its session announced
   * in `application_name`, read from `pg_stat_activity` for the backend
   * `pg_locks` names. A holder whose name is not one this code wrote — an
   * older build, or a row this role may not read — is reported with
   * `runId: null`, and `--status` then assumes nothing about it.
   */
  async holder(): Promise<LockHolder> {
    const client = this.createClient();
    client.on('error', () => undefined);
    try {
      await client.connect();
      const result = await client.query<{ application_name: string | null }>(
        `SELECT a.application_name
         FROM pg_locks l
         LEFT JOIN pg_stat_activity a ON a.pid = l.pid
         WHERE l.locktype = 'advisory' AND l.granted
           AND l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
           AND l.classid = $1::int4::oid AND l.objid = $2::int4::oid AND l.objsubid = 2
         LIMIT 1`,
        LOCK_KEY,
      );
      const row = result.rows[0];
      if (row === undefined) return { held: false, runId: null, mode: null };
      const identity = parseLockApplicationName(row.application_name);
      return { held: true, runId: identity?.runId ?? null, mode: identity?.mode ?? null };
    } finally {
      await closeQuietly(client);
    }
  }
}

class Session implements HeldLock {
  private broken = false;

  constructor(
    private readonly client: LockSessionClient,
    readonly backendPid: number,
  ) {
    // The connection failing between statements (the server terminated the
    // backend, the network dropped) means the lock is gone. The next
    // statement then fails without being sent — so a write is known not to
    // have happened.
    client.on('error', () => {
      this.broken = true;
    });
  }

  async assertHeld(): Promise<void> {
    const rows = await this.run<{ pid: number; held: boolean }>(
      `SELECT pg_backend_pid() AS pid, ${HELD_HERE} AS held`,
      [...LOCK_KEY],
      false,
    );
    this.checkPid(rows, false);
    if (rows[0]?.held !== true) {
      this.broken = true;
      throw new ReencryptionLockLostError('this session no longer holds it');
    }
  }

  async guardedSwap(spec: SwapSpec): Promise<boolean> {
    // $5: the backend that took the lock. The guard admits the write only
    // there — not on any backend that happens to hold the lock — so even a
    // statement a pooler routes elsewhere cannot write (R2, R3).
    const values: unknown[] = [...LOCK_KEY, bytes(spec.to), bytes(spec.from), this.backendPid];
    const conditions = spec.keys.map((key) => {
      values.push(key.value);
      const placeholder = `$${String(values.length)}`;
      return key.compareAs === 'uuid'
        ? `${quoted(key.column)} = ${placeholder}::uuid`
        : `${quoted(key.column)}::text = ${placeholder}`;
    });
    const column = quoted(spec.column);

    const rows = await this.run<{ pid: number; held: boolean; updated: number }>(
      `WITH guard AS (
              SELECT pg_backend_pid() AS pid,
                     (pg_backend_pid() = $5::int AND ${HELD_HERE}) AS held
            ),
            swapped AS (
              UPDATE ${quoted(spec.table)} SET ${column} = $3
              WHERE ${column} = $4 AND ${conditions.join(' AND ')}
                AND (SELECT held FROM guard)
              RETURNING 1
            )
       SELECT (SELECT pid FROM guard) AS pid,
              (SELECT held FROM guard) AS held,
              (SELECT count(*) FROM swapped)::int AS updated`,
      values,
      true,
    );
    // Both checks below come from the statement that would have written:
    // `held = false` means its UPDATE matched nothing, by construction.
    this.checkPid(rows, false);
    if (rows[0]?.held !== true) {
      this.broken = true;
      throw new ReencryptionLockLostError('a write found the lock not held; nothing was written');
    }
    return (rows[0]?.updated ?? 0) === 1;
  }

  async release(): Promise<{ released: boolean }> {
    let released = false;
    if (!this.broken) {
      try {
        const result = await this.client.query<{ pid: number; unlocked: boolean }>(
          'SELECT pg_backend_pid() AS pid, pg_advisory_unlock($1::int4, $2::int4) AS unlocked',
          [...LOCK_KEY],
        );
        released = result.rows[0]?.unlocked === true && pidOf(result.rows) === this.backendPid;
      } catch {
        // Closing the connection below ends the session, and the lock with it.
      }
    }
    await closeQuietly(this.client);
    return { released };
  }

  /** One statement on the lock session; any failure is a lost lock (fail closed). */
  private async run<R extends object>(
    text: string,
    values: readonly unknown[],
    isWrite: boolean,
  ): Promise<R[]> {
    if (this.broken) throw new ReencryptionLockLostError('the lock session already failed');
    try {
      return (await this.client.query<R>(text, values)).rows;
    } catch (error) {
      this.broken = true;
      // Known unwritten only on reliable evidence that PostgreSQL rejected
      // the statement before commit; everything else is unknown (R6, A1).
      const definite = statementFailureOutcome(error) === 'rolled-back';
      throw new ReencryptionLockLostError(
        definite
          ? 'a statement on the lock session failed'
          : 'the lock session failed or timed out',
        { cause: error, writeOutcomeUnknown: isWrite && !definite },
      );
    }
  }

  private checkPid(rows: readonly { pid?: unknown }[], isWrite: boolean): void {
    if (pidOf(rows) !== this.backendPid) {
      this.broken = true;
      throw new ReencryptionLockLostError(
        'a statement ran on a different server backend — a pooler is moving the session',
        { writeOutcomeUnknown: isWrite },
      );
    }
  }
}

/**
 * Whether a failed statement on the lock session is **known** not to have
 * committed (review finding A1). Conservative by construction: anything
 * that is not reliable evidence of a pre-commit rejection is `'unknown'`.
 *
 * - `'rolled-back'`: an `ErrorResponse` with severity exactly `ERROR` and a
 *   SQLSTATE outside classes 08 and 57. An `ERROR` aborts the statement's
 *   implicit transaction; PostgreSQL turns a failure after the commit
 *   record into `PANIC`, never `ERROR`. Typical: `55P03` (`lock_timeout`),
 *   `23505`, `40P01`.
 * - `'unknown'`:
 *   - `FATAL` and `PANIC` — the backend is going away, and a termination
 *     can arrive after the commit but before the client sees completion;
 *   - SQLSTATE class `08` (connection exception) and class `57` (operator
 *     intervention: shutdown, termination, and also `57014`
 *     query_canceled, which is how `statement_timeout` reports) — treated as
 *     ambiguous rather than reasoned about case by case;
 *   - an error with no server response at all: a transport failure, a
 *     reset, the client-side query timeout;
 *   - a severity that is not the literal `ERROR`. `pg` exposes only the
 *     *localized* severity, so a server with translated messages makes
 *     every error `'unknown'` — over-reporting uncertainty, never hiding it.
 */
export type StatementFailureOutcome = 'rolled-back' | 'unknown';

export function statementFailureOutcome(error: unknown): StatementFailureOutcome {
  if (typeof error !== 'object' || error === null) return 'unknown';
  const { code, severity } = error as { code?: unknown; severity?: unknown };
  if (typeof code !== 'string' || !/^[0-9A-Z]{5}$/.test(code)) return 'unknown';
  if (severity !== 'ERROR') return 'unknown';
  if (code.startsWith('08') || code.startsWith('57')) return 'unknown';
  return 'rolled-back';
}

/** `end()`, bounded: a blackholed socket must not hang the command (R8). */
async function closeQuietly(client: LockSessionClient): Promise<void> {
  await Promise.race([
    client.end().catch(() => undefined),
    new Promise((resolve) => setTimeout(resolve, LOCK_RELEASE_TIMEOUT_MS).unref()),
  ]);
}
