/**
 * Saved and scheduled reports (API §12.3, §12.4 — DB §I1–I3).
 *
 * ## Ownership is the predicate, on reads and writes alike
 *
 * Both tables carry `owner_id`, and every query here puts the caller's
 * id in the `where`. Deletes and patches use `deleteMany`/`updateMany`
 * scoped the same way, so "not yours" and "no such row" are the same
 * answer — zero — rather than a distinguishable error that would turn a
 * delete route into an enumeration oracle over other doctors' reports.
 */

import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../generated/prisma/client';
import {
  DateRangeKey,
  ExportFormat,
  ReportCategory,
  ScheduleFrequency,
  ScheduleStatus,
} from '../../../generated/prisma/enums';
import { PrismaService } from '../../../shared/database';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Wire → Prisma. `Record` in each direction so neither can drift. */
export const CATEGORY_FROM_WIRE: Record<string, ReportCategory> = {
  overview: ReportCategory.OVERVIEW,
  revenue: ReportCategory.REVENUE,
  patients: ReportCategory.PATIENTS,
  appointments: ReportCategory.APPOINTMENTS,
  laboratory: ReportCategory.LABORATORY,
  records: ReportCategory.RECORDS,
  pharmacy: ReportCategory.PHARMACY,
  messages: ReportCategory.MESSAGES,
  ai: ReportCategory.AI,
};

export const CATEGORY_TO_WIRE: Record<ReportCategory, string> = {
  OVERVIEW: 'overview',
  REVENUE: 'revenue',
  PATIENTS: 'patients',
  APPOINTMENTS: 'appointments',
  LABORATORY: 'laboratory',
  RECORDS: 'records',
  PHARMACY: 'pharmacy',
  MESSAGES: 'messages',
  AI: 'ai',
};

export const RANGE_FROM_WIRE: Record<string, DateRangeKey> = {
  today: DateRangeKey.TODAY,
  week: DateRangeKey.WEEK,
  month: DateRangeKey.MONTH,
  quarter: DateRangeKey.QUARTER,
  year: DateRangeKey.YEAR,
  custom: DateRangeKey.CUSTOM,
};

export const RANGE_TO_WIRE: Record<DateRangeKey, string> = {
  TODAY: 'today',
  WEEK: 'week',
  MONTH: 'month',
  QUARTER: 'quarter',
  YEAR: 'year',
  CUSTOM: 'custom',
};

export const FREQUENCY_FROM_WIRE: Record<string, ScheduleFrequency> = {
  daily: ScheduleFrequency.DAILY,
  weekly: ScheduleFrequency.WEEKLY,
  monthly: ScheduleFrequency.MONTHLY,
};

export const FREQUENCY_TO_WIRE: Record<ScheduleFrequency, string> = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
};

export const FORMAT_FROM_WIRE: Record<string, ExportFormat> = {
  csv: ExportFormat.CSV,
  excel: ExportFormat.EXCEL,
  pdf: ExportFormat.PDF,
  print: ExportFormat.PRINT,
};

export const FORMAT_TO_WIRE: Record<ExportFormat, string> = {
  CSV: 'csv',
  EXCEL: 'excel',
  PDF: 'pdf',
  PRINT: 'print',
};

export const STATUS_TO_WIRE: Record<ScheduleStatus, string> = {
  ACTIVE: 'active',
  PAUSED: 'paused',
};

const SAVED_SELECT = {
  id: true,
  name: true,
  category: true,
  dateRange: true,
  favorite: true,
  filters: true,
  lastViewedAt: true,
  createdAt: true,
} as const;

const SCHEDULED_SELECT = {
  id: true,
  name: true,
  category: true,
  frequency: true,
  format: true,
  recipients: true,
  status: true,
  nextRunAt: true,
  runs: {
    select: { id: true, ranAt: true, status: true, error: true },
    orderBy: { ranAt: 'desc' as const },
    take: 20,
  },
} as const;

@Injectable()
export class SavedReportRepository {
  constructor(private readonly prisma: PrismaService) {}

  listSaved(ownerId: string): Promise<readonly SavedRow[]> {
    if (!UUID.test(ownerId)) return Promise.resolve([]);

    return this.prisma.db.savedReport.findMany({
      where: { ownerId },
      select: SAVED_SELECT,
      orderBy: [{ favorite: 'desc' }, { createdAt: 'desc' }],
    });
  }

  createSaved(data: Prisma.SavedReportUncheckedCreateInput): Promise<SavedRow> {
    return this.prisma.db.savedReport.create({ data, select: SAVED_SELECT });
  }

  async deleteSaved(ownerId: string, id: string): Promise<number> {
    if (!UUID.test(ownerId) || !UUID.test(id)) return 0;

    const result = await this.prisma.db.savedReport.deleteMany({ where: { id, ownerId } });

    return result.count;
  }

  listScheduled(ownerId: string): Promise<readonly ScheduledRow[]> {
    if (!UUID.test(ownerId)) return Promise.resolve([]);

    return this.prisma.db.scheduledReport.findMany({
      where: { ownerId },
      select: SCHEDULED_SELECT,
      orderBy: { createdAt: 'desc' },
    });
  }

  createScheduled(data: Prisma.ScheduledReportUncheckedCreateInput): Promise<ScheduledRow> {
    return this.prisma.db.scheduledReport.create({ data, select: SCHEDULED_SELECT });
  }

  async patchScheduled(ownerId: string, id: string, status: ScheduleStatus): Promise<number> {
    if (!UUID.test(ownerId) || !UUID.test(id)) return 0;

    const result = await this.prisma.db.scheduledReport.updateMany({
      where: { id, ownerId },
      data: { status },
    });

    return result.count;
  }

  async deleteScheduled(ownerId: string, id: string): Promise<number> {
    if (!UUID.test(ownerId) || !UUID.test(id)) return 0;

    const result = await this.prisma.db.scheduledReport.deleteMany({ where: { id, ownerId } });

    return result.count;
  }

  async runsFor(ownerId: string, id: string): Promise<readonly RunRow[] | null> {
    if (!UUID.test(ownerId) || !UUID.test(id)) return null;

    // The ownership check and the read are one query: a separate
    // existence check would be a second round trip and a race.
    const report = await this.prisma.db.scheduledReport.findFirst({
      where: { id, ownerId },
      select: {
        runs: { select: { id: true, ranAt: true, status: true, error: true }, orderBy: { ranAt: 'desc' } },
      },
    });

    return report === null ? null : report.runs;
  }
}

export type SavedRow = Prisma.SavedReportGetPayload<{ select: typeof SAVED_SELECT }>;
export type ScheduledRow = Prisma.ScheduledReportGetPayload<{ select: typeof SCHEDULED_SELECT }>;
export interface RunRow {
  readonly id: string;
  readonly ranAt: Date;
  readonly status: string;
}
