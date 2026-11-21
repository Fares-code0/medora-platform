/**
 * Request validation for the analytics endpoint (API §12.1).
 *
 * M17.2 accepted only `category` and `range`, deliberately: a schema
 * that advertised filters nothing applied would be a promise the server
 * could not keep. **M21.1 completes the parameter list** — `custom` with
 * its bounds, `compare`, `gender` and `ageBand` — because the snapshot
 * behind them now exists.
 */

import { z } from 'zod';

/** API §12.1's nine categories, verbatim from `ReportCategory`. */
export const REPORT_CATEGORY_VALUES = [
  'overview',
  'revenue',
  'patients',
  'appointments',
  'laboratory',
  'records',
  'pharmacy',
  'messages',
  'ai',
] as const;

/** §12.1's six ranges, verbatim from `DateRangeKey`. */
export const REPORT_RANGE_VALUES = ['today', 'week', 'month', 'quarter', 'year', 'custom'] as const;

/** `ReportFilters.gender` and `.age`, verbatim. */
export const GENDER_VALUES = ['all', 'female', 'male'] as const;
export const AGE_BAND_VALUES = ['all', '0-17', '18-39', '40-64', '65+'] as const;

/**
 * `YYYY-MM-DD`. A date, not an instant: the picker emits a day.
 *
 * Exported for `exportSchema`, which takes the same `from`/`to` into the
 * same snapshot and so needs the same rule.
 */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), 'Not a real date');

const analyticsFilters = z.object({
  category: z.enum(REPORT_CATEGORY_VALUES),
  range: z.enum(REPORT_RANGE_VALUES).default('month'),
  from: isoDate.optional(),
  to: isoDate.optional(),
  compare: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  gender: z.enum(GENDER_VALUES).default('all'),
  ageBand: z.enum(AGE_BAND_VALUES).default('all'),
});

export const analyticsQuerySchema = analyticsFilters
  // A custom range without bounds would silently become "this month",
  // which is a different report than the one the user asked for.
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

export type AnalyticsQuery = z.infer<typeof analyticsQuerySchema>;

/**
 * `GET /reports/insights` — the same filters with `category` optional and
 * **without** the two range refinements, which is what the route has
 * always accepted: it was `analyticsQuerySchema.innerType().innerType()`
 * under Zod 3, where each `.refine` wrapped the object in a `ZodEffects`.
 * Zod 4 keeps refinements on the object itself, so the unrefined base is
 * named here instead of being dug out of the refined one.
 */
export const insightsQuerySchema = analyticsFilters.partial({ category: true });
