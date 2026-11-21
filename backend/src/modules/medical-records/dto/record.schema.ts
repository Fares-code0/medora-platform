/**
 * Request validation for the clinical document (API §6).
 *
 * ## The three narrative fields are required, and non-empty
 *
 * API §6.3 names `chiefComplaint` as "non-empty" and lists HPI and
 * examination alongside it. `.trim().min(1)` is what makes `"   "` a 422
 * rather than a record whose chief complaint is three spaces — a
 * document that renders as blank in the one field a clinician scans
 * first.
 *
 * ## Children are replaced, not merged
 *
 * A `PATCH` that carries `treatmentPlan` replaces the whole list; one
 * that omits it leaves it alone. Merging would need a per-item identity
 * the client does not have for treatment-plan lines (they are ordered
 * text, not entities), and "the items you did not mention keep what they
 * had" silently preserves a line the doctor believes they deleted — the
 * same reasoning `PUT /me/availability` records for the weekly grid.
 */

import { z } from 'zod';

import {
  ALLERGY_SEVERITY_VALUES,
  ATTACHMENT_KIND_VALUES,
  MEDICATION_STATUS_VALUES,
  RECORD_PRIORITY_VALUES,
  RECORD_STATUS_VALUES,
} from './record-enums';

export type AttachmentKindWire =
  | 'lab-result'
  | 'imaging'
  | 'referral'
  | 'consent'
  | 'external-report';

/** One value or several — Express parses a repeated key into an array. */
function multi(values: [string, ...string[]]) {
  return z
    .union([z.enum(values), z.array(z.enum(values))])
    .transform((value) => (Array.isArray(value) ? value : [value]))
    .optional();
}

const narrative = z.string().trim().min(1).max(20_000);

/** API §6.1 — the list. */
const recordFilters = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  status: multi(RECORD_STATUS_VALUES),
  priority: multi(RECORD_PRIORITY_VALUES),
  visitType: z.string().trim().min(1).max(40).optional(),
  department: z.string().trim().min(1).max(80).optional(),
  /** An ICD-10 code, e.g. `E11.9`. */
  diagnosisCode: z.string().trim().min(1).max(10).optional(),
  patientId: z.string().trim().min(1).max(20).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  sort: z.enum(['visitDate:asc', 'visitDate:desc']).default('visitDate:desc'),
});

function rangeInOrder(query: { from?: Date | undefined; to?: Date | undefined }): boolean {
  return query.from === undefined || query.to === undefined || query.from <= query.to;
}

const RANGE_ORDER = { message: '`from` must not be after `to`', path: ['from'] };

export const recordListSchema = recordFilters
  .extend({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
  })
  .refine(rangeInOrder, RANGE_ORDER);

export type RecordListQuery = z.infer<typeof recordListSchema>;

/**
 * `GET /medical-records/export` — API §6.10. The list's filters, its
 * sort and its range rule, without paging: the export is the filtered
 * list, bounded by `EXPORT_ROW_LIMIT` rather than by a page.
 */
export const recordExportSchema = recordFilters.refine(rangeInOrder, RANGE_ORDER);

export type RecordExportQuery = z.infer<typeof recordExportSchema>;

const diagnosisInput = z.object({
  /** An ICD-10 code the clinic's catalogue carries. */
  code: z.string().trim().min(1).max(10),
  isPrimary: z.boolean().default(false),
});

const medicationInput = z.object({
  name: z.string().trim().min(1).max(120),
  dosage: z.string().trim().min(1).max(60),
  frequency: z.string().trim().min(1).max(60),
  instructions: z.string().trim().max(2000).optional(),
  status: z.enum(MEDICATION_STATUS_VALUES).default('active'),
});

const allergyInput = z.object({
  allergen: z.string().trim().min(1).max(120),
  severity: z.enum(ALLERGY_SEVERITY_VALUES),
  reaction: z.string().trim().min(1).max(200),
});

/**
 * Treatment-plan lines are ordered text, so the wire form is an array of
 * strings and `position` is the index. A client that had to invent
 * positions would eventually send two items at position 3, which the
 * `@@unique([recordId, position])` would reject with a constraint error
 * rather than a field error.
 */
const treatmentPlanInput = z.array(z.string().trim().min(1).max(500)).max(50);

/**
 * At most one primary diagnosis, checked here as well as by the partial
 * unique index.
 *
 * Both, deliberately. The index is the invariant — it holds against a
 * psql session and a future service. This refinement is what turns the
 * violation into a 422 naming the field, instead of a constraint error
 * the client cannot render.
 */
const atMostOnePrimary = (diagnoses: readonly { isPrimary: boolean }[]): boolean =>
  diagnoses.filter((diagnosis) => diagnosis.isPrimary).length <= 1;

export const createRecordSchema = z.object({
  patientId: z.string().trim().min(1).max(20),
  visitDate: z.coerce.date(),
  visitType: z.string().trim().min(1).max(40),
  department: z.string().trim().min(1).max(80).optional(),
  /** `appointments.public_id`, when the visit came from the book. */
  appointmentId: z.string().trim().min(1).max(20).optional(),
  priority: z.enum(RECORD_PRIORITY_VALUES).default('normal'),
  chiefComplaint: narrative,
  historyOfPresentIllness: narrative,
  physicalExamination: narrative,
  followUpDate: z.coerce.date().optional(),
  diagnoses: z.array(diagnosisInput).max(20).refine(atMostOnePrimary, {
    message: 'A record may have at most one primary diagnosis',
  }).optional(),
  treatmentPlan: treatmentPlanInput.optional(),
  medications: z.array(medicationInput).max(50).optional(),
  allergies: z.array(allergyInput).max(50).optional(),
});

export type CreateRecordInput = z.infer<typeof createRecordSchema>;

/**
 * API §6.4 — update.
 *
 * Every field optional, and an empty body is a 422 rather than a no-op
 * that writes a version row saying nothing changed.
 */
export const updateRecordSchema = z
  .object({
    visitDate: z.coerce.date().optional(),
    visitType: z.string().trim().min(1).max(40).optional(),
    department: z.string().trim().min(1).max(80).optional(),
    priority: z.enum(RECORD_PRIORITY_VALUES).optional(),
    chiefComplaint: narrative.optional(),
    historyOfPresentIllness: narrative.optional(),
    physicalExamination: narrative.optional(),
    followUpDate: z.coerce.date().nullable().optional(),
    diagnoses: z.array(diagnosisInput).max(20).refine(atMostOnePrimary, {
      message: 'A record may have at most one primary diagnosis',
    }).optional(),
    treatmentPlan: treatmentPlanInput.optional(),
    medications: z.array(medicationInput).max(50).optional(),
    allergies: z.array(allergyInput).max(50).optional(),
    /**
     * Why the edit was made (BR-DEC-004). Persisted on the version row
     * and served by `GET …/versions`. Optional: DEC-004 says a reason is
     * "accepted and persisted" and does not say it is required.
     */
    reason: z.string().trim().min(1).max(300).optional(),
  })
  // A reason alone changes nothing — it explains a change.
  .refine((body) => Object.keys(body).some((key) => key !== 'reason'), {
    message: 'Send at least one field to change',
  });

export type UpdateRecordInput = z.infer<typeof updateRecordSchema>;

/** API §6.5 — the guarded lifecycle. */
export const recordStatusSchema = z.object({
  status: z.enum(RECORD_STATUS_VALUES),
});

export type RecordStatusInput = z.infer<typeof recordStatusSchema>;

/** API §6.6 — a clinical note. */
export const createNoteSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20_000),
  /**
   * Declared by the client that drafted the note with assistance.
   *
   * Trusted because the alternative is worse: the server cannot detect
   * assistance, and a flag that only the honest set is still more
   * informative than no flag. M16.6 is the containment that matters —
   * the AI module has no write access to clinical tables at all, so this
   * is provenance on a doctor's own note rather than a permission.
   */
  aiAssisted: z.boolean().default(false),
});

export type CreateNoteInput = z.infer<typeof createNoteSchema>;

/** API §6.9 — flag a data error into the admin queue. */
export const reportIssueSchema = z.object({
  description: z.string().trim().min(1).max(2000),
});

export type ReportIssueInput = z.infer<typeof reportIssueSchema>;

/**
 * `POST /medical-records/{id}/attachments` — API §6.7, RM M12.5.
 *
 * The bytes arrive through `POST /files` with `kind: record_attachment`,
 * which owns the per-kind type and size rules, the checksum and the scan
 * queue (M25.1). This body links that upload to the record — the shape
 * messaging uses for `attachmentIds` (§9.4) — so there is one upload path
 * on the platform rather than a second one with its own validation.
 *
 * `name` is optional: the default is the name the file was uploaded
 * under. Capped at `record_attachments.name`'s 200 characters.
 */
export const attachRecordFileSchema = z.object({
  fileId: z.string().uuid('Upload the file through /files first and send its id'),
  kind: z.enum(ATTACHMENT_KIND_VALUES),
  name: z.string().trim().min(1).max(200).optional(),
});

export type AttachRecordFileInput = z.infer<typeof attachRecordFileSchema>;

export const ATTACHMENT_KINDS = ATTACHMENT_KIND_VALUES;
