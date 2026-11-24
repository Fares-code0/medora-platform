/**
 * Request validation for administrative oversight (API §9.11).
 *
 * The justification vocabulary is the **contract's** spelling —
 * `complaint | safety | legal | audit` — which ADR-006 §3 keeps on the
 * wire while mapping to DB §S4's storage values internally. `reason` is
 * `NOT NULL` in the schema and non-empty here: a justification nobody
 * wrote is not a justification.
 */

import { z } from 'zod';

export const oversightQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type OversightQuery = z.infer<typeof oversightQuerySchema>;

export const accessRequestSchema = z.object({
  justificationCategory: z.enum(['complaint', 'safety', 'legal', 'audit']),
  reason: z.string().trim().min(10).max(2000),
  /** F-12: content access re-proves the requester, as Break-Glass does. */
  password: z.string().min(1).max(200),
});

export type AccessRequestBody = z.infer<typeof accessRequestSchema>;

export const flagQuerySchema = z.object({
  status: z.enum(['open', 'under_review', 'resolved']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type FlagQuery = z.infer<typeof flagQuerySchema>;

/** P4 — a destructive-ish act carries a reason (the note is required). */
export const resolveFlagSchema = z.object({
  resolution: z.enum(['dismissed', 'warned', 'escalated']),
  note: z.string().trim().min(5).max(2000),
});

export type ResolveFlagBody = z.infer<typeof resolveFlagSchema>;
