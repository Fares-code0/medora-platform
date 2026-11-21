/**
 * Per-job counters (RM M30.1's "job metrics").
 *
 * ## In memory, and the screen says so
 *
 * These are process-local and reset on restart. That is the right cost
 * for the question they answer — "is this job running, and did the last
 * run work" — and the wrong storage for a long-run trend, which is
 * M32's k6 report and a metrics backend rather than a table this
 * milestone would have to design. `JobsView.processLocal` carries the
 * caveat onto the administrator's screen rather than leaving them to
 * infer it from a counter that went backwards after a deploy.
 *
 * ## `lastOutcome` is kept; the payload is not
 *
 * A `JobOutcome` is scalars by contract, so keeping the last one costs a
 * handful of numbers and answers "how many did it expire last night"
 * without a log search. Nothing else about the run is retained — an
 * error keeps its message and loses its stack, for the reason
 * `DeadLetter` gives.
 */

import { Injectable } from '@nestjs/common';

import type { JobMetrics, JobOutcome } from './job.types';

interface MutableMetrics {
  started: number;
  succeeded: number;
  failedAttempts: number;
  deadLettered: number;
  lastRunAt: Date | null;
  lastDurationMs: number | null;
  lastOutcome: JobOutcome | null;
  lastError: string | null;
}

function blank(): MutableMetrics {
  return {
    started: 0,
    succeeded: 0,
    failedAttempts: 0,
    deadLettered: 0,
    lastRunAt: null,
    lastDurationMs: null,
    lastOutcome: null,
    lastError: null,
  };
}

@Injectable()
export class JobMetricsService {
  private readonly counters = new Map<string, MutableMetrics>();

  started(job: string, at: Date): void {
    const entry = this.entry(job);
    entry.started += 1;
    entry.lastRunAt = at;
  }

  succeeded(job: string, durationMs: number, outcome: JobOutcome): void {
    const entry = this.entry(job);
    entry.succeeded += 1;
    entry.lastDurationMs = durationMs;
    entry.lastOutcome = outcome;
    // Cleared on success: a stale error beside a green run is the single
    // most misread thing on an operations screen.
    entry.lastError = null;
  }

  attemptFailed(job: string, durationMs: number, message: string): void {
    const entry = this.entry(job);
    entry.failedAttempts += 1;
    entry.lastDurationMs = durationMs;
    entry.lastError = message;
  }

  deadLettered(job: string): void {
    this.entry(job).deadLettered += 1;
  }

  snapshot(job: string): JobMetrics {
    return { job, ...this.entry(job) };
  }

  all(): readonly JobMetrics[] {
    return [...this.counters.keys()]
      .sort((left, right) => left.localeCompare(right))
      .map((job) => this.snapshot(job));
  }

  private entry(job: string): MutableMetrics {
    const existing = this.counters.get(job);

    if (existing !== undefined) return existing;

    const created = blank();
    this.counters.set(job, created);

    return created;
  }
}
