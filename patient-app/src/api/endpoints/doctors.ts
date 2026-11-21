import { z } from 'zod';

import { envelopeSchema, paginatedSchema, parseResponse } from '@/schemas/envelope';

import { apiClient } from '../client';

/**
 * The HTTP doctor-discovery adapter.
 *
 * ── Every path in this file exists in the backend today ──────────────
 *
 * Transcribed from `patient-doctor.controller.ts` and specified in
 * `backend/docs/PATIENT_MOBILE_API_CONTRACT.md` §3, where all three are
 * marked ✅ LIVE:
 *
 *   GET /patient/doctors           P3.1  :45
 *   GET /patient/doctors/{id}      P3.2  :52
 *   GET /patient/specialties       P3.3  :57
 *
 * `GET /patient/departments` (P3.4) is **not built** — `departments`
 * belongs to the administration module (ADR-004, M23) and the doctors
 * module deliberately does not read it. There is therefore no
 * departments call in this file, and no plausible-looking path for one.
 * Filtering BY `departmentId` works today; listing the departments does
 * not.
 *
 * ── These are not `GET /doctors` ─────────────────────────────────────
 *
 * API §3.4's `GET /doctors` is the ADMINISTRATOR roster, gated on
 * `can:doctors.manage`, returning the internal Doctor entity with the
 * practitioner's licence number and personal phone on it. The routes
 * here are a separate server-side projection (ADR-030 §10). Pointing this
 * client at the admin route would disclose exactly what
 * `docs/PUBLIC_PROJECTIONS.md` forbids, so the distinction is worth
 * stating in the file that could get it wrong.
 *
 * ── The schemas are an allow-list, and that is load-bearing ──────────
 *
 * `z.object` STRIPS unknown keys. So a response that regressed and
 * carried `licenseNumber` would have it removed here, at the seam,
 * before any screen or cache could see it. That is a second line of
 * defence and not the first: the real control is the server's own
 * contract test asserting the forbidden keys are absent from the
 * serialized body (contract §3, `FORBIDDEN_DOCTOR_FIELDS`). A field
 * stripped by this client has still crossed the wire and still sits in
 * every proxy log — frontend authorization is not authorization.
 *
 * Being an allow-list also makes the failure direction right: a backend
 * that ADDS a field does not break this client, and a backend that
 * REMOVES one fails loudly at the seam rather than as `undefined` three
 * components deep.
 */

/**
 * `ratingAvg` is a SQL `DECIMAL` converted server-side, and the contract
 * (§3 P3.2) states it arrives as a number or null — never an object.
 * Declaring it that way means a driver change that started sending
 * `{ d: [...] }` fails here instead of rendering "[object Object]" as a
 * doctor's rating.
 */
const summarySchema = z.object({
  id: z.string().min(1),
  fullName: z.string().min(1),
  title: z.string().nullable(),
  specialty: z.string(),
  departmentName: z.string().nullable(),
  photoUrl: z.string().nullable(),
  yearsOfExperience: z.number().nullable(),
  languages: z.array(z.string()),
  ratingAvg: z.number().nullable(),
});

const detailSchema = summarySchema.extend({
  biography: z.string().nullable(),
  education: z.array(z.string()),
  certifications: z.array(z.string()),
  skills: z.array(z.string()),
  officeLocation: z.string().nullable(),
  officeHours: z.string().nullable(),
  specialties: z.array(z.object({ id: z.string(), name: z.string() })),
});

/**
 * `parentId` is present on the specialties response (contract §3.3) and
 * this client does not use it — the chips are flat. It is declared
 * anyway so the shape is transcribed rather than half-remembered.
 */
const specialtySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  parentId: z.string().nullable().optional(),
});

const searchResponseSchema = envelopeSchema(paginatedSchema(summarySchema));
const detailResponseSchema = envelopeSchema(detailSchema);
const specialtiesResponseSchema = envelopeSchema(z.array(specialtySchema));

export type WireDoctorSummary = z.infer<typeof summarySchema>;
export type WireDoctorDetail = z.infer<typeof detailSchema>;
export type WireSpecialty = z.infer<typeof specialtySchema>;
export type WireDoctorSearch = z.infer<typeof searchResponseSchema>;

/**
 * Query parameters, bounded by `doctorSearchSchema` on the server.
 *
 * `pageSize` and `sort` are deliberately NOT sent. The server defaults
 * are 20 and `name:asc`, out-of-range values are rejected with 422
 * rather than clamped (contract §3.1), and this client has no UI for
 * either — sending a value it cannot let a patient change would be
 * inventing a preference.
 */
export interface DoctorSearchQuery {
  readonly q?: string | undefined;
  readonly specialtyId?: string | undefined;
  readonly departmentId?: string | undefined;
  readonly page?: number | undefined;
}

export const doctorEndpoints = {
  async search(query: DoctorSearchQuery, signal?: AbortSignal): Promise<WireDoctorSearch> {
    const raw = await apiClient.get<unknown>('patient/doctors', {
      params: {
        q: query.q,
        specialtyId: query.specialtyId,
        departmentId: query.departmentId,
        page: query.page,
      },
      ...(signal ? { signal } : {}),
    });
    return parseResponse('GET /patient/doctors', searchResponseSchema, raw);
  },

  /**
   * `doctors` has no public `doc_…` handle — the id is the raw uuid
   * (contract §3.1). A malformed one answers 404, not 500, and an
   * unverified or inactive practitioner answers 404 as well, so the
   * route cannot be used to discover that a suspended doctor exists.
   */
  async byId(doctorId: string, signal?: AbortSignal) {
    const raw = await apiClient.get<unknown>(
      `patient/doctors/${encodeURIComponent(doctorId)}`,
      signal ? { signal } : {},
    );
    return parseResponse('GET /patient/doctors/{id}', detailResponseSchema, raw);
  },

  async specialties(signal?: AbortSignal) {
    const raw = await apiClient.get<unknown>('patient/specialties', signal ? { signal } : {});
    return parseResponse('GET /patient/specialties', specialtiesResponseSchema, raw);
  },
};
