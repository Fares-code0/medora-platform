/**
 * The jobs screen and its two actions (RM M30.1).
 *
 * A projection over the kernel — the registry, the metrics and the
 * dead-letter list — plus the audit rows the two mutations owe. It holds
 * no state of its own, which is what keeps "what is registered" a single
 * answer rather than two that can disagree.
 */

import { Inject, Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import { ConfigService } from '../../../config';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import {
  DeadLetterStore,
  describeSchedule,
  isRunnable,
  JOB_QUEUE,
  JobMetricsService,
  JobRegistry,
  nextRunAfter,
  type DeadLetter,
  type JobDefinition,
  type JobMetrics,
  type JobQueuePort,
} from '../../../shared/jobs';
import type {
  DeadLetterView,
  JobMetricsView,
  JobTriggerView,
  JobsView,
  JobView,
} from '../dto/jobs.dto';

@Injectable()
export class JobsService {
  constructor(
    private readonly registry: JobRegistry,
    private readonly metrics: JobMetricsService,
    private readonly deadLetters: DeadLetterStore,
    private readonly config: ConfigService,
    @Inject(JOB_QUEUE) private readonly queue: JobQueuePort,
    @Inject(AUDIT_DISPATCHER) private readonly audit: AuditDispatcher,
  ) {}

  overview(now: Date = new Date()): JobsView {
    return {
      driver: this.queue.driver,
      enabled: this.config.jobsEnabled,
      // Always true today: both the counters and the dead letters are
      // in-memory. It is a field rather than a constant because the day
      // one of them moves to Redis or a table, the screen stops
      // disclaiming — and nothing else has to change.
      processLocal: true,
      jobs: this.registry.all().map((job) => this.toView(job, now)),
    };
  }

  deadLetterList(job?: string): readonly DeadLetterView[] {
    return this.deadLetters.list(job).map(toDeadLetterView);
  }

  /**
   * Runs a registered job now, outside its schedule.
   *
   * Answers as soon as the driver has accepted it. Waiting for the
   * handler would put a retention sweep's ten-minute timeout on an HTTP
   * request, and the contract's own rule is that no synchronous endpoint
   * may exceed thirty seconds (API §0).
   */
  async trigger(user: AuthenticatedUser, name: string): Promise<JobTriggerView> {
    const job = this.registry.find(name);

    if (job === null) throw AppException.notFound('No such background job');

    if (!isRunnable(job)) {
      // 409 rather than 404: the job is registered and visible on this
      // very screen, so "not found" would be false, and 422 would blame
      // the caller for asking about something the platform advertises.
      throw new AppException(409, {
        message: 'This job is registered but blocked, so it cannot be run.',
        code: 'job_blocked',
        detail: job.blocked.reason,
      });
    }

    await this.audit.record({
      action: 'job.trigger',
      actor: { userId: user.id, role: user.role, sessionId: user.sessionId },
      entityType: 'job',
      entityId: name,
    });

    await this.queue.enqueue(name, 'manual');

    return { job: name, accepted: true };
  }

  /**
   * Re-runs a dead letter.
   *
   * The entry is **taken** rather than copied, so a replayed failure
   * leaves the list. A second operator looking at the same screen a
   * moment later must not be able to replay it again.
   */
  async replay(user: AuthenticatedUser, id: string): Promise<JobTriggerView> {
    const entry = this.deadLetters.find(id);

    if (entry === null) throw AppException.notFound('No such dead letter');

    if (this.registry.findRunnable(entry.job) === null) {
      throw new AppException(409, {
        message: 'The job this failure belongs to is no longer runnable.',
        code: 'job_blocked',
      });
    }

    await this.audit.record({
      action: 'job.replay',
      actor: { userId: user.id, role: user.role, sessionId: user.sessionId },
      entityType: 'job',
      entityId: entry.job,
      metadata: { deadLetterId: id, originalTrigger: entry.trigger },
    });

    this.deadLetters.take(id);
    await this.queue.enqueue(entry.job, 'replay');

    return { job: entry.job, accepted: true };
  }

  private toView(job: JobDefinition, now: Date): JobView {
    const metrics = this.metrics.snapshot(job.name);

    if (!isRunnable(job)) {
      return {
        name: job.name,
        summary: job.summary,
        schedule: describeSchedule(job.schedule),
        state: 'blocked',
        blocked: job.blocked,
        // Null, not a date. A blocked job has a declared cadence and no
        // next run, and printing one would be a promise nothing keeps.
        nextRunAt: null,
        retry: null,
        metrics: toMetricsView(metrics),
      };
    }

    return {
      name: job.name,
      summary: job.summary,
      schedule: describeSchedule(job.schedule),
      state: 'runnable',
      // The instant the schedule names, whether or not this instance is
      // the one that will fire it — `enabled` on the envelope is what
      // says that, and conflating the two would leave an operator on a
      // request-serving replica thinking the sweep is never due.
      nextRunAt: nextRunAfter(job.schedule, now).toISOString(),
      retry: { attempts: job.retry.attempts, backoff: job.retry.backoff },
      metrics: toMetricsView(metrics),
    };
  }
}

function toMetricsView(metrics: JobMetrics): JobMetricsView {
  return {
    started: metrics.started,
    succeeded: metrics.succeeded,
    failedAttempts: metrics.failedAttempts,
    deadLettered: metrics.deadLettered,
    lastRunAt: metrics.lastRunAt?.toISOString() ?? null,
    lastDurationMs: metrics.lastDurationMs,
    lastOutcome: metrics.lastOutcome,
    lastError: metrics.lastError,
  };
}

function toDeadLetterView(entry: DeadLetter): DeadLetterView {
  return {
    id: entry.id,
    job: entry.job,
    failedAt: entry.failedAt.toISOString(),
    attempts: entry.attempts,
    error: entry.error,
    correlationId: entry.correlationId,
    trigger: entry.trigger,
  };
}
