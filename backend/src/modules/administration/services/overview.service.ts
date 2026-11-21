/**
 * `GET /administration/overview` — API §18.1, RM M23.1.
 *
 * > ✅ Verify: aggregates match a hand-computed seeded scenario;
 * > p95 < 200 ms.
 *
 * ## Every figure is a count, and they run as one batch
 *
 * Eight counts go through a single `$transaction([...])`, so the page
 * costs one round trip and every number describes the same instant. Run
 * sequentially, a busy clinic could return a "completed" figure from
 * after a "total" figure and show more completed appointments than
 * appointments.
 *
 * ## Percentages are defined, including at zero
 *
 * `doctorUtilization` is the share of doctors with at least one
 * appointment today; `clinicOccupancy` the share of rooms occupied. Both
 * answer **0** when the denominator is zero rather than `NaN` — a clinic
 * with no rooms is not 0/0 percent occupied, it is not occupied.
 *
 * ## `averageWaitingMinutes` is derived from check-in times
 *
 * Not stored, and computed against the request's own clock, so two
 * reads a minute apart disagree — which is what a waiting time is.
 */

import { Injectable } from '@nestjs/common';

import { OperationsRepository } from '../repositories/operations.repository';

function percent(part: number, whole: number): number {
  if (whole === 0) return 0;

  return Math.round((part / whole) * 1000) / 10;
}

@Injectable()
export class OverviewService {
  constructor(private readonly operations: OperationsRepository) {}

  async build(now: Date = new Date()) {
    const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const to = new Date(from.getTime() + 86_400_000);

    const [
      counts,
      todaysPatients,
      starts,
      busyDoctors,
      waitingSince,
    ] = await Promise.all([
      this.operations.overviewCounts(from, to),
      this.operations.todaysPatients(from, to),
      this.operations.todaysStarts(from, to),
      this.operations.busyDoctors(from, to),
      this.operations.waitingSince(),
    ]);

    const [
      todaysAppointments,
      completed,
      cancelled,
      waiting,
      queueLength,
      doctors,
      rooms,
      occupiedRooms,
    ] = counts;

    // 24 buckets, all present including the empty ones: a histogram that
    // skipped quiet hours would draw a clinic that closes at random.
    const hourlyActivity = new Array<number>(24).fill(0);
    for (const row of starts) {
      const hour = row.startsAt.getUTCHours();
      hourlyActivity[hour] = (hourlyActivity[hour] ?? 0) + 1;
    }

    const averageWaitingMinutes =
      waitingSince.length === 0
        ? 0
        : Math.round(
            waitingSince.reduce(
              (sum, row) => sum + (now.getTime() - row.checkedInAt.getTime()) / 60_000,
              0,
            ) / waitingSince.length,
          );

    return {
      todaysPatients,
      todaysAppointments,
      waiting,
      queueLength,
      completed,
      cancelled,
      doctorUtilization: percent(busyDoctors, doctors),
      averageWaitingMinutes,
      clinicOccupancy: percent(occupiedRooms, rooms),
      hourlyActivity,
      range: { from: from.toISOString(), to: to.toISOString() },
    };
  }
}
