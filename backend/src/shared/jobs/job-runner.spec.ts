import { describe, expect, it } from 'vitest';

import { inRequestScope, runInRequestScope } from '../authz/request-scope';

import { DeadLetterStore, DEAD_LETTER_CAPACITY } from './dead-letter.store';
import { JobMetricsService } from './job-metrics.service';
import { JobRunner, messageOf, type RunHooks } from './job-runner.service';
import { everyMinutes } from './job-schedule';
import { DEFAULT_RETRY } from './retry-policy';
import type { JobOutcome, RunnableJob } from './job.types';

/**
 * The run loop (RM M30.1).
 *
 * > ✅ Verify: poisoned job lands in DLQ after N retries.
 *
 * Every backoff here is instant. The delays themselves are asserted in
 * `retry-policy.spec.ts`, so sleeping through them would be testing
 * `setTimeout` — what this file asserts is what *happens* around each
 * attempt, and the delays it asked for are recorded and checked.
 */
function harness() {
  const metrics = new JobMetricsService();
  const deadLetters = new DeadLetterStore();
  const slept: number[] = [];
  const hooks: RunHooks = {
    sleep: (ms) => {
      slept.push(ms);

      return Promise.resolve();
    },
    clock: () => new Date('2026-09-21T09:00:00.000Z'),
  };

  return { runner: new JobRunner(metrics, deadLetters), metrics, deadLetters, slept, hooks };
}

function job(handler: RunnableJob['handler'], overrides: Partial<RunnableJob> = {}): RunnableJob {
  return {
    name: 'test.sweep',
    summary: 'a sweep',
    schedule: everyMinutes(5),
    retry: DEFAULT_RETRY,
    timeoutMs: 5_000,
    handler,
    ...overrides,
  };
}

describe('JobRunner', () => {
  it('records the outcome of a run that works first time', async () => {
    const { runner, metrics, hooks } = harness();
    const outcome: JobOutcome = { expired: 3, refillDueWindowDays: null };

    const report = await runner.runToCompletion(job(() => Promise.resolve(outcome)), 'schedule', hooks);

    expect(report.attempts).toBe(1);
    expect(report.outcome).toEqual(outcome);
    expect(report.deadLetter).toBeNull();

    const snapshot = metrics.snapshot('test.sweep');
    expect(snapshot.started).toBe(1);
    expect(snapshot.succeeded).toBe(1);
    expect(snapshot.lastOutcome).toEqual(outcome);
    expect(snapshot.lastRunAt?.toISOString()).toBe('2026-09-21T09:00:00.000Z');
  });

  it('retries and recovers, counting the failed attempt without dead-lettering', async () => {
    const { runner, metrics, deadLetters, slept, hooks } = harness();
    let calls = 0;

    const report = await runner.runToCompletion(
      job(() => {
        calls += 1;

        return calls === 1 ? Promise.reject(new Error('lock timeout')) : Promise.resolve({ ok: true });
      }),
      'schedule',
      hooks,
    );

    expect(report.attempts).toBe(2);
    expect(report.deadLetter).toBeNull();
    // The delay before the first retry, from the shared policy.
    expect(slept).toEqual([30_000]);
    expect(deadLetters.size).toBe(0);

    const snapshot = metrics.snapshot('test.sweep');
    expect(snapshot.failedAttempts).toBe(1);
    expect(snapshot.succeeded).toBe(1);
    // Cleared on success: a stale error beside a green run is the single
    // most misread thing on an operations screen.
    expect(snapshot.lastError).toBeNull();
  });

  it('dead-letters a poisoned job after exactly N attempts', async () => {
    const { runner, metrics, deadLetters, slept, hooks } = harness();
    let calls = 0;

    const report = await runner.runToCompletion(
      job(() => {
        calls += 1;

        return Promise.reject(new Error('still broken'));
      }),
      'schedule',
      hooks,
    );

    expect(calls).toBe(DEFAULT_RETRY.attempts);
    expect(report.outcome).toBeNull();
    expect(slept).toEqual([30_000, 60_000]);

    const [entry] = deadLetters.list();
    expect(entry?.job).toBe('test.sweep');
    expect(entry?.attempts).toBe(DEFAULT_RETRY.attempts);
    expect(entry?.error).toBe('still broken');
    expect(entry?.trigger).toBe('schedule');
    expect(metrics.snapshot('test.sweep').deadLettered).toBe(1);
  });

  it('resolves rather than throwing when the job dies', async () => {
    // A driver that propagated would turn a failed sweep into an
    // unhandled rejection inside a timer callback, which takes the
    // process down.
    const { runner, hooks } = harness();

    await expect(
      runner.runToCompletion(job(() => Promise.reject(new Error('x'))), 'schedule', hooks),
    ).resolves.toBeDefined();
  });

  it('abandons an attempt that outruns its timeout', async () => {
    const { runner, deadLetters, hooks } = harness();

    const report = await runner.runToCompletion(
      job(
        () =>
          new Promise<JobOutcome>((resolve) => {
            // Longer than the timeout below and never awaited to
            // completion; `unref` keeps it from holding the suite open.
            setTimeout(() => {
              resolve({});
            }, 5_000).unref();
          }),
        { timeoutMs: 1_000, retry: { ...DEFAULT_RETRY, attempts: 1 } },
      ),
      'schedule',
      hooks,
    );

    expect(report.deadLetter?.error).toMatch(/exceeded its 1000 ms timeout/);
    expect(deadLetters.size).toBe(1);
  });

  it('normalises a non-Error throw into a bounded message', async () => {
    // A handler that rejects with something other than an `Error` is
    // exactly what the normalisation exists for, so the rule against
    // writing one is disabled here rather than worked around — a wrapped
    // `Error` would test nothing.
    const { runner, deadLetters, hooks } = harness();

    await runner.runToCompletion(
      job(
        // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
        () => Promise.reject('a bare string'),
        { retry: { ...DEFAULT_RETRY, attempts: 1 } },
      ),
      'manual',
      hooks,
    );

    expect(deadLetters.list()[0]?.error).toBe('a bare string');
  });
});

describe('messageOf', () => {
  it('caps a long provider message', () => {
    // A Prisma error's message can run to hundreds of characters of
    // query text — unreadable on an operations screen, and the one place
    // a column value could reach a log line.
    expect(messageOf(new Error('x'.repeat(500)))).toHaveLength(301);
    expect(messageOf(new Error('x'.repeat(500)))).toMatch(/…$/);
  });

  it('collapses whitespace so a stacked message stays one line', () => {
    expect(messageOf(new Error('two\n  lines'))).toBe('two lines');
  });

  it('never returns an empty string', () => {
    expect(messageOf(new Error(''))).toBe('The job failed without a message.');
  });
});

describe('DeadLetterStore', () => {
  it('keeps the newest and drops the oldest at capacity', () => {
    const store = new DeadLetterStore();

    for (let index = 0; index < DEAD_LETTER_CAPACITY + 5; index += 1) {
      store.record({
        job: 'test.sweep',
        failedAt: new Date(),
        attempts: 3,
        error: `failure ${String(index)}`,
        correlationId: 'c',
        trigger: 'schedule',
      });
    }

    expect(store.size).toBe(DEAD_LETTER_CAPACITY);
    // Newest first, and the newest is the one being diagnosed.
    expect(store.list()[0]?.error).toBe(`failure ${String(DEAD_LETTER_CAPACITY + 4)}`);
  });

  it('takes an entry out, so a replay cannot happen twice', () => {
    const store = new DeadLetterStore();
    const entry = store.record({
      job: 'test.sweep',
      failedAt: new Date(),
      attempts: 3,
      error: 'boom',
      correlationId: 'c',
      trigger: 'schedule',
    });

    expect(store.take(entry.id)?.id).toBe(entry.id);
    expect(store.take(entry.id)).toBeNull();
    expect(store.size).toBe(0);
  });

  it('filters by job', () => {
    const store = new DeadLetterStore();
    const base = { failedAt: new Date(), attempts: 1, error: 'e', correlationId: 'c', trigger: 'schedule' } as const;
    store.record({ ...base, job: 'a.one' });
    store.record({ ...base, job: 'b.two' });

    expect(store.list('a.one')).toHaveLength(1);
    expect(store.list()).toHaveLength(2);
  });
});

// Audit F5 (#24): `attempt` is the BullMQ worker's entry point and
// `runToCompletion` the in-process loop. Called from inside a request
// store, neither may hand it to the job.
describe('JobRunner request-scope isolation (F5)', () => {
  it('runs a single attempt (the broker path) outside the caller request store', async () => {
    const { runner } = harness();
    let scoped: boolean | undefined;

    await runInRequestScope(() =>
      runner.attempt(
        job(() => {
          scoped = inRequestScope();
          return Promise.resolve({});
        }),
        { attempt: 1, trigger: 'manual', correlationId: 'c-1', now: new Date() },
      ),
    );

    expect(scoped).toBe(false);
  });

  it('runs every attempt of a run, and the backoff between them, outside it', async () => {
    const { runner } = harness();
    const scopes: boolean[] = [];
    const hooks: RunHooks = {
      sleep: () => {
        scopes.push(inRequestScope());
        return Promise.resolve();
      },
      clock: () => new Date(),
    };
    let calls = 0;

    await runInRequestScope(() =>
      runner.runToCompletion(
        job(() => {
          calls += 1;
          scopes.push(inRequestScope());
          return calls < 3 ? Promise.reject(new Error('transient')) : Promise.resolve({});
        }),
        'manual',
        hooks,
      ),
    );

    expect(scopes.length).toBeGreaterThanOrEqual(3);
    expect(scopes.every((scoped) => !scoped)).toBe(true);
  });
});
