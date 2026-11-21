import { DatabaseError } from 'pg';
import { describe, expect, it } from 'vitest';

import { runReencryptCommand } from '../../cli/reencrypt-envelopes.command';
import { ConfigService, type Env } from '../../config';
import type { AuditEvent, TransactionalAuditWriter } from '../audit';
import type { PrismaService } from '../database';

import {
  EnvelopeReencryptionService,
  REENCRYPTION_ACTIONS,
  ReencryptionFailedError,
  type RunAuditRow,
  summarizeRuns,
} from './envelope-reencryption.service';
import { EnvelopeService } from './envelope.service';
import { type LockHolder, type LockSessionClient, ReencryptionLock } from './reencryption.lock';

/**
 * `--status` (review finding S4) and the uncertain-write tally (A1),
 * without a database: the decision is `summarizeRuns`, and the command
 * is driven through `runReencryptCommand` with a service whose I/O is
 * scripted. The SQL that finds the lock holder is covered by
 * `test/envelope-key-rotation-safety.e2e-spec.ts`.
 */

const KILLED = '11111111-1111-4111-8111-111111111111';
const LATER = '22222222-2222-4222-8222-222222222222';
const DRY = '33333333-3333-4333-8333-333333333333';
const CONFIRM = '44444444-4444-4444-8444-444444444444';

const at = (minute: number) => new Date(Date.UTC(2026, 10, 7, 9, minute));
const started = (runId: string, minute: number): RunAuditRow => ({
  eventType: REENCRYPTION_ACTIONS.started,
  occurredAt: at(minute),
  payload: { runId },
});
const finished = (runId: string, minute: number, status: string): RunAuditRow => ({
  eventType: REENCRYPTION_ACTIONS.outcome,
  occurredAt: at(minute),
  payload: { runId, status },
});

const free: LockHolder = { held: false, runId: null, mode: null };
const holder = (runId: string | null, mode: 'confirm' | 'dry-run' | null): LockHolder => ({
  held: true,
  runId,
  mode,
});

/** `--status` exactly as the operator runs it, over a ledger and a lock holder. */
async function status(rows: RunAuditRow[], lockHolder: LockHolder) {
  const out: string[] = [];
  const service = {
    status: () => Promise.resolve(summarizeRuns(rows, lockHolder)),
  } as unknown as EnvelopeReencryptionService;
  const code = await runReencryptCommand(
    ['--status'],
    () => Promise.resolve({ service, close: () => Promise.resolve() }),
    { log: (line) => out.push(line), error: (line) => out.push(line) },
  );
  return { code, text: out.join('\n') };
}

describe('--status pairs the lock holder by run id (S4)', () => {
  const killed = [started(KILLED, 0)];

  it('1. a killed run stays unresolved while a new dry run holds the lock — no false exit 0', async () => {
    // The dry run has no started row: before the fix, the killed run — the
    // newest started row — was taken for the lock holder and status exited 0.
    const report = summarizeRuns(killed, holder(DRY, 'dry-run'));
    expect(report.unresolved.map((run) => run.runId)).toEqual([KILLED]);
    expect(report.activeRun).toEqual({ runId: DRY, mode: 'dry-run', hasStartedRecord: false });

    const result = await status(killed, holder(DRY, 'dry-run'));
    expect(result.code).toBe(1);
    expect(result.text).toContain(`A dry run (run ${DRY}) holds the advisory lock right now.`);
    expect(result.text).toContain(`run ${KILLED}  NO OUTCOME — ended without one`);
    expect(result.text).not.toContain('running now');
  });

  it('2. it stays unresolved while a confirm run holds the lock before its started row exists', async () => {
    const report = summarizeRuns(killed, holder(CONFIRM, 'confirm'));
    expect(report.unresolved.map((run) => run.runId)).toEqual([KILLED]);
    expect(report.activeRun?.hasStartedRecord).toBe(false);

    const result = await status(killed, holder(CONFIRM, 'confirm'));
    expect(result.code).toBe(1);
    expect(result.text).toContain('its started record is not written yet');
  });

  it('once that confirm run has written its started row, only it is "running now"', async () => {
    const rows = [...killed, started(CONFIRM, 5)];
    const report = summarizeRuns(rows, holder(CONFIRM, 'confirm'));
    expect(report.unmatched.map((run) => run.runId)).toEqual([KILLED]);
    expect(report.unresolved.map((run) => run.runId)).toEqual([KILLED]);

    const result = await status(rows, holder(CONFIRM, 'confirm'));
    expect(result.code).toBe(1);
    expect(result.text).toContain(
      `run ${CONFIRM}  no outcome yet — running now (it holds the lock)`,
    );
  });

  it('a holder that does not identify itself excludes nothing', async () => {
    const rows = [...killed, started(CONFIRM, 5)];
    const report = summarizeRuns(rows, holder(null, null));
    expect(report.unresolved.map((run) => run.runId)).toEqual([CONFIRM, KILLED]);
    expect((await status(rows, holder(null, null))).text).toContain(
      'An unidentified session holds',
    );
  });

  it('3. a later complete run supersedes the killed one — exit 0, still listed', async () => {
    const rows = [...killed, started(LATER, 5), finished(LATER, 9, 'complete')];
    const report = summarizeRuns(rows, free);
    expect(report.unmatched.map((run) => run.runId)).toEqual([KILLED]);
    expect(report.unresolved).toEqual([]);

    const result = await status(rows, free);
    expect(result.code).toBe(0);
    expect(result.text).toContain(
      `run ${KILLED}  NO OUTCOME — ended without one (SIGKILL, power loss or machine failure); superseded by a later complete run`,
    );
  });

  it('a later run that ended incomplete, failed or interrupted supersedes nothing', async () => {
    for (const outcome of ['incomplete'] as const) {
      const rows = [...killed, started(LATER, 5), finished(LATER, 9, outcome)];
      expect((await status(rows, free)).code).toBe(1);
    }
    const failed: RunAuditRow = {
      eventType: REENCRYPTION_ACTIONS.failed,
      occurredAt: at(9),
      payload: { runId: LATER, status: 'interrupted' },
    };
    expect((await status([...killed, started(LATER, 5), failed], free)).code).toBe(1);
  });

  it('4. a killed run after the last complete run is unresolved — no false exit 0', async () => {
    const rows = [started(LATER, 0), finished(LATER, 2, 'complete'), started(KILLED, 5)];
    expect((await status(rows, free)).code).toBe(1);
    expect((await status(rows, holder(DRY, 'dry-run'))).code).toBe(1);
  });

  it('with no lock holder and no killed run, status is clean', async () => {
    const rows = [started(LATER, 0), finished(LATER, 2, 'complete')];
    const result = await status(rows, free);
    expect(result.code).toBe(0);
    expect(result.text).toContain('No re-encryption holds the advisory lock right now.');
  });
});

// ── A1 through the real service ─────────────────────────────────────────

const K1 = Buffer.alloc(32, 0x61).toString('base64');
const K2 = Buffer.alloc(32, 0x62).toString('base64');

function config(current: string, previous: string[] = []): ConfigService {
  return new ConfigService({
    DATABASE_URL: 'postgresql://scripted/none',
    DATA_ENCRYPTION_KEY: current,
    DATA_ENCRYPTION_KEY_PREVIOUS: previous,
    DATA_ENCRYPTION_WRITE_FORMAT: 'legacy',
  } as unknown as Env);
}

/** A lock session that behaves like a direct connection and fails the write with `writeError`. */
class ScriptedLock extends ReencryptionLock {
  private nextPid = 7000;
  constructor(private readonly writeError: Error) {
    super(config(K2));
  }
  protected override createClient(): LockSessionClient {
    const pid = this.nextPid++;
    let locked = false;
    const writeError = this.writeError;
    return {
      connect: () => Promise.resolve(),
      end: () => Promise.resolve(),
      on: () => undefined,
      query: <R extends object>(text: string) => {
        const answer = (rows: object[]) =>
          Promise.resolve({ rows: rows as R[], rowCount: rows.length });
        if (text.includes('WITH guard')) return Promise.reject(writeError);
        if (text.includes('pg_try_advisory_lock')) {
          locked = true;
          return answer([{ pid, locked: true }]);
        }
        if (text.includes('pg_advisory_unlock')) return answer([{ pid, unlocked: true }]);
        if (text.includes('AS held')) return answer([{ pid, held: locked }]);
        return answer([{ pid }]);
      },
    };
  }
}

/** One TOTP row under K1, and every other column empty. */
function scriptedPrisma(value: Uint8Array): PrismaService {
  const none = () => Promise.resolve([]);
  return {
    db: {
      userCredential: {
        findMany: (args: { where: Record<string, unknown> }) =>
          Promise.resolve(
            'totpSecretEnc' in args.where && !('userId' in args.where)
              ? [{ userId: '00000000-0000-4000-8000-000000000001', totpSecretEnc: value }]
              : [],
          ),
        findUnique: () => Promise.resolve(null),
      },
      platformIntegration: { findMany: none, findUnique: () => Promise.resolve(null) },
      userIntegration: { groupBy: none, findMany: none, findUnique: () => Promise.resolve(null) },
    },
    $transaction: <T>(work: (tx: unknown) => Promise<T>) => work({}),
  } as unknown as PrismaService;
}

async function runWithFailingWrite(writeError: Error) {
  const events: AuditEvent[] = [];
  const ledger = {
    recordWithin: (_tx: unknown, event: AuditEvent) => {
      events.push(event);
      return Promise.resolve();
    },
  } as unknown as TransactionalAuditWriter;
  const sealed = new EnvelopeService(config(K1)).encrypt('JBSWY3DPEHPK3PXP');
  const service = new EnvelopeReencryptionService(
    scriptedPrisma(sealed),
    new EnvelopeService(config(K2, [K1])),
    ledger,
    new ScriptedLock(writeError),
  );
  const failure = await service.run({ dryRun: false }).then(
    () => null,
    (error: unknown) => error,
  );
  const failed = events.find((event) => event.action === REENCRYPTION_ACTIONS.failed);
  return { failure, failed };
}

function dbError(severity: string, code: string): DatabaseError {
  const error = new DatabaseError('server said no', 0, 'error');
  error.severity = severity;
  error.code = code;
  return error;
}

describe('an uncertain write is counted and reported as a lower bound (A1, R6)', () => {
  it.each([
    ['FATAL 57P01 (a termination that may follow the commit)', dbError('FATAL', '57P01')],
    ['PANIC', dbError('PANIC', 'XX000')],
    ['class 08', dbError('ERROR', '08006')],
    ['class 57', dbError('ERROR', '57014')],
    ['a transport failure', new Error('Connection terminated unexpectedly')],
  ])('%s → uncertainWrites 1, counts are lower bounds', async (_label, writeError) => {
    const { failure, failed } = await runWithFailingWrite(writeError);
    expect(failure).toBeInstanceOf(ReencryptionFailedError);
    if (!(failure instanceof ReencryptionFailedError)) return;
    expect(failure.partial).toMatchObject({ resealed: 0, uncertainWrites: 1 });
    expect(failure.message).toContain(
      'at least 0 value(s) were re-sealed (1 more write(s) may have committed',
    );
    expect(failed?.metadata).toMatchObject({ uncertainWrites: 1, countsAreLowerBounds: true });
  });

  it('an ordinary ERROR (55P03) → known unwritten: uncertainWrites 0, exact counts', async () => {
    const { failure, failed } = await runWithFailingWrite(dbError('ERROR', '55P03'));
    expect(failure).toBeInstanceOf(ReencryptionFailedError);
    if (!(failure instanceof ReencryptionFailedError)) return;
    expect(failure.partial).toMatchObject({ resealed: 0, uncertainWrites: 0 });
    expect(failure.message).toContain('failed after 0 value(s) were re-sealed');
    expect(failed?.metadata).toMatchObject({ uncertainWrites: 0, countsAreLowerBounds: false });
  });
});
