import { z } from 'zod';

/** The data categories a grant or a request may name (§2.11, §2.12). */
export const DATA_CATEGORIES = ['identity', 'records', 'labs', 'prescriptions', 'allergies'] as const;
export type DataCategory = (typeof DATA_CATEGORIES)[number];

const categories = z
  .array(z.enum(DATA_CATEGORIES))
  .min(1, 'Name at least one category')
  .max(DATA_CATEGORIES.length)
  .transform((list) => [...new Set(list)]);
const reason = z.string().trim().min(12, 'State the reason (at least 12 characters)').max(1000);
const patientId = z.string().trim().min(1).max(40);

export const requestExceptionalAccessSchema = z.object({
  kind: z.enum(['EXCEPTIONAL', 'EMERGENCY']),
  patientId,
  hospitalId: z.string().uuid(),
  categories,
  reason,
  /** Limited duration (§2.11): at most 24 hours, default one hour. */
  durationMinutes: z.number().int().min(1).max(1440).default(60),
  /** Re-authentication: the requester's current password. */
  password: z.string().min(1).max(256),
});
export type RequestExceptionalAccessInput = z.infer<typeof requestExceptionalAccessSchema>;

export const decisionSchema = z.object({ note: z.string().trim().max(1000).optional() });
export type DecisionInput = z.infer<typeof decisionSchema>;

export const reviewSchema = z.object({
  outcome: z.enum(['JUSTIFIED', 'UNJUSTIFIED']),
  note: z.string().trim().max(1000).optional(),
});
export type ReviewInput = z.infer<typeof reviewSchema>;

export const categoryQuerySchema = z.object({ category: z.enum(DATA_CATEGORIES) });
export type CategoryQuery = z.infer<typeof categoryQuerySchema>;

export const createInformationRequestSchema = z.object({
  patientId,
  targetHospitalId: z.string().uuid(),
  items: categories,
  reason,
});
export type CreateInformationRequestInput = z.infer<typeof createInformationRequestSchema>;

export const approveInformationRequestSchema = z.object({
  approvedItems: categories,
  /** Time-bound sharing (§2.12): at most 30 days. */
  shareDays: z.number().int().min(1).max(30).default(7),
  note: z.string().trim().max(1000).optional(),
});
export type ApproveInformationRequestInput = z.infer<typeof approveInformationRequestSchema>;
