/**
 * The BullMQ driver (RM M30.1, MG §17).
 *
 * > MG §17: "BullMQ jobs: notification fan-out + channel delivery,
 * > scheduled reports, prescription-expiry and license-expiry sweeps,
 * > retention purges, backup runs, malware scans, satisfaction-survey
 * > dispatch."
 *
 * What the broker buys over `InlineJobQueue` is exactly one thing, and
 * it is the thing a second replica needs: **the schedule fires once**.
 * A job scheduler in Redis is claimed by whichever worker gets there
 * first, so three API containers produce one retention sweep rather than
 * three. Everything else — the registry, the retry numbers, the metrics,
 * the dead-letter list — is the kernel's and is identical under both
 * drivers, which is the point of the port.
 *
 * ## One queue, one worker, job name as the routing key
 *
 * Eleven queues would mean eleven Redis connections and eleven workers
 * to shut down. BullMQ routes by job name inside a queue perfectly well,
 * and the registry is already keyed by that name.
 *
 * ## Backoff is computed by this repository, not by BullMQ
 *
 * BullMQ's built-in `exponential` has no ceiling, and `RetryPolicy`
 * does. Rather than approximate one policy with the other, the worker
 * registers a custom backoff strategy that calls `backoffDelayMs` — so
 * the delays a job sees under the broker are the delays the unit test
 * asserts, computed by the same function.
 *
 * ## The failure path lands in the same two places
 *
 * A final failure writes to the kernel's `DeadLetterStore`, so the
 * administration screen reads one list whichever driver is bound, and
 * BullMQ keeps its own failed job beside it as the durable record.
 * RA-M30.1 records the gap that remains: the kernel's list is
 * process-local, so on a multi-replica deployment the screen shows the
 * failures this instance saw, and the broker's set is the complete one.
 */

import { Injectable, Logger } from '@nestjs/common';
import { Queue, Worker, type Job, type MinimalJob } from 'bullmq';

import { JobRegistry } from './job-registry.service';
import { JobRunner, messageOf } from './job-runner.service';
import { backoffDelayMs } from './retry-policy';
import { cronPatternFor, describeSchedule, nextRunAfter } from './job-schedule';
import type { JobQueuePort, JobTrigger, RunnableJob } from './job.types';

/** One queue for every job; the job's name routes it. */
export const QUEUE_NAME = 'medora-jobs';

interface JobData {
  readonly trigger: JobTrigger;
}

@Injectable()
export class BullmqJobQueue implements JobQueuePort {
  readonly driver = 'bullmq' as const;

  private readonly logger = new Logger('BullmqJobQueue');
  private queue: Queue<JobData> | null = null;
  private worker: Worker<JobData> | null = null;

  constructor(
    private readonly registry: JobRegistry,
    private readonly runner: JobRunner,
    private readonly redisUrl: string,
  ) {}

  async start(): Promise<void> {
    if (this.queue !== null) return;

    const connection = { url: this.redisUrl };

    this.queue = new Queue<JobData>(QUEUE_NAME, { connection });
    this.worker = new Worker<JobData>(QUEUE_NAME, (job) => this.process(job), {
      connection,
      settings: {
        // The ceiling `RetryPolicy` declares and BullMQ's own
        // `exponential` does not have — see the header.
        backoffStrategy: (attemptsMade: number, _type?: string, _err?: Error, job?: MinimalJob) => {
          const definition = this.registry.findRunnable(job?.name ?? '');

          if (definition === null) return 0;

          // BullMQ counts attempts *made*; `backoffDelayMs` is asked for
          // the delay before the next one, which is `made + 1`.
          return backoffDelayMs(definition.retry, attemptsMade + 1);
        },
      },
    });

    this.worker.on('failed', (job, error) => {
      if (job === undefined) return;

      const definition = this.registry.findRunnable(job.name);

      // Only the *final* failure is a dead letter; the intermediate ones
      // are retries the broker is about to make.
      if (definition === null || job.attemptsMade < definition.retry.attempts) return;

      this.runner.deadLetter({
        job: job.name,
        attempts: job.attemptsMade,
        error,
        correlationId: String(job.id ?? 'unknown'),
        trigger: job.data.trigger,
        failedAt: new Date(),
      });
    });

    this.worker.on('error', (error) => {
      // A broker that cannot be reached must not take the API down with
      // it: the jobs stop, the requests keep being served, and the
      // administration screen shows the metrics stop moving.
      this.logger.error({ err: messageOf(error) }, 'The job broker reported an error');
    });

    await this.registerSchedulers();
  }

  async stop(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    this.worker = null;
    this.queue = null;
  }

  async enqueue(name: string, trigger: JobTrigger): Promise<void> {
    const job = this.registry.findRunnable(name);

    if (job === null || this.queue === null) {
      this.logger.warn({ job: name }, 'Ignored an enqueue for a job that is not runnable');

      return;
    }

    await this.queue.add(name, { trigger }, optionsFor(job));
  }

  /**
   * Declares every runnable schedule as a BullMQ job scheduler.
   *
   * `upsertJobScheduler` is keyed by the job's own name, so a restart
   * updates the existing entry rather than adding a second one — which
   * is what stops a redeploy from doubling the schedule.
   */
  private async registerSchedulers(): Promise<void> {
    const queue = this.queue;

    if (queue === null) return;

    for (const job of this.registry.runnable()) {
      const repeat =
        job.schedule.kind === 'every'
          ? {
              every: job.schedule.ms,
              // Anchored to the same epoch grid `nextRunAfter` computes,
              // and that is not cosmetic. Without a `startDate` BullMQ
              // fires an `every` scheduler the moment it is upserted, so
              // every deploy would run all six interval sweeps at once —
              // and a rolling restart would do it again per replica.
              // With it, the broker and the in-process driver agree on
              // the instant, which is also what makes the two
              // interchangeable.
              startDate: nextRunAfter(job.schedule, new Date()),
            }
          : { pattern: cronPatternFor(job.schedule), tz: 'UTC' };

      await queue.upsertJobScheduler(job.name, repeat, {
        name: job.name,
        data: { trigger: 'schedule' as const },
        opts: optionsFor(job),
      });

      this.logger.log(
        { job: job.name, schedule: describeSchedule(job.schedule) },
        'Registered a repeatable job with the broker',
      );
    }
  }

  /**
   * One delivery. The broker owns the retry loop, so this runs a single
   * attempt and lets a throw become BullMQ's retry.
   */
  private async process(job: Job<JobData>): Promise<void> {
    const definition = this.registry.findRunnable(job.name);

    if (definition === null) {
      // A job left in Redis by a previous deployment that no longer
      // declares it. Dropping it is right; failing it would retry
      // something this build has no handler for.
      this.logger.warn({ job: job.name }, 'Discarded a queued job with no definition');

      return;
    }

    await this.runner.attempt(definition, {
      attempt: job.attemptsMade + 1,
      trigger: job.data.trigger,
      correlationId: String(job.id ?? 'unknown'),
      now: new Date(),
    });
  }
}

/**
 * Per-job broker options.
 *
 * `removeOnComplete` is bounded rather than `true`: a small tail of
 * completed jobs is what makes "did last night's sweep run" answerable
 * from the broker after a redeploy reset the in-memory metrics.
 * `removeOnFail` keeps more, because those are the ones anyone looks at.
 */
function optionsFor(job: RunnableJob) {
  return {
    attempts: job.retry.attempts,
    backoff: { type: 'custom' },
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 200 },
  };
}
