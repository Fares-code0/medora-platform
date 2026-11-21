import { Global, Module } from '@nestjs/common';

import { ConfigModule, ConfigService } from '../../config';

import { BullmqJobQueue } from './bullmq-job-queue';
import { DeadLetterStore } from './dead-letter.store';
import { InlineJobQueue } from './inline-job-queue';
import { JobMetricsService } from './job-metrics.service';
import { JobRegistry } from './job-registry.service';
import { JobRunner, REAL_HOOKS } from './job-runner.service';
import { JOB_QUEUE, type JobQueuePort } from './job.types';
import { JobsBootstrap } from './jobs-bootstrap.service';

/**
 * The job kernel (RM M30.1).
 *
 * `@Global`, like the shared kernel it is registered inside, for the
 * same reason: eight domain modules register a schedule into it and none
 * of them should have to import a kernel to do so.
 *
 * ## The driver is chosen here and nowhere else
 *
 * `JOB_QUEUE` is bound from `JOBS_DRIVER`, and the two implementations
 * never appear in another file. That is ADR-019 §2's port pattern
 * applied to the last piece of infrastructure that needed it: the
 * registry, the runner, the metrics and the administration surface are
 * written against the interface, so the difference between "timers in
 * this process" and "a broker in Redis" is one environment variable and
 * no code.
 *
 * **Inline is the default.** A platform that required Redis to boot
 * would be a platform that cannot run its own test suite without one,
 * and the schedules are all idempotent sweeps — the broker buys
 * single-firing across replicas, which a one-container deployment does
 * not need. `GET /administration/jobs` reports which is bound, so the
 * choice is never invisible.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    JobRegistry,
    JobMetricsService,
    DeadLetterStore,
    JobRunner,
    {
      provide: JOB_QUEUE,
      inject: [ConfigService, JobRegistry, JobRunner],
      useFactory: (
        config: ConfigService,
        registry: JobRegistry,
        runner: JobRunner,
      ): JobQueuePort =>
        config.jobsDriver === 'bullmq'
          ? new BullmqJobQueue(registry, runner, config.redisUrl)
          : new InlineJobQueue(registry, runner, REAL_HOOKS),
    },
    JobsBootstrap,
  ],
  exports: [JobRegistry, JobMetricsService, DeadLetterStore, JobRunner, JOB_QUEUE],
})
export class JobsKernelModule {}
