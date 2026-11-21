/**
 * Seals the registry and starts the driver (RM M30.1).
 *
 * ## Why `onApplicationBootstrap` and not `onModuleInit`
 *
 * Every module registers its own schedules from `onModuleInit`, and Nest
 * runs all of those before any `onApplicationBootstrap`. So this hook is
 * the first moment at which the registry is known to be complete —
 * sealing it earlier would reject a module that happened to initialise
 * later, and starting the driver earlier would register a partial set of
 * repeatable jobs with the broker.
 *
 * ## `JOBS_ENABLED=false` still builds the registry
 *
 * It suppresses *firing*, not declaring. The schedules are still
 * registered, still sealed, still listed by `GET /administration/jobs`
 * and still runnable on demand — which is what the e2e suite and an
 * operator debugging a sweep both need. Turning the variable off is
 * "this instance is not the one running the sweeps", not "this build has
 * no jobs".
 */

import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';

import { ConfigService } from '../../config';

import { JobRegistry } from './job-registry.service';
import { describeSchedule } from './job-schedule';
import { isRunnable, JOB_QUEUE, type JobQueuePort } from './job.types';

@Injectable()
export class JobsBootstrap implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('Jobs');

  constructor(
    private readonly registry: JobRegistry,
    private readonly config: ConfigService,
    @Inject(JOB_QUEUE) private readonly queue: JobQueuePort,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.registry.seal();

    const jobs = this.registry.all();
    const blocked = jobs.filter((job) => !isRunnable(job));

    this.logger.log(
      {
        driver: this.queue.driver,
        enabled: this.config.jobsEnabled,
        registered: jobs.length,
        blocked: blocked.length,
      },
      'Background job registry sealed',
    );

    // Printed one per line rather than as a count, because "eleven
    // schedules registered" is not something anyone can check and
    // "audit.retention-sweep · daily at 03:10 UTC" is.
    for (const job of jobs) {
      this.logger.log(
        {
          job: job.name,
          schedule: describeSchedule(job.schedule),
          ...(isRunnable(job) ? {} : { blockedBy: job.blocked.unblockedBy }),
        },
        isRunnable(job) ? 'Job registered' : 'Job registered but blocked',
      );
    }

    if (!this.config.jobsEnabled) {
      this.logger.warn(
        'JOBS_ENABLED is off — schedules are registered but will not fire on this instance.',
      );

      return;
    }

    await this.queue.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue.stop();
  }
}
