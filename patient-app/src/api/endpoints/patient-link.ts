import { z } from 'zod';

import { envelopeSchema, parseResponse } from '@/schemas/envelope';

import { apiClient } from '../client';

/**
 * The HTTP patient-link adapter — staff-mediated account linking (ADR-048,
 * resolving RA-030.1 / OQ-02 as the method: linking happens at the
 * hospital desk after in-person identity verification by staff).
 *
 * ── The two routes, and nothing else ────────────────────────────────
 *
 *   GET  /me/patient-link        → { linked, patient: { id, fullName } | null }
 *   POST /me/patient-link/code   → 201 { code, expiresAt }
 *
 * Both are `@Authenticated()` and patient-only: any other role is
 * `403 patient_only`, which the GET doubles as the app's eligibility probe
 * (`features/auth/eligibility.ts`). The POST answers `409 already_linked`
 * for an account that is already linked, which the screen treats as "read
 * the state again", not as an error.
 *
 * The staff half — `POST/DELETE /patients/:patientId/account-link`, which
 * consumes the code after checking an identity document — is a clinician
 * route and has no path string in this client. There is no self-service
 * claim and no email matching: the patient's only part is to show a code.
 *
 * ── The code ────────────────────────────────────────────────────────
 *
 * Eight characters from `A-Z2-9` without the ambiguous ones, displayed
 * grouped 4-4. The server stores only a hash, gives it a 15-minute TTL,
 * and invalidates the previous code when a new one is issued. This schema
 * checks the shape it will render and nothing more: the alphabet is the
 * server's to choose, and refusing a code over a character this client
 * did not expect would strand a patient at the desk.
 */

const linkedPatientSchema = z.object({
  id: z.string().min(1),
  fullName: z.string(),
});

const linkStateSchema = z.object({
  linked: z.boolean(),
  patient: linkedPatientSchema.nullable(),
});

const linkCodeSchema = z.object({
  code: z.string().regex(/^[A-Z0-9]{8}$/),
  expiresAt: z.string().min(1),
});

const linkStateResponseSchema = envelopeSchema(linkStateSchema);
const linkCodeResponseSchema = envelopeSchema(linkCodeSchema);

export type WirePatientLinkState = z.infer<typeof linkStateSchema>;
export type WirePatientLinkCode = z.infer<typeof linkCodeSchema>;

export const patientLinkEndpoints = {
  async getState() {
    const raw = await apiClient.get<unknown>('me/patient-link');
    return parseResponse('GET /me/patient-link', linkStateResponseSchema, raw);
  },

  async issueCode() {
    const raw = await apiClient.post<unknown>('me/patient-link/code');
    return parseResponse('POST /me/patient-link/code', linkCodeResponseSchema, raw);
  },
};
