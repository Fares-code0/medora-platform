/**
 * One run, from first attempt to dead letter (RM M30.1).
 *
 * The retry policy has two enforcers — this loop for the in-process
 * driver, and the broker for the BullMQ one — and both read the same
 * `RetryPolicy` off the same definition. What is *not* duplicated is
 * what happens around an attempt: the timeout, the metrics, the
 * PHI-safe logging and the dead letter all live here, and the BullMQ
 * driver calls `attempt()` and `deadLetter()` rather than reimplementing
 * them.
 *
 * ## A handler never sees a rejection it did not cause
 *
 * `attempt()` races the handler against its timeout and normalises
 * whatever comes back into an `Error` with a message. Nothing else in
 * the kernel touches a thrown value, so a job that rejects with a string
 * — or with a Prisma error whose `message` names a column and a value —
 * is turned into a bounded message at exactly one place.
 *
 * ## Nothing here logs an outcome's shape it has not been promised
 *
 * `JobOutcome` is scalars by contract, so the log line spreads it
 * directly. A handler that returned a row would be a type error at the
 * handler, which is the point of typing the return.
 */

import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { DeadLetterStore } from './dead-letter.store';
import { JobMetricsService } from './job-metrics.service';
import { backoffDelayMs } from './retry-policy';
import type { DeadLetter, JobOutcome, JobTrigger, RunnableJob } from './job.types';

/**
 * The two pieces of the outside world a run touches, injected so a test
 * controls both.
 *
 * Not DI providers: a spec that had to override two global tokens to
 * make a backoff finish instantly would be testing Nest. The driver
 * passes the real pair, tests pass an instant `sleep`.
 */
export interface RunHooks {
  readonly sleep: (ms: number) => Promise<void>;
  readonly clock: () => Date;
}

export const REAL_HOOKS: RunHooks = {
  sleep: (ms) =>
    new Promise((resolve) => {
      // `unref` so a pending backoff never holds the process open during
      // a shutdown — the run is abandoned, which is correct: the next
      // tick re-selects whatever it left.
      setTimeout(resolve, ms).unref();
    }),
  clock: () => new Date(),
};

export interface RunReport {
  readonly job: string;
  readonly attempts: number;
  readonly outcome: JobOutcome | null;
  readonly deadLetter: DeadLetter | null;
}

@Injectable()
export class JobRunner {
  private readonly logger = new Logger('JobRunner');

  constructor(
    private readonly metrics: JobMetricsService,
    private readonly deadLetters: DeadLetterStore,
  ) {}

  /**
   * One attempt, with its timeout, its metrics and its log line.
   *
   * Throws on failure — the caller decides whether that is a retry or a
   * dead letter, because that decision differs between the in-process
   * loop and the broker.
   */
  async attempt(
    job: RunnableJob,
    context: { attempt: number; trigger: JobTrigger; correlationId: string; now: Date },
  ): Promise<JobOutcome> {
    const startedAt = Date.now();
    this.metrics.started(job.name, context.now);

    try {
      const outcome = await this.withTimeout(job, {
        now: context.now,
        attempt: context.attempt,
        trigger: context.trigger,
        correlationId: context.correlationId,
      });
      const durationMs = Date.now() - startedAt;

      this.metrics.succeeded(job.name, durationMs, outcome);
      this.logger.log(
        {
          job: job.name,
          attempt: context.attempt,
          trigger: context.trigger,
          durationMs,
          correlationId: context.correlationId,
          outcome,
        },
        'Job attempt succeeded',
      );

      return outcome;
    } catch (error) {
      const durationMs = Date.now() - startedAt;
      const message = messageOf(error);

      this.metrics.attemptFailed(job.name, durationMs, message);
      this.logger.error(
        {
          job: job.name,
          attempt: context.attempt,
          trigger: context.trigger,
          durationMs,
          correlationId: context.correlationId,
          err: message,
        },
        'Job attempt failed',
      );

      throw error instanceof Error ? error : new Error(message);
    }
  }

  /** Files the failure and counts it. The run is over. */
  deadLetter(input: {
    job: string;
    attempts: number;
    error: unknown;
    correlationId: string;
    trigger: JobTrigger;
    failedAt: Date;
  }): DeadLetter {
    const entry = this.deadLetters.record({
      job: input.job,
      failedAt: input.failedAt,
      attempts: input.attempts,
      error: messageOf(input.error),
      correlationId: input.correlationId,
      trigger: input.trigger,
    });

    this.metrics.deadLettered(input.job);
    this.logger.error(
      {
        job: input.job,
        attempts: input.attempts,
        correlationId: input.correlationId,
        deadLetterId: entry.id,
      },
      'Job exhausted its retry policy and was dead-lettered',
    );

    return entry;
  }

  /**
   * The whole run: attempts, backoff between them, dead letter at the
   * end. This is the in-process driver's loop.
   *
   * It resolves rather than throwing even when the job dies — a driver
   * that propagated would turn a failed sweep into an unhandled
   * rejection in a timer callback, which takes the process down.
   */
  async runToCompletion(
    job: RunnableJob,
    trigger: JobTrigger,
    hooks: RunHooks = REAL_HOOKS,
    correlationId: string = randomUUID(),
  ): Promise<RunReport> {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= job.retry.attempts; attempt += 1) {
      const delay = backoffDelayMs(job.retry, attempt);

      if (delay > 0) await hooks.sleep(delay);

      try {
        const outcome = await this.attempt(job, {
          attempt,
          trigger,
          correlationId,
          now: hooks.clock(),
        });

        return { job: job.name, attempts: attempt, outcome, deadLetter: null };
      } catch (error) {
        lastError = error;
      }
    }

    const deadLetter = this.deadLetter({
      job: job.name,
      attempts: job.retry.attempts,
      error: lastError,
      correlationId,
      trigger,
      failedAt: hooks.clock(),
    });

    return { job: job.name, attempts: job.retry.attempts, outcome: null, deadLetter };
  }

  /**
   * Races the handler against its timeout.
   *
   * The timer is cleared in `finally` rather than left to `unref`,
   * because a job on a one-minute schedule would otherwise accumulate a
   * pending timer per run for the length of its own timeout.
   */
  private async withTimeout(
    job: RunnableJob,
    context: { now: Date; attempt: number; trigger: JobTrigger; correlationId: string },
  ): Promise<JobOutcome> {
    let timer: NodeJS.Timeout | undefined;

    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(
          new Error(`Job \`${job.name}\` exceeded its ${String(job.timeoutMs)} ms timeout.`),
        );
      }, job.timeoutMs);
    });

    try {
      return await Promise.race([job.handler(context), timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

/**
 * A bounded message from an unknown throw.
 *
 * Capped, because a Prisma error's message can run to several hundred
 * characters of query text — which is both unreadable on an operations
 * screen and the one place a column value could reach a log line.
 */
const MAX_ERROR_CHARS = 300;

export function messageOf(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const trimmed = raw.replaceAll(/\s+/g, ' ').trim();

  if (trimmed.length === 0) return 'The job failed without a message.';

  return trimmed.length > MAX_ERROR_CHARS ? `${trimmed.slice(0, MAX_ERROR_CHARS)}…` : trimmed;
}
