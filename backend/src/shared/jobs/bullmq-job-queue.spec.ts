import { Queue } from 'bullmq';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { BullmqJobQueue, QUEUE_NAME } from './bullmq-job-queue';
import { DeadLetterStore } from './dead-letter.store';
import { JobMetricsService } from './job-metrics.service';
import { JobRegistry } from './job-registry.service';
import { JobRunner } from './job-runner.service';
import { dailyAtUtc, everyMinutes } from './job-schedule';
import type { RunnableJob } from './job.types';

/**
 * The BullMQ driver, against a real broker (RM M30.1).
 *
 * ## Why this talks to Redis instead of mocking it
 *
 * The three things the driver exists to get right are all the broker's
 * behaviour, not this code's: that a repeatable schedule is *upserted*
 * rather than duplicated on restart, that a job dispatched by name
 * reaches the right handler, and that the retry policy the registry
 * declares is the one the broker applies. A mocked `Queue` would assert
 * that the right methods were called with the right arguments — which is
 * a test of this file's spelling and would pass just as happily if
 * BullMQ's semantics were not what the header assumes.
 *
 * Redis is a declared dependency of the platform (`REDIS_URL` is
 * required, and `/health` reports it), and CI runs one as a service
 * container beside Postgres for this file.
 *
 * ## The queue is obliterated around every test
 *
 * Job schedulers and failed jobs survive a process, so without this a
 * second run would inherit the first one's state and the "upsert does
 * not duplicate" assertion would pass for the wrong reason.
 */
const REDIS_URL = process.env['REDIS_URL'] ?? 'redis://localhost:6379';

function job(overrides: Partial<RunnableJob> = {}): RunnableJob {
  return {
    name: 'test.bullmq-sweep',
    summary: 'a sweep',
    schedule: everyMinutes(5),
    // One attempt by default, so a test that wants retries asks for them
    // and no test waits on a backoff it did not choose.
    retry: { attempts: 1, backoff: 'fixed', delayMs: 0, maxDelayMs: 0 },
    timeoutMs: 5_000,
    handler: () => Promise.resolve({ touched: 1 }),
    ...overrides,
  };
}

/** Polls a condition rather than sleeping a fixed time. */
async function until(
  predicate: () => boolean | Promise<boolean>,
  label: string,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(`Timed out waiting for ${label}`);
}

let inspector: Queue;

async function clean(): Promise<void> {
  await inspector.obliterate({ force: true });
}

describe('BullmqJobQueue', () => {
  beforeAll(async () => {
    inspector = new Queue(QUEUE_NAME, { connection: { url: REDIS_URL } });
    await clean();
  });

  afterAll(async () => {
    await inspector.close();
  });

  afterEach(async () => {
    await clean();
  });

  it('runs an enqueued job through a worker', async () => {
    const registry = new JobRegistry();
    const metrics = new JobMetricsService();
    const queue = new BullmqJobQueue(registry, new JobRunner(metrics, new DeadLetterStore()), REDIS_URL);
    let ran = 0;

    registry.register(
      job({
        handler: () => {
          ran += 1;

          return Promise.resolve({ touched: 1 });
        },
      }),
    );

    await queue.start();
    await queue.enqueue('test.bullmq-sweep', 'manual');
    await until(() => ran === 1, 'the worker to run the job');

    expect(metrics.snapshot('test.bullmq-sweep').succeeded).toBe(1);
    expect(queue.driver).toBe('bullmq');

    await queue.stop();
  });

  it('registers one scheduler per runnable job, and upserting does not duplicate it', async () => {
    // The restart case: `upsertJobScheduler` is keyed by the job's own
    // name, so a redeploy updates the entry rather than adding a second
    // one. Without that, every deploy would double the schedule.
    const registry = new JobRegistry();
    const queue = new BullmqJobQueue(registry, new JobRunner(new JobMetricsService(), new DeadLetterStore()), REDIS_URL);

    registry.register(job({ schedule: everyMinutes(15) }));
    registry.register(job({ name: 'test.bullmq-daily', schedule: dailyAtUtc(3, 10) }));
    registry.register({
      name: 'test.bullmq-blocked',
      summary: 'nothing behind it',
      schedule: everyMinutes(5),
      blocked: { reason: 'no artefact pipeline', unblockedBy: 'M99' },
    });

    await queue.start();
    await queue.stop();

    // A second process over the same Redis — the redeploy.
    const second = new BullmqJobQueue(registry, new JobRunner(new JobMetricsService(), new DeadLetterStore()), REDIS_URL);
    await second.start();
    await second.stop();

    const schedulers = await inspector.getJobSchedulers();
    const names = schedulers.map((entry) => entry.key).sort();

    // The blocked job is registered in the registry and deliberately
    // absent from the broker: it is never enqueued, so a repeatable
    // entry for it would be a schedule that fires into nothing.
    expect(names).toEqual(['test.bullmq-daily', 'test.bullmq-sweep']);

    const interval = schedulers.find((entry) => entry.key === 'test.bullmq-sweep');
    const daily = schedulers.find((entry) => entry.key === 'test.bullmq-daily');
    expect(Number(interval?.every)).toBe(15 * 60_000);
    // Generated from `dailyAtUtc`, not parsed — see `cronPatternFor`.
    expect(daily?.pattern).toBe('10 3 * * *');
    expect(daily?.tz).toBe('UTC');
  });

  it('applies the registry’s retry policy and dead-letters the final failure once', async () => {
    // Both halves matter. The broker owns the retry loop here, so the
    // count proves the policy crossed the boundary; and only the *last*
    // failure is a dead letter, because the intermediate ones are
    // retries the broker is about to make.
    const registry = new JobRegistry();
    const deadLetters = new DeadLetterStore();
    const metrics = new JobMetricsService();
    const queue = new BullmqJobQueue(registry, new JobRunner(metrics, deadLetters), REDIS_URL);
    let attempts = 0;

    registry.register(
      job({
        retry: { attempts: 3, backoff: 'fixed', delayMs: 10, maxDelayMs: 10 },
        handler: () => {
          attempts += 1;

          return Promise.reject(new Error('still broken'));
        },
      }),
    );

    await queue.start();
    await queue.enqueue('test.bullmq-sweep', 'manual');
    await until(() => deadLetters.size === 1, 'the job to be dead-lettered');
    // Settle: a fourth attempt would arrive after the assertion below.
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(attempts).toBe(3);
    expect(deadLetters.list()[0]?.error).toBe('still broken');
    expect(deadLetters.list()[0]?.trigger).toBe('manual');
    expect(metrics.snapshot('test.bullmq-sweep').failedAttempts).toBe(3);

    await queue.stop();
  });

  it('discards a queued job this build no longer declares', async () => {
    // Left in Redis by a previous deployment. Dropping it is right;
    // failing it would retry something with no handler for ever.
    const registry = new JobRegistry();
    const deadLetters = new DeadLetterStore();
    const queue = new BullmqJobQueue(registry, new JobRunner(new JobMetricsService(), deadLetters), REDIS_URL);

    registry.register(job());
    await queue.start();
    await inspector.add('test.bullmq-removed', { trigger: 'schedule' }, { attempts: 1 });

    await until(async () => (await inspector.getCompleted()).length > 0, 'the worker to drop it');

    expect(deadLetters.size).toBe(0);
    expect((await inspector.getFailed()).length).toBe(0);

    await queue.stop();
  });
});
