/**
 * The one registry (RM M30.1).
 *
 * > 🔒 Exit gate M30: all periodic behavior runs from the registry, none
 * > ad hoc.
 *
 * Every module that owns periodic work registers it here at boot, and
 * nothing anywhere starts a timer of its own. Five services were written
 * against that rule before this file existed and say so in their own
 * headers — `OrphanSweepService`, `PrescriptionSweepService`,
 * `AuditRetentionService`, `NotificationDispatchService` and
 * `NotificationDeliveryService` each state that they do the work and
 * that M30 owns when it runs.
 *
 * ## Registration is validated, and then it is sealed
 *
 * A duplicate name is rejected rather than merged: two definitions under
 * one name is a copy-paste that would silently run one of them and hide
 * the other. Once the application has booted the registry is sealed, so
 * a late registration — from a request handler, or from a module that
 * initialises lazily — fails loudly instead of adding a schedule the
 * boot log never printed.
 */

import { Injectable } from '@nestjs/common';

import { assertValidSchedule } from './job-schedule';
import { assertValidRetry } from './retry-policy';
import { isRunnable, type JobDefinition, type RunnableJob } from './job.types';

@Injectable()
export class JobRegistry {
  private readonly jobs = new Map<string, JobDefinition>();
  private sealed = false;

  register(definition: JobDefinition): void {
    if (this.sealed) {
      throw new Error(
        `Job \`${definition.name}\` was registered after boot. Every schedule must be declared while the module graph is being built, or it will not appear in the boot log or on the jobs screen.`,
      );
    }

    if (this.jobs.has(definition.name)) {
      throw new Error(`Job \`${definition.name}\` is already registered.`);
    }

    assertValidSchedule(definition.name, definition.schedule);

    if (isRunnable(definition)) {
      assertValidRetry(definition.name, definition.retry);

      if (definition.timeoutMs < 1_000) {
        throw new Error(
          `Job \`${definition.name}\` has a ${String(definition.timeoutMs)} ms timeout; a sweep needs at least a second.`,
        );
      }
    }

    this.jobs.set(definition.name, definition);
  }

  seal(): void {
    this.sealed = true;
  }

  get isSealed(): boolean {
    return this.sealed;
  }

  /** Every declared schedule, blocked ones included, name-ordered. */
  all(): readonly JobDefinition[] {
    return [...this.jobs.values()].sort((left, right) => left.name.localeCompare(right.name));
  }

  /** The ones a driver may actually enqueue. */
  runnable(): readonly RunnableJob[] {
    return this.all().filter(isRunnable);
  }

  find(name: string): JobDefinition | null {
    return this.jobs.get(name) ?? null;
  }

  /**
   * The runnable definition, or `null` — including for a job that is
   * registered but blocked, which is not runnable however it is asked
   * for. Callers that must distinguish "no such job" from "blocked" use
   * `find` and narrow themselves.
   */
  findRunnable(name: string): RunnableJob | null {
    const job = this.jobs.get(name);

    return job !== undefined && isRunnable(job) ? job : null;
  }
}
