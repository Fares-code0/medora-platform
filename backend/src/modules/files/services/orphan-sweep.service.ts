/**
 * Orphan cleanup — API §17.3's "orphan cleanup job handles storage",
 * RM M25.5.
 *
 * > ✅ Verify: soft-deleted file's object removed by the job.
 *
 * ## The sweep is here; the schedule is M30.2's
 *
 * This is the work a scheduled job does, written as a method something
 * can call. What is deliberately **not** here is the cron entry: the
 * scheduled-jobs registry (M30.2) owns scheduling, and `files.jobs.ts`
 * registers "orphan cleanup" with it. Building a second scheduler inside a
 * domain module is how periodic behaviour ends up running twice on two
 * instances and nowhere on a third — the exit gate for M30 is "all
 * periodic behaviour runs from the registry, none ad hoc", and an ad hoc
 * timer added here would be the thing that gate fails on.
 *
 * ## It is safe to run twice, and safe to stop halfway
 *
 * A swept row has its `storage_key` emptied, so the next pass does not
 * offer it again — which makes the sweep resumable after a crash in the
 * middle of a batch, and idempotent if two instances ever run it at
 * once. `remove()` is idempotent by the port's contract for the same
 * reason.
 *
 * ## One failure does not stop the batch
 *
 * A single object the store refuses to delete must not leave the other
 * ninety-nine in place forever. Each failure is logged with its key and
 * counted; the row keeps its `storage_key`, so the next run tries again.
 */

import { Inject, Injectable, Logger } from '@nestjs/common';

import { FILE_STORAGE, type FileStoragePort } from '../../../shared/files';
import { FileRepository } from '../repositories/file.repository';

/** One batch. Bounded so a sweep cannot hold the store for an hour. */
export const SWEEP_BATCH = 100;

export interface SweepResult {
  readonly removed: number;
  readonly failed: number;
}

@Injectable()
export class OrphanSweepService {
  private readonly logger = new Logger(OrphanSweepService.name);

  constructor(
    private readonly files: FileRepository,
    @Inject(FILE_STORAGE) private readonly storage: FileStoragePort,
  ) {}

  async sweep(limit = SWEEP_BATCH): Promise<SweepResult> {
    const candidates = await this.files.sweepable(limit);

    let removed = 0;
    let failed = 0;

    for (const candidate of candidates) {
      try {
        await this.storage.remove(candidate.storageKey);
        // Marked only after the object is gone. Marked first, a failed
        // delete would leave bytes nothing will ever collect.
        await this.files.markObjectRemoved(candidate.id);
        removed += 1;
      } catch (error) {
        failed += 1;
        this.logger.error(
          { err: error, fileId: candidate.id },
          'Orphan sweep could not remove a stored object; it stays queued',
        );
      }
    }

    return { removed, failed };
  }
}
