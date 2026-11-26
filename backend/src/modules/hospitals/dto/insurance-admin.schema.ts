import { z } from 'zod';

/** Insurance configuration (ADM-03): request schemas. */

const page = {
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
};
const search = z.string().trim().min(1).max(200).optional();
const nonEmpty = (value: object): boolean => Object.keys(value).length > 0;
const NOTHING = { message: 'Provide at least one field to change' };
const optionalText = (max: number) => z.string().trim().min(1).max(max).nullable().optional();
/** `YYYY-MM-DD`: the columns are calendar dates. */
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}, 'Not a calendar date');

/* ── Insurance providers (platform lookup) ────────────────────── */

export const createProviderSchema = z.object({
  code: z.string().trim().min(1).max(30).nullable().optional(),
  name: z.string().trim().min(2).max(200),
  phone: optionalText(30),
  website: z.string().trim().url().max(500).nullable().optional(),
  active: z.boolean().optional(),
});
export type CreateProviderInput = z.infer<typeof createProviderSchema>;

export const updateProviderSchema = createProviderSchema.partial().refine(nonEmpty, NOTHING);
export type UpdateProviderInput = z.infer<typeof updateProviderSchema>;

export const listProvidersQuerySchema = z.object({
  ...page,
  active: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  q: search,
});
export type ListProvidersQuery = z.infer<typeof listProvidersQuerySchema>;

/* ── Hospital insurance coverage ──────────────────────────────── */

const window = (value: { startsOn?: string | null | undefined; endsOn?: string | null | undefined }): boolean =>
  value.startsOn == null || value.endsOn == null || value.startsOn <= value.endsOn;
const WINDOW = { message: 'endsOn must not be before startsOn', path: ['endsOn'] };

const coverageFields = {
  providerId: z.string().uuid(),
  planCode: z.string().trim().min(1).max(60),
  planName: z.string().trim().min(1).max(120),
  active: z.boolean().optional(),
  startsOn: calendarDate.nullable().optional(),
  endsOn: calendarDate.nullable().optional(),
};

export const createCoverageSchema = z.object(coverageFields).refine(window, WINDOW);
export type CreateCoverageInput = z.infer<typeof createCoverageSchema>;

/** The provider and plan code identify a row; changing them is a new row. */
export const updateCoverageSchema = z
  .object({
    planName: coverageFields.planName,
    active: z.boolean(),
    startsOn: coverageFields.startsOn,
    endsOn: coverageFields.endsOn,
  })
  .partial()
  .refine(nonEmpty, NOTHING)
  .refine(window, WINDOW);
export type UpdateCoverageInput = z.infer<typeof updateCoverageSchema>;

export const listCoverageQuerySchema = z.object({
  ...page,
  active: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  providerId: z.string().uuid().optional(),
});
export type ListCoverageQuery = z.infer<typeof listCoverageQuerySchema>;
