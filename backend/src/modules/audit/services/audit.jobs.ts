/**
 * The audit partition and retention schedule (RM M30.2).
 *
 * `AuditRetentionService` says "Running it is M30.2's … no timer is
 * registered here". This is the timer, and the service is unchanged.
 *
 * ## The sweep creates before it drops, which is why it runs daily
 *
 * It is two jobs wearing one name: it keeps twelve months of partitions
 * ready *ahead* of now, and it drops the months wholly past the
 * retention window. The second half changes once a month; the first half
 * is what must never be late, because an insert with no partition to
 * land in fails — and a failed insert here is a lost audit event.
 *
 * 03:10 UTC, and the ten minutes are deliberate: it shares the small
 * hours with the expiry sweep at 02:00 and the licence warning at 06:00,
 * and a `DROP TABLE` overlapping a sweep that is writing audit rows is
 * contention nobody would enjoy diagnosing.
 *
 * ## It is allowed to take a while
 *
 * Dropping a partition is fast; creating twelve is twelve DDL statements
 * against a table other transactions are writing to. The timeout is
 * generous rather than tight because the failure mode of a timeout here
 * — a half-created set of partitions — is worse than a slow run, and the
 * sweep is idempotent so the next day finishes the job either way.
 */

import { Injectable, type OnModuleInit } from '@nestjs/common';

import { dailyAtUtc, DEFAULT_RETRY, JobRegistry } from '../../../shared/jobs';

import { AuditRetentionService } from './audit-retention.service';

@Injectable()
export class AuditJobs implements OnModuleInit {
  constructor(
    private readonly registry: JobRegistry,
    private readonly retention: AuditRetentionService,
  ) {}

  onModuleInit(): void {
    this.registry.register({
      name: 'audit.retention-sweep',
      summary: 'Creates the months ahead and drops partitions past the retention window (M28.5).',
      schedule: dailyAtUtc(3, 10),
      retry: DEFAULT_RETRY,
      timeoutMs: 10 * 60_000,
      handler: async ({ now }) => {
        const result = await this.retention.sweep(now);

        return {
          retentionDays: result.retentionDays,
          created: result.created.length,
          dropped: result.dropped.length,
          kept: result.kept,
        };
      },
    });
  }
}
