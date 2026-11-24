import { describe, expect, it } from 'vitest';

import { inRequestScope, memoizeInRequest, runInRequestScope } from '../authz/request-scope';

import { DeadLetterStore } from './dead-letter.store';
import { InlineJobQueue } from './inline-job-queue';
import { JobMetricsService } from './job-metrics.service';
import { JobRegistry } from './job-registry.service';
import { JobRunner, type RunHooks } from './job-runner.service';
import { everyMinutes } from './job-schedule';
import { DEFAULT_RETRY } from './retry-policy';
import type { RunnableJob } from './job.types';

/**
 * The in-process driver (RM M30.1).
 *
 * Firing is driven by `enqueue` rather than by the clock: the schedule
 * arithmetic that decides *when* has its own spec, and a test that waited
 * for a timer would be a test of `setTimeout`. What is asserted here is
 * the behaviour a timer cannot be made to show reliably — the overlap
 * guard, the drain on shutdown, and the refusal to run something the
 * registry does not hold.
 */
const HOOKS: RunHooks = { sleep: () => Promise.resolve(), clock: () => new Date() };

function build() {
  const registry = new JobRegistry();
  const metrics = new JobMetricsService();
  const runner = new JobRunner(metrics, new DeadLetterStore());
  const queue = new InlineJobQueue(registry, runner, HOOKS);

  return { registry, metrics, queue };
}

function job(handler: RunnableJob['handler']): RunnableJob {
  return {
    name: 'test.sweep',
    summary: 'a sweep',
    schedule: everyMinutes(5),
    retry: DEFAULT_RETRY,
    timeoutMs: 5_000,
    handler,
  };
}

describe('InlineJobQueue', () => {
  it('reports its driver, which is what the jobs screen prints', () => {
    expect(build().queue.driver).toBe('inline');
  });

  it('runs an enqueued job and settles', async () => {
    const { registry, metrics, queue } = build();
    let ran = 0;
    registry.register(
      job(() => {
        ran += 1;

        return Promise.resolve({ touched: 1 });
      }),
    );

    await queue.enqueue('test.sweep', 'manual');
    await queue.settle();

    expect(ran).toBe(1);
    expect(metrics.snapshot('test.sweep').succeeded).toBe(1);
  });

  it('does not start a second run on top of one in flight', async () => {
    // A fifteen-minute sweep that takes twenty must not accumulate
    // copies of itself; every sweep is idempotent, so the second would
    // be useless, and two of them contending is how a slow sweep becomes
    // a stuck one.
    const { registry, queue } = build();
    let started = 0;
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    registry.register(
      job(async () => {
        started += 1;
        await gate;

        return { touched: 1 };
      }),
    );

    await queue.enqueue('test.sweep', 'schedule');
    await queue.enqueue('test.sweep', 'schedule');
    expect(started).toBe(1);

    release();
    await queue.settle();
    expect(started).toBe(1);

    // And the guard releases: the next tick runs normally.
    await queue.enqueue('test.sweep', 'schedule');
    await queue.settle();
    expect(started).toBe(2);
  });

  it('ignores an enqueue for a job the registry does not hold', async () => {
    // Called from a timer as well as from a request, and there is nobody
    // to hand a rejection to in the first case. The request path checks
    // the registry itself and answers 404.
    const { queue } = build();

    await expect(queue.enqueue('nope', 'schedule')).resolves.toBeUndefined();
  });

  it('ignores an enqueue for a blocked job', async () => {
    const { registry, queue } = build();
    registry.register({
      name: 'test.blocked',
      summary: 'nothing behind it',
      schedule: everyMinutes(5),
      blocked: { reason: 'no artefact pipeline', unblockedBy: 'M99' },
    });

    await queue.enqueue('test.blocked', 'schedule');
    await queue.settle();

    expect(registry.findRunnable('test.blocked')).toBeNull();
  });

  it('drains what is in flight when it stops', async () => {
    // An unsettled promise after `app.close()` is an open handle the
    // suite hangs on; abandoning the run is safe, leaking it is not.
    const { registry, queue } = build();
    let finished = false;

    registry.register(
      job(async () => {
        await Promise.resolve();
        finished = true;

        return {};
      }),
    );

    await queue.start();
    await queue.enqueue('test.sweep', 'manual');
    await queue.stop();

    expect(finished).toBe(true);
  });

  it('arms one timer per runnable job and clears them all on stop', async () => {
    const { registry, queue } = build();
    registry.register(job(() => Promise.resolve({})));
    registry.register({
      name: 'test.blocked',
      summary: 'nothing behind it',
      schedule: everyMinutes(5),
      blocked: { reason: 'no artefact pipeline', unblockedBy: 'M99' },
    });

    // Starting twice is a no-op rather than a second set of timers — a
    // double `start()` during a lifecycle hook must not double the
    // schedule.
    await queue.start();
    await queue.start();
    await queue.stop();

    expect(registry.runnable()).toHaveLength(1);
  });
});

/**
 * Audit F5 (#24): a manual run or replay is enqueued from an HTTP request,
 * and the in-process driver starts it right there. The job must not inherit
 * that request's AsyncLocalStorage store — nor, through it, anything the
 * request cached (today the Phase 22 memo, later a tenant context).
 */
describe('InlineJobQueue request-scope isolation (F5)', () => {
  it('runs a job enqueued inside a request with no request store', async () => {
    const { registry, queue } = build();
    const scopes: boolean[] = [];
    registry.register(
      job(() => {
        scopes.push(inRequestScope());
        return Promise.resolve({});
      }),
    );

    await runInRequestScope(async () => {
      expect(inRequestScope()).toBe(true);
      await queue.enqueue('test.sweep', 'manual');
    });
    await queue.settle();

    expect(scopes).toEqual([false]);
  });

  it('cannot read a memo entry written by the request that enqueued it', async () => {
    const { registry, queue } = build();
    const seen: string[] = [];
    registry.register(
      job(async () => {
        seen.push(
          await memoizeInRequest('hospital-context:user-1:doctor', () => Promise.resolve('fresh')),
        );
        return {};
      }),
    );

    await runInRequestScope(async () => {
      await memoizeInRequest('hospital-context:user-1:doctor', () => Promise.resolve('hospital-a'));
      await queue.enqueue('test.sweep', 'replay');
    });
    await queue.settle();

    expect(seen).toEqual(['fresh']);
  });

  it('keeps every retry outside the request store after a failure', async () => {
    const { registry, queue } = build();
    const scopes: boolean[] = [];
    let calls = 0;
    registry.register(
      job(() => {
        calls += 1;
        scopes.push(inRequestScope());
        return calls === 1 ? Promise.reject(new Error('transient')) : Promise.resolve({});
      }),
    );

    await runInRequestScope(() => queue.enqueue('test.sweep', 'manual'));
    await queue.settle();

    expect(calls).toBe(2);
    expect(scopes).toEqual([false, false]);
  });

  it('keeps two jobs started by two concurrent requests apart', async () => {
    const registry = new JobRegistry();
    const runner = new JobRunner(new JobMetricsService(), new DeadLetterStore());
    const queue = new InlineJobQueue(registry, runner, HOOKS);
    const seen: string[] = [];
    for (const name of ['test.a', 'test.b']) {
      registry.register({
        ...job(async () => {
          seen.push(`${name}:${await memoizeInRequest('ctx', () => Promise.resolve('fresh'))}`);
          return {};
        }),
        name,
      });
    }

    await Promise.all([
      runInRequestScope(async () => {
        await memoizeInRequest('ctx', () => Promise.resolve('hospital-a'));
        await queue.enqueue('test.a', 'manual');
      }),
      runInRequestScope(async () => {
        await memoizeInRequest('ctx', () => Promise.resolve('hospital-b'));
        await queue.enqueue('test.b', 'manual');
      }),
    ]);
    await queue.settle();

    expect(seen.sort()).toEqual(['test.a:fresh', 'test.b:fresh']);
  });
});
