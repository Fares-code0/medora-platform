import { z } from 'zod';

import { envelopeSchema, paginatedSchema, parseResponse } from '@/schemas/envelope';

import { apiClient } from '../client';

/**
 * Hospital discovery — patient-app end-to-end contract §2.
 *
 *   GET /patient/hospitals?q&page&pageSize   active hospitals only
 *   GET /patient/hospitals/{id}              one hospital, with what the schema has
 *
 * Absent fields arrive as `null` and render as absent — never as a
 * plausible invention. The schemas are an allow-list (`z.object` strips
 * unknown keys), like `doctors.ts`.
 */

const refSchema = z.object({ id: z.string().min(1), name: z.string().min(1) });

const summarySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  city: z.string().nullable(),
  clinicCount: z.number(),
  departmentCount: z.number(),
});

const locationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  addressLine: z.string().nullable(),
  city: z.string().nullable(),
  timezone: z.string().nullable(),
});

const detailSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  phone: z.string().nullable(),
  clinics: z.array(refSchema),
  locations: z.array(locationSchema),
  departments: z.array(refSchema),
  specialties: z.array(refSchema),
});

const listResponseSchema = envelopeSchema(paginatedSchema(summarySchema));
const detailResponseSchema = envelopeSchema(detailSchema);

export type WireHospitalSummary = z.infer<typeof summarySchema>;
export type WireHospitalDetail = z.infer<typeof detailSchema>;

export interface HospitalListQuery {
  readonly q?: string | undefined;
  readonly page?: number | undefined;
}

export const hospitalEndpoints = {
  async list(query: HospitalListQuery, signal?: AbortSignal) {
    const raw = await apiClient.get<unknown>('patient/hospitals', {
      params: { q: query.q, page: query.page },
      ...(signal ? { signal } : {}),
    });
    return parseResponse('GET /patient/hospitals', listResponseSchema, raw);
  },

  async byId(hospitalId: string, signal?: AbortSignal) {
    const raw = await apiClient.get<unknown>(
      `patient/hospitals/${encodeURIComponent(hospitalId)}`,
      signal ? { signal } : {},
    );
    return parseResponse('GET /patient/hospitals/{id}', detailResponseSchema, raw);
  },
};
