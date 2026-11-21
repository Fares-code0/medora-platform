/**
 * The two file schedules (RM M30.2).
 *
 * `OrphanSweepService` states the rule this file obeys: "Building a
 * second scheduler inside a domain module is how periodic behaviour ends
 * up running twice on two instances and nowhere on a third." Both sweeps
 * are registered here and neither service changed.
 *
 * ## The scan runs every minute; the orphan sweep every six hours
 *
 * They are opposite in urgency. A file stays undownloadable until it is
 * scanned (M25.3's gate), so the scan interval is the delay between an
 * upload and a working download link — a minute is the coarsest value
 * that does not read as broken to whoever just uploaded a chart page.
 * An orphan is an object whose row was soft-deleted; nobody is waiting
 * for it to go, and reclaiming storage four times a day is ample.
 *
 * ## The scan's retry policy is the frequent one, and its outcome is
 * the honest one
 *
 * Retrying a scan hard would be retrying an object-store fetch that the
 * next minute's run will attempt anyway. And with no engine bound, every
 * run reports `unavailable: n` and writes nothing — so the operator's
 * screen shows the backlog rather than a green tick over a gate that
 * never opens.
 */

import { Injectable, type OnModuleInit } from '@nestjs/common';

import {
  DEFAULT_RETRY,
  everyHours,
  everyMinutes,
  FREQUENT_RETRY,
  JobRegistry,
} from '../../../shared/jobs';

import { MalwareScanService } from './malware-scan.service';
import { OrphanSweepService } from './orphan-sweep.service';

@Injectable()
export class FilesJobs implements OnModuleInit {
  constructor(
    private readonly registry: JobRegistry,
    private readonly scan: MalwareScanService,
    private readonly orphans: OrphanSweepService,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      name: 'files.malware-scan',
      summary: 'Scans uploaded files so the download gate can open (M25.3).',
      schedule: everyMinutes(1),
      retry: FREQUENT_RETRY,
      timeoutMs: 120_000,
      handler: async ({ now }) => {
        const result = await this.scan.sweep(now);

        return {
          examined: result.examined,
          clean: result.clean,
          infected: result.infected,
          unavailable: result.unavailable,
          failed: result.failed,
          engine: result.engine,
        };
      },
    });

    this.registry.register({
      name: 'files.orphan-sweep',
      summary: 'Removes stored objects whose row was soft-deleted (M25.5).',
      schedule: everyHours(6),
      retry: DEFAULT_RETRY,
      timeoutMs: 5 * 60_000,
      handler: async () => {
        const result = await this.orphans.sweep();

        return { removed: result.removed, failed: result.failed };
      },
    });
  }
}
