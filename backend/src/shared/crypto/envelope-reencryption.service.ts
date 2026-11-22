import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import { IntegrationId } from '../../generated/prisma/enums';
import { type AuditEvent, TransactionalAuditWriter } from '../audit';
import { PrismaService } from '../database';

import { sessionRefreshSuccessorAad } from './envelope-context';
import { EnvelopeService, type EnvelopeFormat } from './envelope.service';
import {
  type HeldLock,
  type LockHolder,
  type LockRunMode,
  ReencryptionLock,
  ReencryptionLockedError,
  ReencryptionLockLostError,
  type SwapKey,
} from './reencryption.lock';

/**
 * Re-seals every stored envelope under the current `DATA_ENCRYPTION_KEY`
 * in the configured write format (M37 — the re-encryption half of key
 * rotation; `PRODUCTION_SETUP.md` §2.1).
 *
 * `EnvelopeService` already *reads* under a previous key. This is what
 * lets the previous key be removed: it walks every column that holds an
 * envelope, opens each value, and writes it back **conforming** — under
 * the current key, in `DATA_ENCRYPTION_WRITE_FORMAT`. Run by an operator
 * through `npm run crypto:reencrypt`, never on a schedule.
 *
 * ## What "done" means (review findings F1, R1)
 *
 * A run reports `clean` — and the command exits 0 — only when **a complete
 * verification pass**, started after every write of this run, read every
 * non-null envelope in every column and found each one conforming. That is
 * a **point-in-time** result: it says nothing about a write made after the
 * pass read a row, which no scan can see. Retiring a key additionally
 * needs every envelope-writing process to have been on this configuration,
 * with old instances drained, **before the run started**
 * (`PRODUCTION_SETUP.md` §2.1) — an operational precondition this code
 * cannot check. Anything else keeps the run unclean:
 *
 * - a value no key opens (`unreadable`), in either pass;
 * - a value still under a previous key or in the other format, found by
 *   the verification pass (`nonConforming`) — which is where a row written
 *   *behind* the re-seal pass's cursor by a stale instance shows up;
 * - a **stale concurrent write**: a lost compare-and-set whose re-read
 *   found a readable, non-conforming value. That is direct evidence that
 *   some instance is still writing under an old configuration, and it can
 *   write again after this run ends, so no verification pass can retire
 *   the key while it runs. Counted as `staleWrites` and always unclean;
 * - a page scan that failed, a lost lock, or an error: the run throws
 *   (`ReencryptionFailedError`), with the partial counts, and is never
 *   reported as a result.
 *
 * ## Safe to interrupt, safe to rerun, one at a time
 *
 * - **One row, one compare-and-set.** Each write is one statement,
 *   `UPDATE … WHERE <primary key> AND <column> = <the bytes read>`. A lost
 *   compare-and-set is re-read and classified (vanished, conforming,
 *   unreadable, or stale and retried) — never assumed.
 * - **Idempotent.** A conforming envelope is skipped without a write.
 * - **An unreadable value is never written.** Its bytes stay as they are
 *   and its row id is reported.
 * - **Pages advance on the query that drives them** and stop only when
 *   that query returns nothing (review finding F7), so a row disappearing
 *   between two queries of one page cannot end a walk early.
 * - **Exclusive** (findings F6, R2, R3): the whole run, dry runs included,
 *   holds a PostgreSQL advisory lock (`ReencryptionLock`), and **every write
 *   runs on the lock's own session, guarded by the lock in the same
 *   statement** — so once the lock is lost, nothing more is written. A
 *   second run is refused with `ReencryptionLockedError`; a pooled
 *   connection that cannot hold a session lock, with
 *   `ReencryptionPoolerDetectedError`.
 * - **Interruptible** (R5): `options.signal` (the CLI wires SIGTERM and
 *   SIGINT to it) stops the run between rows, and the run then records
 *   `reencrypt_failed` with status `interrupted` and its partial counts.
 *
 * ## Audit evidence (finding F5)
 *
 * A real run writes `encryption_key.reencrypt_started` **before its first
 * write** and refuses to start if that row cannot be written; then either
 * `encryption_key.reencrypted` (status `complete` or `incomplete`, with
 * every count) or `encryption_key.reencrypt_failed` (partial counts and
 * the error's class). All three go through `TransactionalAuditWriter`,
 * which throws rather than swallowing a failed insert, so the report says
 * whether each row was actually recorded. Unavoidable limitation: the
 * ledger rows and the envelope rewrites are separate commits, so a process
 * killed outright (SIGKILL, power loss, machine failure) leaves a `started`
 * row with no outcome. `status()` (`--status`) lists exactly those. Counts
 * in a failure record are **lower bounds** when a write was in flight: its
 * statement may have committed after the connection was lost
 * (`uncertainWrites`, R6). Dry runs write nothing and are not audited.
 */

/** Pass 1, per column. */
export interface ColumnReport {
  readonly table: string;
  readonly column: string;
  /** Non-null values read. */
  readonly scanned: number;
  /** Already conforming; left untouched. */
  readonly alreadyCurrent: number;
  /** Re-sealed by this run (in a dry run: would be). */
  readonly resealed: number;
  /** Lost the compare-and-set; the re-read found another writer's conforming value. */
  readonly concurrentCurrent: number;
  /** Lost the compare-and-set; the row was deleted or its value cleared. */
  readonly vanished: number;
  /** Re-reads that found a readable, non-conforming value: a stale writer is active. */
  readonly staleWrites: number;
  /** Opened by no key in the ring; never written. */
  readonly unreadable: number;
  /** Still non-conforming after every compare-and-set attempt. */
  readonly unresolved: number;
  /** Writes whose outcome is unknown: the statement may have committed after its connection failed. */
  readonly uncertainWrites: number;
  readonly unreadableIds: readonly string[];
  readonly unresolvedIds: readonly string[];
}

/** Pass 2 (real runs only), per column. */
export interface ColumnVerification {
  readonly table: string;
  readonly column: string;
  readonly scanned: number;
  readonly conforming: number;
  readonly nonConforming: number;
  readonly unreadable: number;
  readonly nonConformingIds: readonly string[];
  readonly unreadableIds: readonly string[];
}

/** Whether each audit row was written. `null`: not attempted (dry runs). */
export interface AuditOutcome {
  readonly started: boolean | null;
  readonly outcome: boolean | null;
}

export interface ReencryptionReport {
  readonly dryRun: boolean;
  readonly runId: string;
  /** When this run took the lock — the instant the R1 preconditions must already have held. */
  readonly startedAt: string;
  /** Fingerprint of the current key, hex — identifies it without revealing it. */
  readonly currentKeyId: string;
  readonly previousKeys: number;
  readonly writeFormat: EnvelopeFormat;
  readonly columns: readonly ColumnReport[];
  /** The complete verification pass. `null` for a dry run, whose single read-only pass is the verification. */
  readonly verification: readonly ColumnVerification[] | null;
  /**
   * Values not conforming at the end: in a dry run, those that would be
   * re-sealed plus the unreadable; in a real run, what the verification
   * pass found non-conforming or unreadable.
   */
  readonly remaining: number;
  readonly staleWrites: number;
  /** `remaining === 0 && staleWrites === 0` — the only state in which a previous key may go. */
  readonly clean: boolean;
  readonly audit: AuditOutcome;
}

export interface ReencryptionOptions {
  readonly dryRun: boolean;
  readonly batchSize?: number;
  /** Aborting stops the run between rows (R5). */
  readonly signal?: AbortSignal;
}

/**
 * Totals across columns, as they stand when a run fails. When
 * `uncertainWrites > 0`, `resealed` is a lower bound: each uncertain write
 * may also have committed.
 */
export interface PartialCounts {
  readonly scanned: number;
  readonly alreadyCurrent: number;
  readonly resealed: number;
  readonly concurrentCurrent: number;
  readonly vanished: number;
  readonly staleWrites: number;
  readonly unreadable: number;
  readonly unresolved: number;
  readonly uncertainWrites: number;
}

/** The run was stopped by a signal (R5). */
export class ReencryptionInterruptedError extends Error {
  constructor(readonly signalName: string) {
    super(`Interrupted by ${signalName}`);
    this.name = 'ReencryptionInterruptedError';
  }
}

/** The run stopped before it finished. Every row it rewrote stays rewritten; a rerun is safe. */
export class ReencryptionFailedError extends Error {
  /** `true` when the cause was a signal rather than an error. */
  readonly interrupted: boolean;

  constructor(
    readonly runId: string,
    readonly partial: PartialCounts,
    /** Whether the `reencrypt_failed` audit row was written. `null`: dry run, not attempted. */
    readonly failureAudited: boolean | null,
    cause: unknown,
  ) {
    const interrupted = cause instanceof ReencryptionInterruptedError;
    const bound =
      partial.uncertainWrites > 0
        ? `at least ${String(partial.resealed)} value(s) were re-sealed (${String(partial.uncertainWrites)} more write(s) may have committed; their outcome is unknown)`
        : `${String(partial.resealed)} value(s) were re-sealed`;
    super(
      `Re-encryption run ${runId} ${interrupted ? 'was interrupted' : 'failed'} after ${bound}: ${
        cause instanceof Error ? cause.name : 'Error'
      }`,
      { cause },
    );
    this.name = 'ReencryptionFailedError';
    this.interrupted = interrupted;
  }
}

/** The `reencrypt_started` row could not be written, so nothing was rewritten. */
export class ReencryptionAuditUnavailableError extends Error {
  constructor(cause: unknown) {
    super(
      'The start of the re-encryption could not be recorded in the audit ledger, so no value was rewritten.',
      { cause },
    );
    this.name = 'ReencryptionAuditUnavailableError';
  }
}

/** A row's identifier and the envelope it holds. */
interface EnvelopeRow {
  readonly id: string;
  readonly value: Uint8Array<ArrayBuffer>;
}

/**
 * One page. `next` is the cursor for the following page, taken from the
 * query that drives paging; it is `null` only when that query returned
 * nothing — never because `rows` is short or empty.
 */
interface EnvelopePage {
  readonly rows: readonly EnvelopeRow[];
  readonly next: string | null;
}

/**
 * How to read and conditionally rewrite one envelope column. Written out
 * per column so each uses Prisma's typed client: a renamed column fails
 * `typecheck` instead of failing mid-rotation.
 */
interface EnvelopeColumn {
  readonly table: string;
  readonly column: string;
  /**
   * Per-row GCM context, for a column whose envelopes are bound to their
   * row (ADR-045: `sessions.successor_token_ct`). Absent for every column
   * sealed without one. Re-sealing binds the same context again.
   */
  readonly aad?: (id: string) => string;
  page(after: string | null, take: number): Promise<EnvelopePage>;
  /** The value now in the row, or `null` if the row is gone or the value cleared. */
  read(id: string): Promise<Uint8Array<ArrayBuffer> | null>;
  /**
   * Writes `to` only if the row still holds exactly `from` — on the lock's
   * session, guarded by the lock in the same statement (R2).
   */
  swap(
    held: HeldLock,
    id: string,
    from: Uint8Array<ArrayBuffer>,
    to: Uint8Array<ArrayBuffer>,
  ): Promise<boolean>;
}

/** Audit actions of a real run, as `status()` reads them back. */
export const REENCRYPTION_ACTIONS = {
  started: 'encryption_key.reencrypt_started',
  outcome: 'encryption_key.reencrypted',
  failed: 'encryption_key.reencrypt_failed',
} as const;

export type RunOutcome = 'complete' | 'incomplete' | 'failed' | 'interrupted';

export interface RunStatus {
  readonly runId: string;
  readonly startedAt: string;
  /** `null`: a `started` row with no outcome row. */
  readonly outcome: RunOutcome | null;
  readonly outcomeAt: string | null;
}

/** The run holding the lock now, as its lock session identifies it (S4). */
export interface ActiveRun {
  /** `null`: the holder did not identify itself — nothing is assumed about it. */
  readonly runId: string | null;
  readonly mode: LockRunMode | null;
  /** Whether its `reencrypt_started` row is among the listed runs. A dry run never has one. */
  readonly hasStartedRecord: boolean;
}

export interface StatusReport {
  /** Whether a run holds the advisory lock right now. */
  readonly lockHeldNow: boolean;
  /** The lock holder, when the lock is held. */
  readonly activeRun: ActiveRun | null;
  /** Most recent first. */
  readonly runs: readonly RunStatus[];
  /**
   * Started runs with no outcome, other than the run the lock holder
   * identifies as itself: interrupted by SIGKILL, power loss or machine
   * failure. Their partial rewrites stand; the next run counts them as
   * already current. Listed permanently — the ledger is append-only.
   */
  readonly unmatched: readonly RunStatus[];
  /**
   * The `unmatched` runs **not** followed by a later `complete` run, whose
   * verification pass re-read every value after them. These are the ones
   * that still need a `--confirm`.
   */
  readonly unresolved: readonly RunStatus[];
}

const DEFAULT_BATCH_SIZE = 200;
export const MAX_REPORTED_IDS = 20;
/** Compare-and-set attempts per row before it is reported `unresolved`. */
export const MAX_SWAP_ATTEMPTS = 3;

/** `user_integrations` has a composite key; one string identifies a row. */
const COMPOSITE_SEPARATOR = '|';

interface Tally {
  scanned: number;
  alreadyCurrent: number;
  resealed: number;
  concurrentCurrent: number;
  vanished: number;
  staleWrites: number;
  unreadable: number;
  unresolved: number;
  uncertainWrites: number;
  unreadableIds: string[];
  unresolvedIds: string[];
}

function emptyTally(): Tally {
  return {
    scanned: 0,
    alreadyCurrent: 0,
    resealed: 0,
    concurrentCurrent: 0,
    vanished: 0,
    staleWrites: 0,
    unreadable: 0,
    unresolved: 0,
    uncertainWrites: 0,
    unreadableIds: [],
    unresolvedIds: [],
  };
}

function note(ids: string[], id: string): void {
  if (ids.length < MAX_REPORTED_IDS) ids.push(id);
}

@Injectable()
export class EnvelopeReencryptionService {
  private readonly columns: readonly EnvelopeColumn[];

  constructor(
    private readonly prisma: PrismaService,
    private readonly envelope: EnvelopeService,
    private readonly ledger: TransactionalAuditWriter,
    private readonly lock: ReencryptionLock,
  ) {
    this.columns = this.describeColumns();
  }

  /** Every `table.column` a run re-seals, in the order it walks them. */
  get coveredColumns(): readonly string[] {
    return this.columns.map((column) => `${column.table}.${column.column}`);
  }

  /**
   * Throws `ReencryptionLockedError` if another run holds the lock,
   * `ReencryptionAuditUnavailableError` if a real run cannot record its
   * start, and `ReencryptionFailedError` if a run stops part-way.
   */
  async run(options: ReencryptionOptions): Promise<ReencryptionReport> {
    // The id exists before the lock does, and the lock session carries it
    // from the moment it holds the lock (S4).
    const runId = randomUUID();
    const held = await this.lock.acquire({
      runId,
      mode: options.dryRun ? 'dry-run' : 'confirm',
    });
    if (held === null) throw new ReencryptionLockedError();

    try {
      return await this.runLocked(options, held, runId);
    } finally {
      await held.release();
    }
  }

  private async runLocked(
    options: ReencryptionOptions,
    held: HeldLock,
    runId: string,
  ): Promise<ReencryptionReport> {
    const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    const startedAt = new Date().toISOString();
    const signal = options.signal;
    const tallies = this.columns.map(() => emptyTally());
    const base = {
      runId,
      startedAt,
      previousKeys: this.envelope.previousKeyCount,
      writeFormat: this.envelope.writeFormat,
    };

    let started: boolean | null = null;
    if (!options.dryRun) {
      try {
        await this.record('encryption_key.reencrypt_started', base);
      } catch (error) {
        throw new ReencryptionAuditUnavailableError(error);
      }
      started = true;
    }

    let verification: ColumnVerification[] | null = null;
    try {
      for (const [index, column] of this.columns.entries()) {
        const tally = tallies[index];
        /* v8 ignore next -- one tally per column by construction */
        if (tally === undefined) continue;
        await this.reencryptColumn(column, tally, options.dryRun, batchSize, held, signal);
      }

      if (!options.dryRun) {
        verification = [];
        for (const column of this.columns) {
          verification.push(await this.verifyColumn(column, batchSize, held, signal));
        }
      }
    } catch (failure) {
      const partial = totalsOf(tallies);
      let failureAudited: boolean | null = null;
      if (!options.dryRun) {
        failureAudited = await this.record('encryption_key.reencrypt_failed', {
          ...base,
          status: failure instanceof ReencryptionInterruptedError ? 'interrupted' : 'failed',
          errorType: failure instanceof Error ? failure.name : 'Error',
          ...partial,
          // R6: with a write in flight, every count above is a lower bound.
          countsAreLowerBounds: partial.uncertainWrites > 0,
        }).then(
          () => true,
          () => false,
        );
      }
      throw new ReencryptionFailedError(runId, partial, failureAudited, failure);
    }

    const columns = tallies.map((tally, index) => ({
      table: this.columns[index]?.table ?? '',
      column: this.columns[index]?.column ?? '',
      ...tally,
    }));
    const sum = (pick: (column: ColumnReport) => number): number =>
      columns.reduce((total, column) => total + pick(column), 0);
    const staleWrites = sum((column) => column.staleWrites);

    const remaining =
      verification === null
        ? sum((column) => column.resealed + column.unreadable)
        : verification.reduce(
            (total, column) => total + column.nonConforming + column.unreadable,
            0,
          );
    const clean = remaining === 0 && staleWrites === 0;

    let outcome: boolean | null = null;
    if (!options.dryRun && verification !== null) {
      outcome = await this.record('encryption_key.reencrypted', {
        ...base,
        status: clean ? 'complete' : 'incomplete',
        scanned: sum((column) => column.scanned),
        resealed: sum((column) => column.resealed),
        alreadyCurrent: sum((column) => column.alreadyCurrent),
        concurrentCurrent: sum((column) => column.concurrentCurrent),
        vanished: sum((column) => column.vanished),
        staleWrites,
        unreadable: sum((column) => column.unreadable),
        unresolved: sum((column) => column.unresolved),
        verifiedScanned: verification.reduce((total, column) => total + column.scanned, 0),
        verifiedNonConforming: verification.reduce(
          (total, column) => total + column.nonConforming,
          0,
        ),
        verifiedUnreadable: verification.reduce((total, column) => total + column.unreadable, 0),
        remaining,
      }).then(
        () => true,
        () => false,
      );
    }

    return {
      dryRun: options.dryRun,
      runId,
      startedAt,
      currentKeyId: this.envelope.currentKeyId,
      previousKeys: base.previousKeys,
      writeFormat: base.writeFormat,
      columns,
      verification,
      remaining,
      staleWrites,
      clean,
      audit: { started, outcome },
    };
  }

  /**
   * The recent real runs as the ledger records them (R5): each `started`
   * row paired with its outcome by `runId`, and the lock holder identified
   * by the run id its session announces (S4) — never inferred from the
   * newest `started` row. Read-only; it does not take the lock.
   */
  async status(limit = 20): Promise<StatusReport> {
    const rows = await this.prisma.auditEvent.findMany({
      where: { eventType: { in: Object.values(REENCRYPTION_ACTIONS) } },
      orderBy: { occurredAt: 'desc' },
      take: Math.min(limit * 3, 600),
      select: { eventType: true, occurredAt: true, payload: true },
    });
    return summarizeRuns(rows, await this.lock.holder(), limit);
  }

  /**
   * Inserts on the strict writer, in a transaction of its own. Throws if
   * the row was not written — the caller decides what that means.
   */
  private async record(
    action: string,
    metadata: Readonly<Record<string, string | number | boolean>>,
  ): Promise<void> {
    const event: AuditEvent = {
      action,
      // `null` is the system itself (`audit.types`): an operator at the
      // server's shell, not an account.
      actor: { userId: null, role: null },
      entityType: 'encryption_key',
      entityId: this.envelope.currentKeyId,
      metadata,
    };
    await this.prisma.$transaction((tx) => this.ledger.recordWithin(tx, event));
  }

  /** Walks a column page by page, until the driving query returns nothing. */
  private async walk(
    column: EnvelopeColumn,
    batchSize: number,
    held: HeldLock,
    visit: (row: EnvelopeRow) => Promise<void>,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    let after: string | null = null;
    for (;;) {
      stopIfAborted(signal);
      await held.assertHeld();
      const page = await column.page(after, batchSize);
      for (const row of page.rows) await visit(row);
      if (page.next === null) return;
      after = page.next;
    }
  }

  private async reencryptColumn(
    column: EnvelopeColumn,
    tally: Tally,
    dryRun: boolean,
    batchSize: number,
    held: HeldLock,
    signal: AbortSignal | undefined,
  ): Promise<void> {
    await this.walk(
      column,
      batchSize,
      held,
      async (row) => {
        // Checked per row: a signal stops the run before its next write.
        stopIfAborted(signal);
        tally.scanned++;

        let replacement: Uint8Array<ArrayBuffer> | null;
        try {
          replacement = this.envelope.reseal(row.value, column.aad?.(row.id));
        } catch {
          tally.unreadable++;
          note(tally.unreadableIds, row.id);
          return;
        }

        if (replacement === null) {
          tally.alreadyCurrent++;
          return;
        }
        if (dryRun) {
          tally.resealed++;
          return;
        }

        await this.swapWithRecheck(column, held, tally, row.id, row.value, replacement);
      },
      signal,
    );
  }

  /**
   * A compare-and-set, and — when it loses — a re-read of what is there
   * now, classified rather than assumed (finding F1).
   */
  private async swapWithRecheck(
    column: EnvelopeColumn,
    held: HeldLock,
    tally: Tally,
    id: string,
    initial: Uint8Array<ArrayBuffer>,
    initialReplacement: Uint8Array<ArrayBuffer>,
  ): Promise<void> {
    let from = initial;
    let to = initialReplacement;

    for (let attempt = 1; attempt <= MAX_SWAP_ATTEMPTS; attempt++) {
      let swapped: boolean;
      try {
        swapped = await column.swap(held, id, from, to);
      } catch (error) {
        // A failed statement may still have committed (R6), unless the
        // lock guard reported, from the statement itself, that nothing was
        // written. Either way the run stops here.
        const knownUnwritten =
          error instanceof ReencryptionLockLostError && !error.writeOutcomeUnknown;
        if (!knownUnwritten) tally.uncertainWrites++;
        throw error;
      }
      if (swapped) {
        tally.resealed++;
        return;
      }

      const now = await column.read(id);
      if (now === null) {
        tally.vanished++;
        return;
      }

      let next: Uint8Array<ArrayBuffer> | null;
      try {
        next = this.envelope.reseal(now, column.aad?.(id));
      } catch {
        tally.unreadable++;
        note(tally.unreadableIds, id);
        return;
      }

      if (next === null) {
        tally.concurrentCurrent++;
        return;
      }

      // Readable and non-conforming: someone wrote under an old key or the
      // other format after this run read the row. Recorded whatever
      // happens next — the writer is still out there.
      tally.staleWrites++;
      from = now;
      to = next;
    }

    tally.unresolved++;
    note(tally.unresolvedIds, id);
  }

  /** Read-only: every non-null value, classified. */
  private async verifyColumn(
    column: EnvelopeColumn,
    batchSize: number,
    held: HeldLock,
    signal: AbortSignal | undefined,
  ): Promise<ColumnVerification> {
    let scanned = 0;
    let conforming = 0;
    let nonConforming = 0;
    let unreadable = 0;
    const nonConformingIds: string[] = [];
    const unreadableIds: string[] = [];

    await this.walk(
      column,
      batchSize,
      held,
      (row) => {
        scanned++;
        try {
          if (this.envelope.inspect(row.value, column.aad?.(row.id)).current) {
            conforming++;
          } else {
            nonConforming++;
            note(nonConformingIds, row.id);
          }
        } catch {
          unreadable++;
          note(unreadableIds, row.id);
        }
        return Promise.resolve();
      },
      signal,
    );

    return {
      table: column.table,
      column: column.column,
      scanned,
      conforming,
      nonConforming,
      unreadable,
      nonConformingIds,
      unreadableIds,
    };
  }

  /**
   * Every column the schema stores an envelope in.
   * `test/envelope-key-rotation.e2e-spec.ts` asserts this list equals the
   * database's `bytea` columns, so a fifth encrypted column cannot be
   * added and silently left out of a rotation.
   */
  private describeColumns(): EnvelopeColumn[] {
    const db = this.prisma.db;

    return [
      {
        table: 'user_credentials',
        column: 'totp_secret_enc',
        page: async (after, take) => {
          const rows = await db.userCredential.findMany({
            where: {
              totpSecretEnc: { not: null },
              ...(after === null ? {} : { userId: { gt: after } }),
            },
            orderBy: { userId: 'asc' },
            take,
            select: { userId: true, totpSecretEnc: true },
          });
          return {
            rows: rows.flatMap((row) =>
              row.totpSecretEnc === null ? [] : [{ id: row.userId, value: row.totpSecretEnc }],
            ),
            next: rows.at(-1)?.userId ?? null,
          };
        },
        read: async (id) =>
          (
            await db.userCredential.findUnique({
              where: { userId: id },
              select: { totpSecretEnc: true },
            })
          )?.totpSecretEnc ?? null,
        swap: (held, id, from, to) =>
          held.guardedSwap({
            table: 'user_credentials',
            column: 'totp_secret_enc',
            keys: [{ column: 'user_id', value: id, compareAs: 'uuid' }],
            from,
            to,
          }),
      },
      {
        table: 'user_credentials',
        column: 'recovery_codes_enc',
        page: async (after, take) => {
          const rows = await db.userCredential.findMany({
            where: {
              recoveryCodesEnc: { not: null },
              ...(after === null ? {} : { userId: { gt: after } }),
            },
            orderBy: { userId: 'asc' },
            take,
            select: { userId: true, recoveryCodesEnc: true },
          });
          return {
            rows: rows.flatMap((row) =>
              row.recoveryCodesEnc === null
                ? []
                : [{ id: row.userId, value: row.recoveryCodesEnc }],
            ),
            next: rows.at(-1)?.userId ?? null,
          };
        },
        read: async (id) =>
          (
            await db.userCredential.findUnique({
              where: { userId: id },
              select: { recoveryCodesEnc: true },
            })
          )?.recoveryCodesEnc ?? null,
        swap: (held, id, from, to) =>
          held.guardedSwap({
            table: 'user_credentials',
            column: 'recovery_codes_enc',
            keys: [{ column: 'user_id', value: id, compareAs: 'uuid' }],
            from,
            to,
          }),
      },
      {
        table: 'platform_integrations',
        column: 'config_enc',
        page: async (after, take) => {
          const rows = await db.platformIntegration.findMany({
            where: {
              configEnc: { not: null },
              ...(after === null ? {} : { id: { gt: after } }),
            },
            orderBy: { id: 'asc' },
            take,
            select: { id: true, configEnc: true },
          });
          return {
            rows: rows.flatMap((row) =>
              row.configEnc === null ? [] : [{ id: row.id, value: row.configEnc }],
            ),
            next: rows.at(-1)?.id ?? null,
          };
        },
        read: async (id) =>
          (await db.platformIntegration.findUnique({ where: { id }, select: { configEnc: true } }))
            ?.configEnc ?? null,
        swap: (held, id, from, to) =>
          held.guardedSwap({
            table: 'platform_integrations',
            column: 'config_enc',
            keys: [{ column: 'id', value: id, compareAs: 'uuid' }],
            from,
            to,
          }),
      },
      {
        // ADR-045's refresh successor. Short-lived — honoured for 30 s
        // after a rotation, overwritten by the next one, nulled on
        // revocation — so a rotation rarely finds many. Covered anyway:
        // a successor left on an idle session is the session's live
        // token, and retiring the old key without re-sealing it would
        // turn that session's next grace retry into a revocation. A
        // rotation racing this walk loses nothing: the compare-and-set
        // sees the new ciphertext and leaves it.
        table: 'sessions',
        column: 'successor_token_ct',
        // Bound to its row (ADR-045 §AAD): re-sealed with the same context.
        aad: sessionRefreshSuccessorAad,
        page: async (after, take) => {
          const rows = await db.session.findMany({
            where: {
              successorTokenCt: { not: null },
              ...(after === null ? {} : { id: { gt: after } }),
            },
            orderBy: { id: 'asc' },
            take,
            select: { id: true, successorTokenCt: true },
          });
          return {
            rows: rows.flatMap((row) =>
              row.successorTokenCt === null ? [] : [{ id: row.id, value: row.successorTokenCt }],
            ),
            next: rows.at(-1)?.id ?? null,
          };
        },
        read: async (id) =>
          (await db.session.findUnique({ where: { id }, select: { successorTokenCt: true } }))
            ?.successorTokenCt ?? null,
        swap: (held, id, from, to) =>
          held.guardedSwap({
            table: 'sessions',
            column: 'successor_token_ct',
            keys: [{ column: 'id', value: id, compareAs: 'uuid' }],
            from,
            to,
          }),
      },
      {
        // Nothing writes ciphertext here yet (a disconnect stores `null`,
        // and no OAuth client is configured — RA-M22.1). Covered anyway:
        // the first integration that does connect must not be the column
        // a rotation forgot.
        table: 'user_integrations',
        column: 'oauth_tokens_enc',
        page: async (after, take) => {
          // Paged by **user**: a page is `take` users, then every row of
          // those users. The cursor is the last user of the first query,
          // so a row cleared between the two queries (a disconnect) only
          // shortens this page — the walk still continues past those users
          // and stops only when no user is left (finding F7). `groupBy`
          // rather than `distinct`, which Prisma applies in memory after
          // reading every remaining row (finding F8); this is GROUP BY …
          // LIMIT in SQL.
          const users = await db.userIntegration.groupBy({
            by: ['userId'],
            where: {
              oauthTokensEnc: { not: null },
              ...(after === null ? {} : { userId: { gt: after } }),
            },
            orderBy: { userId: 'asc' },
            take,
          });
          const last = users.at(-1);
          if (last === undefined) return { rows: [], next: null };

          const rows = await db.userIntegration.findMany({
            where: {
              oauthTokensEnc: { not: null },
              userId: { in: users.map((user) => user.userId) },
            },
            orderBy: [{ userId: 'asc' }, { integration: 'asc' }],
            select: { userId: true, integration: true, oauthTokensEnc: true },
          });
          return {
            rows: rows.flatMap((row) =>
              row.oauthTokensEnc === null
                ? []
                : [
                    {
                      id: `${row.userId}${COMPOSITE_SEPARATOR}${row.integration}`,
                      value: row.oauthTokensEnc,
                    },
                  ],
            ),
            next: last.userId,
          };
        },
        read: async (id) =>
          (
            await db.userIntegration.findUnique({
              where: { userId_integration: splitComposite(id) },
              select: { oauthTokensEnc: true },
            })
          )?.oauthTokensEnc ?? null,
        swap: (held, id, from, to) => {
          const { userId, integration } = splitComposite(id);
          const keys: SwapKey[] = [
            { column: 'user_id', value: userId, compareAs: 'uuid' },
            // The database label, not Prisma's name: raw SQL sees the
            // mapped enum (`ZOOM` is stored as `zoom`).
            { column: 'integration', value: INTEGRATION_DB_LABEL[integration], compareAs: 'text' },
          ];
          return held.guardedSwap({
            table: 'user_integrations',
            column: 'oauth_tokens_enc',
            keys,
            from,
            to,
          });
        },
      },
    ];
  }
}

/** One ledger row, as `status()` reads it. */
export interface RunAuditRow {
  readonly eventType: string;
  readonly occurredAt: Date;
  readonly payload: unknown;
}

/**
 * The `--status` decision, without I/O (S4), so every case is testable.
 *
 * - A run is excluded from `unmatched` **only** if the lock holder names it
 *   as itself. A holder that names no run (`runId: null`) excludes nothing.
 *   A dry run, or a confirm run that holds the lock before writing its
 *   `started` row, names a run with no `started` row — so it excludes
 *   nothing either, and an earlier killed run stays unmatched.
 * - `unresolved` keeps the documented supersession rule: an unmatched run
 *   is resolved once a run that started after it recorded `complete`.
 */
export function summarizeRuns(
  rows: readonly RunAuditRow[],
  holder: LockHolder,
  limit = 20,
): StatusReport {
  const outcomes = new Map<string, { outcome: RunOutcome; at: Date }>();
  const starts: { runId: string; at: Date }[] = [];
  for (const row of [...rows].sort((x, y) => y.occurredAt.getTime() - x.occurredAt.getTime())) {
    const payload = row.payload as Record<string, unknown> | null;
    const runId = typeof payload?.['runId'] === 'string' ? payload['runId'] : null;
    if (runId === null) continue;
    if (row.eventType === REENCRYPTION_ACTIONS.started) {
      starts.push({ runId, at: row.occurredAt });
    } else if (
      (row.eventType === REENCRYPTION_ACTIONS.outcome ||
        row.eventType === REENCRYPTION_ACTIONS.failed) &&
      !outcomes.has(runId)
    ) {
      const status = payload?.['status'];
      const outcome: RunOutcome =
        row.eventType === REENCRYPTION_ACTIONS.outcome
          ? status === 'complete'
            ? 'complete'
            : 'incomplete'
          : status === 'interrupted'
            ? 'interrupted'
            : 'failed';
      outcomes.set(runId, { outcome, at: row.occurredAt });
    }
  }

  const runs: RunStatus[] = starts.slice(0, limit).map((start) => {
    const outcome = outcomes.get(start.runId);
    return {
      runId: start.runId,
      startedAt: start.at.toISOString(),
      outcome: outcome?.outcome ?? null,
      outcomeAt: outcome?.at.toISOString() ?? null,
    };
  });

  const activeRunId = holder.held ? holder.runId : null;
  const activeRun: ActiveRun | null = holder.held
    ? {
        runId: holder.runId,
        mode: holder.mode,
        hasStartedRecord: activeRunId !== null && runs.some((run) => run.runId === activeRunId),
      }
    : null;

  const unmatched = runs.filter(
    (run) => run.outcome === null && (activeRunId === null || run.runId !== activeRunId),
  );
  const lastComplete = runs.find((run) => run.outcome === 'complete');
  const unresolved =
    lastComplete === undefined
      ? unmatched
      : unmatched.filter((run) => run.startedAt > lastComplete.startedAt);

  return { lockHeldNow: holder.held, activeRun, runs, unmatched, unresolved };
}

function totalsOf(tallies: readonly Tally[]): PartialCounts {
  const total = (pick: (tally: Tally) => number): number =>
    tallies.reduce((sum, tally) => sum + pick(tally), 0);
  return {
    scanned: total((tally) => tally.scanned),
    alreadyCurrent: total((tally) => tally.alreadyCurrent),
    resealed: total((tally) => tally.resealed),
    concurrentCurrent: total((tally) => tally.concurrentCurrent),
    vanished: total((tally) => tally.vanished),
    staleWrites: total((tally) => tally.staleWrites),
    unreadable: total((tally) => tally.unreadable),
    unresolved: total((tally) => tally.unresolved),
    uncertainWrites: total((tally) => tally.uncertainWrites),
  };
}

function stopIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    const reason: unknown = signal.reason;
    throw new ReencryptionInterruptedError(typeof reason === 'string' ? reason : 'an abort signal');
  }
}

/**
 * Prisma's `IntegrationId` names → the PostgreSQL enum labels
 * (`@map` in `01-enums.prisma`). The hardening e2e compares this with
 * `enum_range(NULL::integration_id)`.
 */
export const INTEGRATION_DB_LABEL: Readonly<Record<IntegrationId, string>> = {
  GOOGLE_CALENDAR: 'google-calendar',
  OUTLOOK: 'outlook',
  ZOOM: 'zoom',
  TEAMS: 'teams',
};

const INTEGRATION_IDS: ReadonlySet<string> = new Set(Object.values(IntegrationId));

function isIntegrationId(value: string): value is IntegrationId {
  return INTEGRATION_IDS.has(value);
}

/** The inverse of the `id` a `user_integrations` page builds. */
function splitComposite(id: string): { userId: string; integration: IntegrationId } {
  const at = id.indexOf(COMPOSITE_SEPARATOR);
  const integration = id.slice(at + 1);
  /* v8 ignore next 3 -- every id here was built by `page` from a real row */
  if (at < 0 || !isIntegrationId(integration)) {
    throw new Error(`Not a user_integrations row id: ${id}`);
  }
  return { userId: id.slice(0, at), integration };
}
