/**
 * Request validation for the administrator's doctor surface
 * (API §3.4–3.7).
 */

import { z } from 'zod';

/** `doctor_verification_documents.kind` — DB §S1's four values. */
export const VERIFICATION_DOCUMENT_KINDS = [
  'medical_license',
  'degree_certificate',
  'national_id',
  'other',
] as const;

/**
 * The documents that must be approved before a doctor can be verified
 * (RM M9.3 — "enabled only when all required docs approved").
 *
 * `other` is deliberately not required: it is the catch-all a
 * practitioner uploads supporting material under, and requiring it would
 * make verification depend on a document nobody asked for. `national_id`
 * is required because identity is what the `check_identity_match`
 * checkbox on every other document is matched *against*.
 */
export const REQUIRED_VERIFICATION_DOCUMENTS: readonly string[] = [
  'medical_license',
  'degree_certificate',
  'national_id',
];

export const VERIFICATION_STATUSES = ['pending', 'verified', 'rejected', 'docs_requested'] as const;
export const PRACTICE_STATUSES = ['active', 'suspended', 'vacation'] as const;

export const adminDoctorQuerySchema = z.object({
  /** Matches name, contact email or licence number (API §3.4). */
  q: z.string().trim().min(1).max(120).optional(),
  specialtyId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
  verification: z.enum(VERIFICATION_STATUSES).optional(),
  status: z.enum(PRACTICE_STATUSES).optional(),
  /** The "joined" range the roster filters on — `doctors.created_at`. */
  joinedFrom: z.string().datetime({ offset: true }).optional(),
  joinedTo: z.string().datetime({ offset: true }).optional(),
  sort: z
    .enum(['name:asc', 'name:desc', 'joined:asc', 'joined:desc', 'rating:desc'])
    .default('name:asc'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type AdminDoctorQuery = z.infer<typeof adminDoctorQuerySchema>;

/**
 * The reason a destructive decision was taken (API §3.6, §3.7 — P4).
 *
 * Required, trimmed and bounded to the column width. A "P4" action in
 * this platform is one that needs a confirm-with-reason modal, and the
 * reason is the half that survives into the audit trail — an optional
 * one would be an optional audit trail.
 */
const reason = z
  .string()
  .trim()
  .min(3, 'Say why')
  .max(300, 'Keep the reason under 300 characters');

export const decisionReasonSchema = z.object({ reason });

export type DecisionReasonInput = z.infer<typeof decisionReasonSchema>;

/**
 * `POST /doctors/{id}/documents/{docId}/approve`.
 *
 * The three checklist booleans are the reviewer's own attestation (DB
 * §S1), and all three must be true to approve: a document approved with
 * `checkIdentityMatch` false is one the reviewer has said does not
 * belong to this person. The schema takes them rather than defaulting
 * them, so approving is an act with content rather than a button.
 */
export const approveDocumentSchema = z.object({
  authentic: z.literal(true, { message: 'Confirm the document is authentic' }),
  current: z.literal(true, { message: 'Confirm the document is in date' }),
  identityMatch: z.literal(true, { message: 'Confirm the identity matches' }),
});

export type ApproveDocumentInput = z.infer<typeof approveDocumentSchema>;

/** `POST /doctors/{id}/request-documents` — which ones, and why. */
export const requestDocumentsSchema = z.object({
  kinds: z
    .array(z.enum(VERIFICATION_DOCUMENT_KINDS))
    .min(1, 'Name at least one document')
    .max(VERIFICATION_DOCUMENT_KINDS.length),
  reason,
});

export type RequestDocumentsInput = z.infer<typeof requestDocumentsSchema>;
