import { z } from 'zod';

import { envelopeSchema, paginatedSchema, parseResponse } from '@/schemas/envelope';

import { apiClient } from '../client';

/**
 * The patient-facing information layer — and nothing clinical.
 *
 *   GET /me/lab-orders   test STATUS: name, status, dates, hospital
 *   GET /me/insurance    the insurance on file, and an honest "no
 *                        authorization workflow yet" marker
 *
 * ── What these routes deliberately do not carry ──────────────────────
 *
 * Owner decision, 2026-11-26: the patient never sees the full medical
 * record, physician notes, or unrestricted history, and **results stay
 * unexposed** until a release policy is approved (ADR-031, still open).
 * So the lab-order payload has no result, value, flag, interpretation,
 * clinical indication, reviewer or critical marker — and **this schema
 * is `.strict()`**: a server that started sending one would fail loudly
 * at the seam instead of a screen quietly rendering it. The one
 * results-related field is `results: { available: false, reason }`,
 * which says "not released" and carries nothing.
 *
 * `status` is the four-value patient vocabulary the server maps to
 * (ORDERED → awaiting_collection, COLLECTED/PROCESSING → in_progress,
 * COMPLETED → completed, CANCELLED → cancelled); the lab's internal
 * workflow states never reach this app.
 */

export const LAB_ORDER_STATUSES = [
  'awaiting_collection',
  'in_progress',
  'completed',
  'cancelled',
] as const;

const placeSchema = z.object({ id: z.string().min(1), name: z.string() });

const labOrderSchema = z
  .object({
    id: z.string().min(1),
    testName: z.string(),
    category: z.string().nullable(),
    specimenType: z.string().nullable(),
    status: z.enum(LAB_ORDER_STATUSES),
    requestedAt: z.string().min(1),
    collectedAt: z.string().nullable(),
    completedAt: z.string().nullable(),
    hospital: placeSchema.nullable(),
    results: z.object({ available: z.literal(false), reason: z.string() }).strict(),
  })
  .strict();

const insuranceSchema = z
  .object({
    providerName: z.string(),
    plan: z.string().nullable(),
    policyNumberLast4: z.string(),
    validUntil: z.string().nullable(),
    isActive: z.boolean(),
  })
  .strict();

const insuranceResponseSchema = z
  .object({
    insurance: insuranceSchema.nullable(),
    authorizations: z.object({ available: z.literal(false), reason: z.string() }).strict(),
  })
  .strict();

export type WireLabOrder = z.infer<typeof labOrderSchema>;
export type WireInsuranceView = z.infer<typeof insuranceResponseSchema>;

const labOrdersResponseSchema = envelopeSchema(paginatedSchema(labOrderSchema));
const insuranceEnvelopeSchema = envelopeSchema(insuranceResponseSchema);

export const patientInfoEndpoints = {
  async labOrders(query: { readonly page?: number | undefined } = {}) {
    const raw = await apiClient.get<unknown>('me/lab-orders', { params: { page: query.page } });
    return parseResponse('GET /me/lab-orders', labOrdersResponseSchema, raw);
  },

  async insurance() {
    const raw = await apiClient.get<unknown>('me/insurance');
    return parseResponse('GET /me/insurance', insuranceEnvelopeSchema, raw);
  },
};
