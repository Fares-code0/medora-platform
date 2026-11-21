import { z } from 'zod';

import { envelopeSchema, parseResponse } from '@/schemas/envelope';

import { apiClient } from '../client';

/**
 * The HTTP profile adapter — one route, and it is a READ.
 *
 * ── The route ────────────────────────────────────────────────────────
 *
 * `GET /me/profile` (contract §2 P2.1, ✅ LIVE), served by
 * `patient-profile.controller.ts`. `@Authenticated()` rather than
 * patient-only: a doctor or admin calling it gets their own `account`
 * with `patient: null`, because no clinical record links to their user
 * row. That is correct for a self-service route and discloses nothing.
 *
 * `PATCH /me/profile` is **P2.2, blocked by RA-030.2**, and there is no
 * path string for it here. Writing it means choosing a data-ownership
 * policy — which fields a patient may change, who wins when a clinician
 * edits the same field, whether an edit needs verification, and what
 * happens on an unlinked account. None of those is answered.
 *
 * ── `patient: null` is a SUCCESS ─────────────────────────────────────
 *
 * It is the normal state right after signup (ADR-030 §4: account
 * creation and record claiming are separate problems). The contract is
 * explicit about why it is not a 404: *a 404 on one's own profile is
 * indistinguishable from a broken session, and a mobile client's natural
 * response to that is to log the user out.* So `patient` is nullable
 * here, and the mapper treats it as a state rather than a failure.
 *
 * ── Fields that are absent on purpose ────────────────────────────────
 *
 * `mrn`, `status`, `riskLevel`, `medicalNotes`, `assignedDoctorId` and
 * the audit columns are not in this projection and will not be added.
 * `medicalNotes` is a clinician's working note about the patient;
 * `riskLevel` and `status` are clinical triage classifications whose
 * disclosure without clinical context is a patient-safety question, not
 * a UI decision. This schema is an allow-list, so if one ever appeared
 * in a response it would be stripped here before a screen could render
 * it.
 *
 * `age` is derived server-side and never stored (DB §14.5-6). This
 * client does not compute it from `dateOfBirth`, so the two cannot
 * disagree.
 */

const accountSchema = z.object({
  id: z.string().min(1),
  firstName: z.string(),
  lastName: z.string(),
  displayName: z.string().min(1),
  email: z.string().min(1),
  phone: z.string(),
  emailVerified: z.boolean(),
  twoFactorEnabled: z.boolean(),
  avatarUrl: z.string().nullable(),
});

/**
 * `gender` and `bloodType` arrive as the WIRE vocabulary — `female`,
 * `O+` — not the Prisma member names (`FEMALE`, `O_POSITIVE`). ADR-023
 * §2 makes that mapping the API layer's job and it is done server-side,
 * so this client reads plain strings and does not own a second mapping
 * table that could drift.
 */
const patientRecordSchema = z.object({
  id: z.string().min(1),
  fullName: z.string(),
  dateOfBirth: z.string(),
  age: z.number(),
  gender: z.string(),
  bloodType: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  photoUrl: z.string().nullable(),
  registeredAt: z.string(),
  lastVisitAt: z.string().nullable(),
});

const profileSchema = z.object({
  account: accountSchema,
  patient: patientRecordSchema.nullable(),
});

const profileResponseSchema = envelopeSchema(profileSchema);

export type WireProfile = z.infer<typeof profileSchema>;
export type WireAccount = z.infer<typeof accountSchema>;
export type WirePatientRecord = z.infer<typeof patientRecordSchema>;

export const profileEndpoints = {
  async get() {
    const raw = await apiClient.get<unknown>('me/profile');
    return parseResponse('GET /me/profile', profileResponseSchema, raw);
  },
};
