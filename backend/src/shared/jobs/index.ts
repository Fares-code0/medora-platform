/**
 * Public API — background jobs (RM M2.3, M30.1).
 *
 * The two drivers are deliberately not exported. A module registers a
 * definition and never learns where it runs: that is what makes
 * `JOBS_DRIVER` a deployment choice rather than a code path, and it is
 * the same contract `shared/files`, `shared/mail` and `shared/outbox`
 * hold behind their own tokens.
 *
 * `InlineJobQueue` is the one exception, and only for the test harness:
 * an e2e spec that triggers a job over HTTP has to be able to await the
 * run it started, and polling a counter until it moves is a sleep with
 * extra steps. Nothing under `src/modules/` imports it — the boundary
 * zone allows this index, and `settle()` exists on the class rather than
 * on the port for exactly that reason.
 */

export {
  JOB_QUEUE,
  isRunnable,
  type BlockedJob,
  type DeadLetter,
  type JobBlocker,
  type JobContext,
  type JobDefinition,
  type JobHandler,
  type JobMetrics,
  type JobOutcome,
  type JobQueuePort,
  type JobSchedule,
  type JobTrigger,
  type RetryPolicy,
  type RunnableJob,
} from './job.types';

export {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  cronPatternFor,
  dailyAtUtc,
  describeSchedule,
  everyHours,
  everyMinutes,
  nextRunAfter,
} from './job-schedule';

export { DEFAULT_RETRY, FREQUENT_RETRY, backoffDelayMs } from './retry-policy';

export { JobRegistry } from './job-registry.service';
export { JobMetricsService } from './job-metrics.service';
export { DeadLetterStore, DEAD_LETTER_CAPACITY } from './dead-letter.store';
export { JobRunner, messageOf, REAL_HOOKS, type RunHooks, type RunReport } from './job-runner.service';
export { InlineJobQueue } from './inline-job-queue';
export { JobsKernelModule } from './jobs-kernel.module';
