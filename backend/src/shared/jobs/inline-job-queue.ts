/**
 * The in-process driver (RM M30.1).
 *
 * One node runs the schedules on its own timers. It is the default, and
 * it is the honest default for the deployments this platform actually
 * has today: a single API container, where a broker would add an
 * operational dependency and buy nothing the timers do not already give.
 *
 * ## What it deliberately does not claim
 *
 * It does **not** coordinate across replicas. Two instances with
 * `JOBS_ENABLED=true` and this driver run every sweep twice. That is
 * survivable — every job M30.2 registers is idempotent by construction,
 * and the two drains claim their rows with `FOR UPDATE SKIP LOCKED` so a
 * double run is wasted work rather than duplicate output — but it is
 * waste, and it is the reason `BullmqJobQueue` exists. The choice is one
 * environment variable, and `GET /administration/jobs` names which
 * driver is bound so nobody has to guess.
 *
 * ## The grid is shared even though the timers are not
 *
 * Firing instants come from `nextRunAfter`, which anchors at the epoch.
 * So two instances of *this* driver at least agree on **when** a
 * fifteen-minute sweep runs, rather than drifting apart by however long
 * apart they were started — which turns "twice at the same moment,
 * second one finds nothing to claim" into the common case instead of
 * "twice, half a window apart, both find work".
 */

import { randomUUID } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';

import { runOutsideRequestScope } from '../authz/request-scope';

import { JobRegistry } from './job-registry.service';
import { JobRunner, REAL_HOOKS, type RunHooks } from './job-runner.service';
import { describeSchedule, nextRunAfter } from './job-schedule';
import type { JobQueuePort, JobTrigger, RunnableJob } from './job.types';

@Injectable()
export class InlineJobQueue implements JobQueuePort {
  readonly driver = 'inline' as const;

  private readonly logger = new Logger('InlineJobQueue');
  private readonly timers = new Map<string, NodeJS.Timeout>();
  /** In-flight runs, by job name — the overlap guard and the drain set. */
  private readonly running = new Map<string, Promise<void>>();
  private started = false;

  constructor(
    private readonly registry: JobRegistry,
    private readonly runner: JobRunner,
    private readonly hooks: RunHooks = REAL_HOOKS,
  ) {}

  start(): Promise<void> {
    if (this.started) return Promise.resolve();

    this.started = true;

    for (const job of this.registry.runnable()) {
      this.arm(job);
      this.logger.log(
        { job: job.name, schedule: describeSchedule(job.schedule) },
        'Scheduled a background job',
      );
    }

    return Promise.resolve();
  }

  async stop(): Promise<void> {
    this.started = false;

    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();

    // Drained rather than abandoned: a half-finished sweep during a
    // rolling deploy is safe (every job is idempotent), but an unsettled
    // promise after `app.close()` is an open handle a test suite hangs on.
    await Promise.allSettled([...this.running.values()]);
  }

  enqueue(name: string, trigger: JobTrigger): Promise<void> {
    const job = this.registry.findRunnable(name);

    if (job === null) {
      // Not an exception: `enqueue` is called from a timer as well as
      // from a request, and there is nobody to hand a rejection to in
      // the first case. The request path checks the registry first and
      // answers 404 itself.
      this.logger.warn({ job: name }, 'Ignored an enqueue for a job that is not runnable');

      return Promise.resolve();
    }

    this.run(job, trigger);

    return Promise.resolve();
  }

  /**
   * Awaits everything currently in flight.
   *
   * Exists for the e2e spec, which triggers a job over HTTP and then has
   * to observe what it did. The alternative — polling the metrics until
   * a counter moves — is a sleep with extra steps.
   */
  async settle(): Promise<void> {
    while (this.running.size > 0) {
      await Promise.allSettled([...this.running.values()]);
    }
  }

  private arm(job: RunnableJob): void {
    const now = this.hooks.clock();
    const at = nextRunAfter(job.schedule, now);
    const delay = Math.max(0, at.getTime() - now.getTime());

    const timer = setTimeout(() => {
      this.run(job, 'schedule');
      // Re-armed from the firing rather than from an interval, so a run
      // that overruns its window does not queue a backlog of ticks
      // behind it.
      if (this.started) this.arm(job);
    }, delay);

    timer.unref();
    this.timers.set(job.name, timer);
  }

  /**
   * Starts a run unless one is already going.
   *
   * The overlap guard is per job and per process. A fifteen-minute sweep
   * that takes twenty minutes must not have a second copy started on top
   * of it — every sweep is idempotent, so the second would be harmless
   * and useless, and two of them contending for the same rows is how a
   * slow sweep becomes a stuck one.
   */
  private run(job: RunnableJob, trigger: JobTrigger): void {
    if (this.running.has(job.name)) {
      this.logger.warn(
        { job: job.name, trigger },
        'Skipped a run because the previous one has not finished',
      );

      return;
    }

    const correlationId = randomUUID();
    // `enqueue` is called from a request for a manual run or a replay. The
    // whole chain — the run, its bookkeeping, and the re-armed timer of a
    // scheduled run — is created outside that request's store (F5, #24).
    const promise = runOutsideRequestScope(() =>
      this.runner
        .runToCompletion(job, trigger, this.hooks, correlationId)
        .then(() => undefined)
        .finally(() => {
          this.running.delete(job.name);
        }),
    );

    this.running.set(job.name, promise);
  }
}
