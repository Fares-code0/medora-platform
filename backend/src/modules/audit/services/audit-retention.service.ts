/**
 * Partition maintenance and retention — API §14, RM M28.5.
 *
 * > ✅ Verify: retention job drops only out-of-window partitions
 * > (clock-controlled test).
 *
 * ## Retention drops partitions; it never deletes rows
 *
 * ADR-007 R2 is explicit and the schema is built for it: `audit_events`
 * is `PARTITION BY RANGE (occurred_at)`, the app role holds no DELETE on
 * it, and a month leaves the ledger as a `DROP TABLE`. That is not a
 * performance choice — it is what makes the ledger append-only in the
 * only sense that matters, since a `DELETE … WHERE` is exactly the
 * statement an attacker would run to remove their own tracks.
 *
 * ## The window comes from the settings slice, not from a constant
 *
 * `retention.auditLogDays` (M24.2). A retention job with its own number
 * would enforce something different from what the panel shows an
 * administrator, which is the class of bug ADR-020 exists to prevent.
 *
 * ## Two safety rules, and each has cost the industry data before
 *
 * **A partition is dropped only when its whole month is older than the
 * window** — the *end* of the month, not its start. Dropping
 * `audit_events_2026_01` the moment 1 January leaves the window would
 * take 30 days of still-retained events with it.
 *
 * **The DEFAULT partition is never dropped.** It is the catch-all that
 * stops an insert outside every declared range from failing, so it can
 * hold events of any age — including today's. `partitions()` excludes it
 * by construction (it has no bound), and the name check refuses it.
 *
 * ## Running it is M30.2's
 *
 * This is the work; the schedule is the registry's, which already lists
 * "retention purges". No timer is registered here — see
 * `OrphanSweepService` for the same rule and the same reason.
 */

import { Injectable, Logger } from '@nestjs/common';

import { PolicyService } from '../../../config';
import { AuditRepository } from '../repositories/audit.repository';

/** How many future months to keep ready. A year, as M5.10 seeded. */
export const MONTHS_AHEAD = 12;

export interface RetentionResult {
  readonly retentionDays: number;
  readonly created: readonly string[];
  readonly dropped: readonly string[];
  readonly kept: number;
}

@Injectable()
export class AuditRetentionService {
  private readonly logger = new Logger(AuditRetentionService.name);

  constructor(
    private readonly audit: AuditRepository,
    private readonly policy: PolicyService,
  ) {}

  /** The administrator's configured window, in days. */
  async retentionDays(): Promise<number> {
    return (await this.policy.current()).auditLogDays;
  }

  /**
   * Creates the months ahead and drops the months wholly past the
   * window. `now` is a parameter so the test can control the clock.
   */
  async sweep(now = new Date()): Promise<RetentionResult> {
    const retentionDays = await this.retentionDays();
    const created: string[] = [];

    for (let offset = 0; offset < MONTHS_AHEAD; offset += 1) {
      const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offset, 1));
      await this.audit.ensurePartition(month);
      created.push(partitionNameFor(month));
    }

    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
    const partitions = await this.audit.partitions();
    const dropped: string[] = [];

    for (const partition of partitions) {
      // The month's **end**, not its start. A partition still holding
      // retained events is not out of the window.
      const monthEnd = new Date(
        Date.UTC(partition.from.getUTCFullYear(), partition.from.getUTCMonth() + 1, 1),
      );

      if (monthEnd.getTime() > cutoff.getTime()) continue;

      await this.audit.dropPartition(partition.name);
      dropped.push(partition.name);
      this.logger.log(
        { partition: partition.name, retentionDays },
        'Dropped an audit partition older than the retention window',
      );
    }

    return {
      retentionDays,
      created,
      dropped,
      kept: partitions.length - dropped.length,
    };
  }
}

/** The name `create_audit_events_partition` gives a month. */
export function partitionNameFor(monthStart: Date): string {
  const year = String(monthStart.getUTCFullYear());
  const month = String(monthStart.getUTCMonth() + 1).padStart(2, '0');

  return `audit_events_${year}_${month}`;
}
