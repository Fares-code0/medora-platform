/**
 * Insights — API §12.2, RM M21.2.
 *
 * > ✅ Verify: seeded scenario yields expected insights.
 *
 * ## Every insight is a derivation, never a threshold
 *
 * `InsightKind` names seven kinds and the frontend renders each as a
 * card with a title, a detail line and a direction. What it does **not**
 * state anywhere is when an insight is worth showing — "flag a workload
 * rise above 20%" is a product rule and no source gives one. So nothing
 * here has a threshold: each insight reports *what the data says*, with
 * its direction taken from the sign of the movement. A card reading
 * "Workload unchanged" is a true and useful statement; a card that
 * appeared only above an invented cutoff would be a product decision
 * made in a service file.
 *
 * ## The tone follows the direction, and one kind inverts it
 *
 * More appointments is `success`, fewer is `warning` — ordinary
 * practice movement. **Critical results invert**: any unreviewed
 * critical result is `error`, and none is `success`. That is not a
 * threshold, it is the same rule the lab module already enforces
 * everywhere else (a critical result is pinned until acted on, UX 2.9).
 */

import { Injectable } from '@nestjs/common';

import type { ClinicalEmployment } from '../../../shared/authz';

import type { InsightView } from '../dto/analytics.dto';
import {
  SnapshotRepository,
  WEEKDAYS,
  type Demographics,
  type Window,
} from '../repositories/snapshot.repository';

import { deltaPercent } from './report-range';

const ALL: Demographics = { gender: 'all', ageBand: 'all' };

function direction(delta: number): 'up' | 'down' | 'flat' {
  if (delta > 0) return 'up';
  if (delta < 0) return 'down';

  return 'flat';
}

function movement(delta: number): string {
  if (delta === 0) return 'unchanged from the previous period';

  return `${delta > 0 ? 'up' : 'down'} ${Math.abs(delta)}% on the previous period`;
}

@Injectable()
export class InsightService {
  constructor(private readonly snapshots: SnapshotRepository) {}

  async build(
    userId: string,
    doctor: ClinicalEmployment,
    current: Window,
    previous: Window,
    now: Date,
  ): Promise<readonly InsightView[]> {
    const [
      appointmentsNow,
      appointmentsBefore,
      weekday,
      criticalPending,
      pharmacy,
      labNow,
      labBefore,
      aiUsage,
    ] = await Promise.all([
      this.snapshots.appointmentCount(doctor, current, ALL, now),
      this.snapshots.appointmentCount(doctor, previous, ALL, now),
      this.snapshots.appointmentsByWeekday(doctor, current, ALL, now),
      this.snapshots.criticalPending(doctor),
      this.snapshots.prescriptionsByMedication(doctor, current, 1),
      this.snapshots.labOrderCount(doctor, current, ALL, now),
      this.snapshots.labOrderCount(doctor, previous, ALL, now),
      this.snapshots.aiUsageByMode(userId, current),
    ]);

    const workloadDelta = deltaPercent(appointmentsNow, appointmentsBefore);
    const labDelta = deltaPercent(labNow, labBefore);

    const busiestIndex = weekday.reduce(
      (best, value, index) => (value > (weekday[best] ?? 0) ? index : best),
      0,
    );
    const busiestCount = weekday[busiestIndex] ?? 0;
    const aiTotal = aiUsage.reduce((sum, row) => sum + row.value, 0);
    const topMedication = pharmacy[0];

    return [
      {
        id: 'workload',
        kind: 'workload',
        title: 'Workload',
        detail: `${appointmentsNow} appointment${appointmentsNow === 1 ? '' : 's'} this period, ${movement(workloadDelta)}.`,
        trend: direction(workloadDelta),
        tone: workloadDelta >= 0 ? 'success' : 'warning',
      },
      {
        id: 'busiest',
        kind: 'busiest',
        title: 'Busiest day',
        detail:
          busiestCount === 0
            ? 'No appointments in this period.'
            : `${WEEKDAYS[busiestIndex]} carried the most appointments (${busiestCount}).`,
        trend: null,
        tone: 'info',
      },
      {
        id: 'critical',
        kind: 'critical',
        title: 'Critical results',
        detail:
          criticalPending === 0
            ? 'No critical results are awaiting review.'
            : `${criticalPending} critical result${criticalPending === 1 ? '' : 's'} await${criticalPending === 1 ? 's' : ''} review.`,
        trend: null,
        // Inverted deliberately: this is the one kind where "more" is
        // never good news, and the lab module treats it the same way.
        tone: criticalPending === 0 ? 'success' : 'error',
      },
      {
        id: 'pharmacy',
        kind: 'pharmacy',
        title: 'Prescribing',
        detail:
          topMedication === undefined
            ? 'No prescriptions issued in this period.'
            : `${topMedication.label} was prescribed most often (${topMedication.value}).`,
        trend: null,
        tone: 'warning',
      },
      {
        id: 'lab',
        kind: 'lab',
        title: 'Laboratory',
        detail: `${labNow} lab order${labNow === 1 ? '' : 's'} this period, ${movement(labDelta)}.`,
        trend: direction(labDelta),
        tone: 'info',
      },
      {
        // Not a revenue figure, and it says so. ADR-039 keeps billing
        // deferred, and a revenue insight reading zero is
        // indistinguishable from a quiet month — the same reasoning
        // ADR-037 §3 applied to the revenue category itself.
        id: 'revenue',
        kind: 'revenue',
        title: 'Revenue',
        detail: 'Billing is not enabled for this clinic, so revenue reporting is unavailable.',
        trend: null,
        tone: 'secondary',
      },
      {
        id: 'ai',
        kind: 'ai',
        title: 'AI assistant',
        detail:
          aiTotal === 0
            ? 'No assistant threads opened in this period.'
            : `${aiTotal} assistant thread${aiTotal === 1 ? '' : 's'} opened in this period.`,
        trend: null,
        tone: 'accent',
      },
    ];
  }
}
