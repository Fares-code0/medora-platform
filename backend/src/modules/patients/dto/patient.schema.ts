/**
 * Request validation for the clinician's patient surface (API §4.1,
 * §4.2, §4.6, §4.8).
 *
 * Every bound is a column width or a CHECK in `05-patients.prisma`, so a
 * body this schema accepts is a body the database accepts — the failure
 * a client sees is a field error rather than a constraint violation
 * wearing a 500.
 */

import { z } from 'zod';

import { patchOf } from '../../../common/validation/patch-schema';
import {
  ALERT_SEVERITY_VALUES,
  ALLERGY_SEVERITY_VALUES,
  PATIENT_STATUS_VALUES,
  RISK_LEVEL_VALUES,
} from './patient-enums';

/** The frontend's `phoneRegex`, verbatim — the same one registration uses. */
const phoneRegex = /^\+?[0-9][0-9\s-]{6,18}$/;

export const GENDER_VALUES = ['female', 'male'] as const;
export const BLOOD_TYPE_VALUES = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] as const;

/** `YYYY-MM-DD` and in the past — a patient born tomorrow is a typo. */
const pastDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.getTime() < Date.now();
  }, 'The date of birth must be in the past');

/**
 * `GET /patients` — API §4.1.
 *
 * ## `scope` is an override, not a requirement
 *
 * The contract asks for "auto-detect name/PT-id/phone/MRN + optional
 * `scope`". Auto-detection is what a clinician typing `PT-1042` or a
 * phone number expects, and the override is for the case it guesses
 * wrong — a patient whose name is a string of digits, say. Requiring the
 * scope would make the common case worse to serve the rare one.
 *
 * ## `sort` is a whitelist, and that is a security property
 *
 * An open `sort` parameter is an invitation to order by a column the
 * projection deliberately does not return — and on this table that
 * includes `medical_notes`. Ordering by a column is a slow, reliable
 * oracle over its contents.
 */
export const patientListSchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  scope: z.enum(['name', 'id', 'phone', 'mrn']).optional(),
  status: z.enum(PATIENT_STATUS_VALUES).optional(),
  gender: z.enum(GENDER_VALUES).optional(),
  riskLevel: z.enum(RISK_LEVEL_VALUES).optional(),
  /** A `chronic_conditions.name` — the canonical vocabulary, not free text. */
  condition: z.string().trim().min(1).max(80).optional(),
  ageMin: z.coerce.number().int().min(0).max(130).optional(),
  ageMax: z.coerce.number().int().min(0).max(130).optional(),
  lastVisitFrom: z.string().datetime({ offset: true }).optional(),
  lastVisitTo: z.string().datetime({ offset: true }).optional(),
  /** True filters to patients with a live appointment ahead of them. */
  hasUpcoming: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  sort: z
    .enum(['name:asc', 'name:desc', 'lastVisit:desc', 'lastVisit:asc', 'registered:desc'])
    .default('name:asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type PatientListQuery = z.infer<typeof patientListSchema>;

/**
 * `GET /patients/export` — API §4.10, "CSV respecting current filters".
 *
 * The list's own filters and sort, without paging: the export is the
 * whole filtered list, bounded by `EXPORT_ROW_LIMIT` rather than by a
 * page. Reusing the list schema is what makes "respecting current
 * filters" true by construction — a filter the list accepts and the
 * export ignored would hand back a file wider than the screen it came
 * from.
 */
export const patientExportSchema = patientListSchema.omit({ page: true, pageSize: true });

export type PatientExportQuery = z.infer<typeof patientExportSchema>;

const allergyInput = z.object({
  allergen: z.string().trim().min(1).max(120),
  severity: z.enum(ALLERGY_SEVERITY_VALUES),
  reaction: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(1000).nullable().optional(),
});

/**
 * `POST /patients` — the AddPatientDialog contract (API §4.2).
 *
 * `allergies` and `chronicConditions` are part of **creation**, not a
 * follow-up call, and that is a safety property rather than a
 * convenience: a patient registered at the front desk with a severe
 * penicillin allergy must carry it from the first moment their chart
 * exists, not from whenever a second request happens to land.
 *
 * `chronicConditions` are names from the canonical vocabulary
 * (`chronic_conditions`), because ADR-004 makes that table the single
 * source and a free-text condition cannot be matched by anything
 * downstream.
 */
export const createPatientSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter a full name').max(120),
  dateOfBirth: pastDate,
  gender: z.enum(GENDER_VALUES),
  bloodType: z.enum(BLOOD_TYPE_VALUES),
  phone: z.string().trim().regex(phoneRegex, 'Enter a valid phone number').max(30),
  email: z.string().trim().email('Enter a valid email address').max(160).optional(),
  address: z.string().trim().max(500).optional(),
  medicalNotes: z.string().trim().max(5000).optional(),
  allergies: z.array(allergyInput).max(30).default([]),
  chronicConditions: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
});

export type CreatePatientInput = z.infer<typeof createPatientSchema>;

/**
 * `PATCH /patients/{id}` — API §4.8.
 *
 * Status, risk level and contact details. **Not** `fullName`,
 * `dateOfBirth` or `mrn`: those are the identity a chart is filed under,
 * changing them silently re-points every downstream reference, and a
 * correction to one is a governance action rather than a profile edit.
 * `patients.user_id` is absent for the same reason squared — linking a
 * chart to a login is the identity-proofing decision ADR-030 §4 keeps
 * deliberately open (RA-030.1).
 */
export const updatePatientSchema = z
  .object({
    status: z.enum(PATIENT_STATUS_VALUES).optional(),
    riskLevel: z.enum(RISK_LEVEL_VALUES).optional(),
    phone: z.string().trim().regex(phoneRegex).max(30).optional(),
    email: z.string().trim().email().max(160).nullable().optional(),
    address: z.string().trim().max(500).nullable().optional(),
    medicalNotes: z.string().trim().max(5000).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Send at least one field' });

export type UpdatePatientInput = z.infer<typeof updatePatientSchema>;

/** `POST/PATCH …/allergies` — API §4.6. */
export const createAllergySchema = allergyInput;
export const updateAllergySchema = patchOf(allergyInput).refine(
  (body) => Object.keys(body).length > 0,
  { message: 'Send at least one field' },
);

export type CreateAllergyInput = z.infer<typeof createAllergySchema>;
export type UpdateAllergyInput = z.infer<typeof updateAllergySchema>;

/**
 * `POST/PATCH …/alerts` — API §4.5's clinical alerts (M10.5).
 *
 * `message` is capped at the column's 300 characters. An alert is a
 * banner a clinician cannot dismiss (DB §B12) — it has to be readable at
 * a glance, and a paragraph in that slot is a banner nobody reads.
 */
export const createAlertSchema = z.object({
  severity: z.enum(ALERT_SEVERITY_VALUES),
  message: z.string().trim().min(1, 'Say what the alert is').max(300),
});

export const updateAlertSchema = z
  .object({
    severity: z.enum(ALERT_SEVERITY_VALUES).optional(),
    message: z.string().trim().min(1).max(300).optional(),
    /** Resolving an alert is setting this false — the row is never deleted. */
    active: z.boolean().optional(),
    /**
     * Why it was resolved (BR-DEC-003). Optional — DEC-003 asks for a
     * reason on resolution "if the backend can record it", and the client
     * calling this route today sends none — and accepted only with
     * `active: false`, because it is the reason for *that* act.
     */
    reason: z.string().trim().min(1).max(300).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Send at least one field' })
  .refine((body) => body.reason === undefined || body.active === false, {
    message: 'A reason is recorded when an alert is resolved (active: false)',
    path: ['reason'],
  });

export type CreateAlertInput = z.infer<typeof createAlertSchema>;
export type UpdateAlertInput = z.infer<typeof updateAlertSchema>;

/**
 * The five justification categories ADM-10 offers (`features/admin/phi/
 * phi-access.ts`, `PHI_JUSTIFICATION_CATEGORIES`), transcribed in the
 * same order.
 */
export const REVEAL_CATEGORY_VALUES = [
  'clinical-review',
  'patient-request',
  'safety-investigation',
  'billing-dispute',
  'legal-request',
] as const;

/**
 * `POST /patients/{id}/reveal` — API §4.9, RM M7.3.
 *
 * The justification is required. `patients.revealIdentity` on the admin
 * row is "the right to *elevate*, not standing access: identifiers stay
 * masked until a justification is given and the audit write succeeds"
 * (`permission-catalogue.ts`). The reason floor is ADM-10's
 * `PHI_REASON_MIN_LENGTH`, 12 characters after trimming, so the dialog
 * and the server refuse the same input.
 */
export const revealIdentitySchema = z.object({
  category: z.enum(REVEAL_CATEGORY_VALUES),
  reason: z
    .string()
    .trim()
    .min(12, 'Give a reason of at least 12 characters')
    .max(500),
});

export type RevealIdentityInput = z.infer<typeof revealIdentitySchema>;
