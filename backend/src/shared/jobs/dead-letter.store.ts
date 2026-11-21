/**
 * Dead letters (RM M30.1's "dead-letter handling").
 *
 * > ✅ Verify: poisoned job lands in DLQ after N retries.
 *
 * A run that exhausted its retry policy lands here and stops. It does
 * **not** get re-queued on the next tick and it does not disappear: both
 * are ways of losing the fact that something is broken, and a sweep that
 * silently fails every fifteen minutes for a week is precisely the
 * failure this milestone's exit gate exists to make visible.
 *
 * ## Bounded, and oldest-out
 *
 * A dead-letter list that grows without limit is a memory leak with an
 * operational excuse. The cap is small on purpose: a hundred entries is
 * far more than an operator will read, and a job failing more than that
 * needs the metrics counter, not a hundred more copies of one message.
 * When the cap is reached the **oldest** entry is dropped — the newest
 * failure is the one being diagnosed.
 *
 * ## Process-local, and the screen says so
 *
 * Same caveat as `JobMetricsService`, and the same disclosure:
 * `JobsView.processLocal` is `true` whenever this is the only record, so
 * an administrator reading an empty list on a two-replica deployment
 * knows it means "none on this instance" rather than "none". Under the
 * BullMQ driver the broker keeps its own durable failed set beside this
 * one — see `bullmq-job-queue.ts` — and RA-M30.1 records the gap.
 */

import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import type { DeadLetter, JobTrigger } from './job.types';

/** See the header: small on purpose. */
export const DEAD_LETTER_CAPACITY = 100;

export interface DeadLetterInput {
  readonly job: string;
  readonly failedAt: Date;
  readonly attempts: number;
  readonly error: string;
  readonly correlationId: string;
  readonly trigger: JobTrigger;
}

@Injectable()
export class DeadLetterStore {
  /** Newest first, so `list()` needs no sort and eviction is a pop. */
  private entries: DeadLetter[] = [];

  record(input: DeadLetterInput): DeadLetter {
    const entry: DeadLetter = { id: randomUUID(), ...input };

    this.entries.unshift(entry);

    if (this.entries.length > DEAD_LETTER_CAPACITY) {
      this.entries.length = DEAD_LETTER_CAPACITY;
    }

    return entry;
  }

  list(job?: string): readonly DeadLetter[] {
    return job === undefined ? [...this.entries] : this.entries.filter((e) => e.job === job);
  }

  find(id: string): DeadLetter | null {
    return this.entries.find((entry) => entry.id === id) ?? null;
  }

  /**
   * Removes and returns an entry.
   *
   * Replay takes rather than copies: a dead letter that stayed in the
   * list after being re-queued would be replayed twice by the next
   * operator to look at the screen.
   */
  take(id: string): DeadLetter | null {
    const index = this.entries.findIndex((entry) => entry.id === id);

    if (index === -1) return null;

    const [entry] = this.entries.splice(index, 1);

    return entry ?? null;
  }

  get size(): number {
    return this.entries.length;
  }
}
