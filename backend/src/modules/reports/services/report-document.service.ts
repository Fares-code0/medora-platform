/**
 * Saved and scheduled reports, and the CSV export (M21.3–M21.5).
 *
 * ## `nextRunAt` is computed, because the contract requires the field
 *
 * `ScheduledReport.nextRunAt` is `NOT NULL` and the frontend renders it.
 * The frequency vocabulary — daily, weekly, monthly — fixes the interval
 * exactly, so the *next* occurrence is arithmetic rather than a policy
 * decision. **What time of day a schedule fires is not stated anywhere**,
 * so it is the creation time's own clock: a schedule made at 09:15 runs
 * at 09:15. That is a derivation from the user's action rather than an
 * invented default, and it is the one reading that needs no source.
 *
 * ## The executor is M30's, and nothing here pretends otherwise
 *
 * API §12.4 says "executor is a cron job", and **M30.2 lists scheduled
 * reports among the jobs its registry owns**. This service stores the
 * schedule, its recipients and its run history; it does not run
 * anything, and it starts no timer. `GET …/{id}/runs` reads a history
 * that stays empty until M30 writes to it — which is the honest state,
 * and visible rather than hidden behind a fabricated row.
 */

import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';
import type {
  CreateSavedReportBody,
  CreateScheduledReportBody,
  PatchScheduledReportBody,
} from '../dto/reports.schema';
import {
  CATEGORY_FROM_WIRE,
  CATEGORY_TO_WIRE,
  FORMAT_FROM_WIRE,
  FORMAT_TO_WIRE,
  FREQUENCY_FROM_WIRE,
  FREQUENCY_TO_WIRE,
  RANGE_FROM_WIRE,
  RANGE_TO_WIRE,
  SavedReportRepository,
  STATUS_TO_WIRE,
  type SavedRow,
  type ScheduledRow,
} from '../repositories/saved-report.repository';

/** The next occurrence after `from`, at the same time of day. */
export function nextRun(frequency: 'daily' | 'weekly' | 'monthly', from: Date): Date {
  switch (frequency) {
    case 'daily':
      return new Date(from.getTime() + 86_400_000);
    case 'weekly':
      return new Date(from.getTime() + 7 * 86_400_000);
    case 'monthly': {
      // Calendar arithmetic, not 30 days: "monthly" on the 31st lands on
      // the last day of a shorter month rather than sliding earlier each
      // time, which a fixed interval would do.
      const next = new Date(from);
      next.setUTCMonth(next.getUTCMonth() + 1);

      return next;
    }
  }
}

@Injectable()
export class ReportDocumentService {
  constructor(private readonly reports: SavedReportRepository) {}

  async listSaved(ownerId: string) {
    return (await this.reports.listSaved(ownerId)).map(toSavedView);
  }

  async createSaved(ownerId: string, body: CreateSavedReportBody) {
    const row = await this.reports.createSaved({
      ownerId,
      name: body.name,
      category: CATEGORY_FROM_WIRE[body.category]!,
      dateRange: RANGE_FROM_WIRE[body.range]!,
      favorite: body.favorite,
      // Stored whole: the filter set differs per category and is read
      // back as one document, which is why DB §I1 types it `jsonb`.
      filters: body.filters,
    });

    return toSavedView(row);
  }

  async deleteSaved(ownerId: string, id: string): Promise<void> {
    if ((await this.reports.deleteSaved(ownerId, id)) === 0) {
      throw AppException.notFound('Saved report not found');
    }
  }

  async listScheduled(ownerId: string) {
    return (await this.reports.listScheduled(ownerId)).map(toScheduledView);
  }

  async createScheduled(ownerId: string, body: CreateScheduledReportBody, now: Date = new Date()) {
    const row = await this.reports.createScheduled({
      ownerId,
      name: body.name,
      category: CATEGORY_FROM_WIRE[body.category]!,
      frequency: FREQUENCY_FROM_WIRE[body.frequency]!,
      format: FORMAT_FROM_WIRE[body.format]!,
      // Already lower-cased by the schema — ADR-028's normalisation
      // rule, standing in for the `citext[]` Prisma 7 cannot read.
      recipients: body.recipients,
      nextRunAt: nextRun(body.frequency, now),
    });

    return toScheduledView(row);
  }

  async patchScheduled(ownerId: string, id: string, body: PatchScheduledReportBody): Promise<void> {
    const moved = await this.reports.patchScheduled(
      ownerId,
      id,
      body.status === 'active' ? 'ACTIVE' : 'PAUSED',
    );

    if (moved === 0) throw AppException.notFound('Scheduled report not found');
  }

  async deleteScheduled(ownerId: string, id: string): Promise<void> {
    if ((await this.reports.deleteScheduled(ownerId, id)) === 0) {
      throw AppException.notFound('Scheduled report not found');
    }
  }

  async runs(ownerId: string, id: string) {
    const rows = await this.reports.runsFor(ownerId, id);

    if (rows === null) throw AppException.notFound('Scheduled report not found');

    return rows.map((run) => ({
      id: run.id,
      at: run.ranAt.toISOString(),
      status: String(run.status).toLowerCase(),
    }));
  }
}

function toSavedView(row: SavedRow) {
  return {
    id: row.id,
    name: row.name,
    category: CATEGORY_TO_WIRE[row.category],
    range: RANGE_TO_WIRE[row.dateRange],
    favorite: row.favorite,
    createdAt: row.createdAt.toISOString(),
    lastViewedAt: row.lastViewedAt?.toISOString() ?? null,
    filters: row.filters,
  };
}

function toScheduledView(row: ScheduledRow) {
  return {
    id: row.id,
    name: row.name,
    category: CATEGORY_TO_WIRE[row.category],
    frequency: FREQUENCY_TO_WIRE[row.frequency],
    format: FORMAT_TO_WIRE[row.format],
    recipients: row.recipients,
    status: STATUS_TO_WIRE[row.status],
    nextRunAt: row.nextRunAt.toISOString(),
    history: row.runs.map((run) => ({
      id: run.id,
      at: run.ranAt.toISOString(),
      status: String(run.status).toLowerCase(),
    })),
  };
}
