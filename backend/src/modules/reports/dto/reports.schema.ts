/**
 * Saved and scheduled reports — API §12.3, §12.4.
 *
 * The enums are the contract's spellings, mapped to Prisma members at
 * the repository edge (ADR-023 §2).
 */

import { z } from 'zod';

import { REPORT_CATEGORY_VALUES, REPORT_RANGE_VALUES, isoDate } from './analytics.schema';

/**
 * `ReportFilters`, stored whole as JSONB.
 *
 * Validated rather than accepted as arbitrary JSON: a filter snapshot is
 * replayed into the analytics endpoint when the report is opened, so a
 * document with a category the server does not know would fail later,
 * at read time, on a report the user believed they had saved.
 */
export const reportFiltersSchema = z.object({
  category: z.enum(REPORT_CATEGORY_VALUES),
  range: z.enum(REPORT_RANGE_VALUES),
  // The frontend's `<input type="date">` emits `YYYY-MM-DD`; the
  // analytics endpoint these are replayed into refuses anything else.
  customFrom: isoDate.nullable().default(null),
  customTo: isoDate.nullable().default(null),
  department: z.string().max(120).default('all'),
  status: z.string().max(40).default('all'),
  medication: z.string().max(120).default('all'),
  labTest: z.string().max(120).default('all'),
  age: z.enum(['all', '0-17', '18-39', '40-64', '65+']).default('all'),
  gender: z.enum(['all', 'female', 'male']).default('all'),
});

export type ReportFiltersBody = z.infer<typeof reportFiltersSchema>;

export const createSavedReportSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.enum(REPORT_CATEGORY_VALUES),
  range: z.enum(REPORT_RANGE_VALUES).default('month'),
  favorite: z.boolean().default(false),
  filters: reportFiltersSchema,
});

export type CreateSavedReportBody = z.infer<typeof createSavedReportSchema>;

export const SCHEDULE_FREQUENCIES = ['daily', 'weekly', 'monthly'] as const;
export const EXPORT_FORMATS = ['csv', 'excel', 'pdf', 'print'] as const;

export const createScheduledReportSchema = z.object({
  name: z.string().trim().min(1).max(120),
  category: z.enum(REPORT_CATEGORY_VALUES),
  frequency: z.enum(SCHEDULE_FREQUENCIES),
  format: z.enum(EXPORT_FORMATS).default('pdf'),
  /**
   * Lower-cased before storage — ADR-028's own instruction.
   *
   * `recipients` is `text[]` rather than the `citext[]` DB §I2 asked
   * for, because Prisma 7 cannot read a citext array at all. That ADR
   * moved the case-insensitive comparison to "a normalisation rule:
   * recipients are stored lower-cased by the endpoint that writes them",
   * and this is that endpoint.
   */
  recipients: z.array(z.string().trim().email().max(254).toLowerCase()).min(1).max(20),
});

export type CreateScheduledReportBody = z.infer<typeof createScheduledReportSchema>;

/** API §12.4 — pause/resume is the only patch the contract names. */
export const patchScheduledReportSchema = z.object({
  status: z.enum(['active', 'paused']),
});

export type PatchScheduledReportBody = z.infer<typeof patchScheduledReportSchema>;

/**
 * `from` and `to` go into the same snapshot `GET /reports/analytics`
 * builds, so they carry the same rules as `analyticsQuerySchema`. As bare
 * strings, `from: "garbage"` reached `new Date(…)` and answered 500, and
 * `"2026-13-45"` produced a CSV over a range that does not exist, with a
 * 200 (2026-10-31).
 */
export const exportSchema = z
  .object({
    category: z.enum(REPORT_CATEGORY_VALUES),
    format: z.enum(['csv', 'excel', 'pdf']),
    range: z.enum(REPORT_RANGE_VALUES).default('month'),
    from: isoDate.optional(),
    to: isoDate.optional(),
  })
  .refine(
    (value) => value.range !== 'custom' || (value.from !== undefined && value.to !== undefined),
    {
      message: 'A custom range requires both `from` and `to`',
      path: ['from'],
    },
  )
  .refine((value) => value.from === undefined || value.to === undefined || value.from <= value.to, {
    message: '`from` must not be after `to`',
    path: ['from'],
  });

export type ExportBody = z.infer<typeof exportSchema>;
