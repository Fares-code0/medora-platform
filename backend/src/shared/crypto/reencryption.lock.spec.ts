import { DatabaseError } from 'pg';
import { describe, expect, it } from 'vitest';

import { ConfigService, type Env } from '../../config';

import {
  type LockSessionClient,
  lockApplicationName,
  parseLockApplicationName,
  ReencryptionLock,
  ReencryptionLockLostError,
  statementFailureOutcome,
} from './reencryption.lock';

/**
 * The lock's decisions that need no database (review findings A1, S4).
 *
 * `DatabaseError` is `pg`'s own class, filled the way `pg-protocol` fills it
 * from an `ErrorResponse` (`severity` from field S, `code` from field C).
 * These are **classification** tests: they show what the code concludes
 * from each kind of failure. They do not reproduce a termination arriving
 * after a commit — that ordering needs a server and precise timing; what is
 * shown is that such a failure can never be counted as "known unwritten".
 */

function serverError(severity: string, code: string): DatabaseError {
  const error = new DatabaseError('server said no', 0, 'error');
  error.severity = severity;
  error.code = code;
  return error;
}

describe('statementFailureOutcome (A1)', () => {
  it.each([
    ['ERROR', '55P03', 'lock_timeout'],
    ['ERROR', '23505', 'unique_violation'],
    ['ERROR', '40P01', 'deadlock_detected'],
    ['ERROR', '22P02', 'invalid_text_representation'],
  ])('an ordinary %s %s (%s) is known rolled back', (severity, code) => {
    expect(statementFailureOutcome(serverError(severity, code))).toBe('rolled-back');
  });

  it.each([
    ['FATAL', '57P01', 'admin_shutdown / terminate'],
    ['FATAL', '57P02', 'crash_shutdown'],
    ['FATAL', '28000', 'FATAL outside class 57 too'],
    ['PANIC', 'XX000', 'PANIC'],
  ])('%s %s (%s) is unknown — the backend may have committed first', (severity, code) => {
    expect(statementFailureOutcome(serverError(severity, code))).toBe('unknown');
  });

  it.each([
    ['08006', 'connection_failure'],
    ['08003', 'connection_does_not_exist'],
    ['08P01', 'protocol_violation'],
  ])('connection-class SQLSTATE %s (%s) is unknown even at severity ERROR', (code) => {
    expect(statementFailureOutcome(serverError('ERROR', code))).toBe('unknown');
  });

  it.each([
    ['57P01', 'admin_shutdown'],
    ['57P03', 'cannot_connect_now'],
    ['57014', 'query_canceled — how statement_timeout reports'],
  ])('operator-intervention SQLSTATE %s (%s) is unknown even at severity ERROR', (code) => {
    expect(statementFailureOutcome(serverError('ERROR', code))).toBe('unknown');
  });

  it('a transport failure with no server response is unknown', () => {
    expect(statementFailureOutcome(new Error('Connection terminated unexpectedly'))).toBe(
      'unknown',
    );
    const reset = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    expect(statementFailureOutcome(reset)).toBe('unknown');
    expect(statementFailureOutcome(new Error('Query read timeout'))).toBe('unknown');
  });

  it('a localized severity is unknown — over-reporting uncertainty, never hiding it', () => {
    expect(statementFailureOutcome(serverError('ERREUR', '55P03'))).toBe('unknown');
  });

  it('anything that is not an error object is unknown', () => {
    expect(statementFailureOutcome(null)).toBe('unknown');
    expect(statementFailureOutcome('ERROR')).toBe('unknown');
    expect(statementFailureOutcome({ severity: 'ERROR' })).toBe('unknown');
  });
});

/**
 * A scripted lock session: answers the lock's own statements the way a
 * direct PostgreSQL connection would, and throws `writeError` on the
 * guarded write. Each `createClient()` is a new backend pid.
 */
class ScriptedLock extends ReencryptionLock {
  readonly sent: { text: string; values: readonly unknown[] }[] = [];
  private nextPid = 4000;
  holderName: string | null | undefined = undefined;

  constructor(private readonly writeError: Error) {
    super(new ConfigService({ DATABASE_URL: 'postgresql://scripted/none' } as unknown as Env));
  }

  protected override createClient(): LockSessionClient {
    const pid = this.nextPid++;
    let locked = false;
    const sent = this.sent;
    const holderName = (): string | null | undefined => this.holderName;
    const writeError = this.writeError;
    return {
      connect: () => Promise.resolve(),
      end: () => Promise.resolve(),
      on: () => undefined,
      query: <R extends object>(text: string, values: readonly unknown[] = []) => {
        sent.push({ text, values });
        const answer = (rows: object[]) =>
          Promise.resolve({ rows: rows as R[], rowCount: rows.length });
        if (text.includes('WITH guard')) return Promise.reject(writeError);
        if (text.includes('pg_try_advisory_lock')) {
          locked = true;
          return answer([{ pid, locked: true }]);
        }
        if (text.includes('pg_advisory_unlock')) return answer([{ pid, unlocked: true }]);
        if (text.includes('pg_stat_activity')) {
          const name = holderName();
          return answer(name === undefined ? [] : [{ application_name: name }]);
        }
        if (text.includes('AS held')) return answer([{ pid, held: locked }]);
        return answer([{ pid }]);
      },
    };
  }
}

const swap = {
  table: 'user_credentials',
  column: 'totp_secret_enc',
  keys: [
    {
      column: 'user_id',
      value: '00000000-0000-4000-8000-000000000001',
      compareAs: 'uuid' as const,
    },
  ],
  from: new Uint8Array([1]),
  to: new Uint8Array([2]),
};

async function failedWrite(error: Error): Promise<ReencryptionLockLostError> {
  const held = await new ScriptedLock(error).acquire();
  if (held === null) throw new Error('scripted lock was not taken');
  try {
    await held.guardedSwap(swap);
  } catch (caught) {
    if (caught instanceof ReencryptionLockLostError) return caught;
    throw caught;
  }
  throw new Error('the write did not fail');
}

describe('a failed guarded write is classified through the lock session (A1)', () => {
  it('ERROR 55P03: the run stops, the write is known unwritten', async () => {
    const error = await failedWrite(serverError('ERROR', '55P03'));
    expect(error.writeOutcomeUnknown).toBe(false);
  });

  it.each([
    ['FATAL 57P01', serverError('FATAL', '57P01')],
    ['PANIC XX000', serverError('PANIC', 'XX000')],
    ['ERROR 08006', serverError('ERROR', '08006')],
    ['ERROR 57014', serverError('ERROR', '57014')],
    ['a transport failure', new Error('Connection terminated unexpectedly')],
  ])('%s: the run stops, and the write is of unknown outcome', async (_label, cause) => {
    const error = await failedWrite(cause);
    expect(error.writeOutcomeUnknown).toBe(true);
  });
});

describe('the lock session names its run (S4)', () => {
  const identity = { runId: '3f1c2a9e-1d4b-4c8a-9f00-0123456789ab', mode: 'dry-run' as const };

  it('fits PostgreSQL’s 63-character application_name and round-trips', () => {
    const name = lockApplicationName(identity);
    expect(name.length).toBeLessThanOrEqual(63);
    expect(parseLockApplicationName(name)).toEqual(identity);
    expect(parseLockApplicationName(lockApplicationName({ ...identity, mode: 'confirm' }))).toEqual(
      {
        ...identity,
        mode: 'confirm',
      },
    );
  });

  it('does not take a name it did not write for an identity', () => {
    for (const name of [
      null,
      undefined,
      '',
      'medora-reencrypt-lock',
      'medora-reencrypt:not-a-uuid:confirm',
      `medora-reencrypt:${identity.runId}:apply`,
      `x-medora-reencrypt:${identity.runId}:confirm`,
    ]) {
      expect(parseLockApplicationName(name)).toBeNull();
    }
  });

  it('announces the run before it takes the lock', async () => {
    const lock = new ScriptedLock(new Error('no write in this case'));
    const held = await lock.acquire(identity);
    expect(held).not.toBeNull();
    const announce = lock.sent.findIndex((entry) =>
      entry.values.includes(lockApplicationName(identity)),
    );
    const take = lock.sent.findIndex((entry) => entry.text.includes('pg_try_advisory_lock'));
    expect(announce).toBeGreaterThanOrEqual(0);
    expect(take).toBeGreaterThan(announce);
    expect(lock.sent[announce]?.text).toContain("set_config('application_name'");
  });

  it('reports the holder’s identity, an anonymous holder, and no holder', async () => {
    const lock = new ScriptedLock(new Error('no write in this case'));
    lock.holderName = lockApplicationName(identity);
    expect(await lock.holder()).toEqual({ held: true, ...identity });
    lock.holderName = 'medora-reencrypt-lock';
    expect(await lock.holder()).toEqual({ held: true, runId: null, mode: null });
    lock.holderName = null;
    expect(await lock.holder()).toEqual({ held: true, runId: null, mode: null });
    lock.holderName = undefined;
    expect(await lock.holder()).toEqual({ held: false, runId: null, mode: null });
  });
});
