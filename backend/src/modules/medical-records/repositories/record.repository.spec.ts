import { describe, expect, it, vi } from 'vitest';

import { AppException } from '../../../common/errors/app.exception';
import type { RecordStatus } from '../../../generated/prisma/enums';
import { CacheService } from '../../../shared/cache';
import type { PrismaService } from '../../../shared/database';
import { assertEditable } from '../services/record-status.machine';

import { RecordGone, RecordRepository } from './record.repository';

/**
 * The editability check runs under the row lock (finalised-record
 * integrity).
 *
 * The race this closes: §6.4 reads the record as `active`, §6.5 commits
 * `completed`, and the edit then writes to a completed record because the
 * only check it made was on the row it read first. The fix is ordering —
 * lock the row, read its status under the lock, run the guard, then
 * write — so it is tested as ordering, against a transaction client that
 * logs every call.
 *
 * Unit rather than e2e for the same reason as the other specs here: the
 * interleaving has to be forced, and a stubbed client can hand back
 * "completed under the lock" for a record the service read as active.
 * `medical-records.e2e-spec.ts` drives the real race against PostgreSQL,
 * with a finalisation held open in a second transaction.
 */

const RECORD_ID = '44444444-4444-4444-8444-444444444444';
const ACTOR_ID = '11111111-1111-4111-8111-111111111111';

interface Harness {
  readonly repository: RecordRepository;
  /** Every client call, in order, by `model.method` (`lock` for the raw query). */
  readonly calls: string[];
  /** The raw SQL the lock issued, placeholders as `?`. */
  readonly lockSql: () => string;
}

/** The calls that change a row. Reads are allowed before the guard; these are not. */
const WRITES = /\.(create|update|updateMany|upsert|deleteMany)$/;

function harnessFor(locked: { readonly status: RecordStatus } | null): Harness {
  const calls: string[] = [];
  let sql = '';

  const log =
    (name: string, result: unknown = {}) =>
    (): Promise<unknown> => {
      calls.push(name);
      return Promise.resolve(result);
    };

  const tx = {
    $queryRaw: (strings: TemplateStringsArray): Promise<unknown> => {
      calls.push('lock');
      sql = strings.join('?');
      return Promise.resolve(locked === null ? [] : [{ id: RECORD_ID }]);
    },
    medicalRecord: {
      findUniqueOrThrow: log('medicalRecord.findUniqueOrThrow', { status: locked?.status }),
      update: log('medicalRecord.update'),
    },
    recordVersion: {
      findFirst: log('recordVersion.findFirst', null),
      create: log('recordVersion.create'),
    },
    recordNote: { create: log('recordNote.create', { id: 'note-1' }) },
    recordTimelineEvent: { create: log('recordTimelineEvent.create') },
  };

  const prisma = {
    $transaction: vi.fn((work: (client: typeof tx) => Promise<unknown>) => work(tx)),
  } as unknown as PrismaService;

  // A cache that always misses and never stores, so every lookup runs
  // the repository's own query — which is what this spec asserts on.
  const cache = new CacheService({
    mget: (keys) => Promise.resolve(keys.map(() => null)),
    write: () => Promise.resolve(),
    bump: () => Promise.resolve(),
  });

  return { repository: new RecordRepository(prisma, cache), calls, lockSql: () => sql };
}

function updateWith(repository: RecordRepository, guard: (status: RecordStatus) => void) {
  return repository.update({
    recordId: RECORD_ID,
    scalars: { chiefComplaint: 'Revised complaint' },
    children: {},
    changes: { chiefComplaint: { before: 'Original', after: 'Revised complaint' } },
    summary: 'Changed chiefComplaint',
    actorId: ACTOR_ID,
    actorName: 'Dr Test',
    guard,
  });
}

function addNoteWith(repository: RecordRepository, guard: (status: RecordStatus) => void) {
  return repository.addNote({
    recordId: RECORD_ID,
    authorId: ACTOR_ID,
    actorName: 'Dr Test',
    title: 'Progress note',
    body: 'Symptoms improving.',
    aiAssisted: false,
    guard,
  });
}

async function refusal(work: Promise<unknown>): Promise<AppException> {
  try {
    await work;
  } catch (error) {
    if (error instanceof AppException) return error;
    throw error;
  }

  throw new Error('expected the write to be refused');
}

const WRITERS = [
  ['update (§6.4)', updateWith],
  ['addNote (§6.6)', addNoteWith],
] as const;

describe.each(WRITERS)('RecordRepository.%s', (_name, write) => {
  it('locks the row before it writes anything', async () => {
    const { repository, calls } = harnessFor({ status: 'ACTIVE' });

    await write(repository, assertEditable);

    const firstWrite = calls.findIndex((call) => WRITES.test(call));
    expect(calls[0]).toBe('lock');
    expect(firstWrite).toBeGreaterThan(calls.indexOf('medicalRecord.findUniqueOrThrow'));
  });

  it('locks with FOR NO KEY UPDATE, and only a live row', async () => {
    const { repository, lockSql } = harnessFor({ status: 'DRAFT' });

    await write(repository, assertEditable);

    // NO KEY: conflicts with the status UPDATE, but not with foreign-key
    // inserts from labs or pharmacy that reference the record.
    expect(lockSql()).toMatch(/FOR NO KEY UPDATE/);
    expect(lockSql()).toMatch(/deleted_at IS NULL/);
  });

  it('hands the guard the status read under the lock', async () => {
    const { repository } = harnessFor({ status: 'DRAFT' });
    const guard = vi.fn();

    await write(repository, guard);

    expect(guard).toHaveBeenCalledTimes(1);
    expect(guard).toHaveBeenCalledWith('DRAFT');
  });

  it.each(['COMPLETED', 'ARCHIVED'] as const)(
    'refuses a record finalised to %s after the service read it, and writes nothing',
    async (status) => {
      // The service's own read saw an editable record — it passed
      // `assertEditable` there. This is the status a concurrent §6.5
      // committed before the write took its lock.
      const { repository, calls } = harnessFor({ status });

      const error = await refusal(write(repository, assertEditable));

      expect(error.getStatus()).toBe(409);
      expect(error.code).toBe('record_not_editable');
      expect(calls.filter((call) => WRITES.test(call))).toEqual([]);
    },
  );

  it('reports a row that vanished before the lock, and writes nothing', async () => {
    const { repository, calls } = harnessFor(null);
    const guard = vi.fn();

    await expect(write(repository, guard)).rejects.toBeInstanceOf(RecordGone);

    expect(guard).not.toHaveBeenCalled();
    expect(calls).toEqual(['lock']);
  });
});
