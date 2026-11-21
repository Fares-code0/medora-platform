/**
 * Request validation for the child CRUD of API §4.6.
 *
 * Every bound is a column width in `05-patients.prisma`. The vital-sign
 * ranges are the exception and are not column widths: they are
 * physiological plausibility limits, and the reason they are here rather
 * than left to a CHECK is that a typo — 1200 for a systolic pressure —
 * should come back as a field error a nurse can correct, not as a
 * constraint violation wearing a 500.
 */

import { z } from 'zod';

import { patchOf } from '../../../common/validation/patch-schema';

import { DOCUMENT_CATEGORY_VALUES } from './patient-enums';

/** The frontend's `phoneRegex`, verbatim. */
const phoneRegex = /^\+?[0-9][0-9\s-]{6,18}$/;

export const HISTORY_KINDS = [
  'diagnosis',
  'surgery',
  'procedure',
  'hospitalization',
  'vaccination',
] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/**
 * `POST …/history` — a timeline event.
 *
 * `occurredOn` may be today but not the future: a surgery scheduled for
 * next week is an appointment, and recording it as history would put it
 * on the timeline as something that happened.
 */
export const createHistorySchema = z.object({
  kind: z.enum(HISTORY_KINDS),
  title: z.string().trim().min(1, 'Name the event').max(200),
  occurredOn: isoDate.refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.getTime() <= Date.now();
  }, 'A history event cannot be in the future'),
  detail: z.string().trim().max(5000).nullable().optional(),
  facility: z.string().trim().max(120).nullable().optional(),
});

export type CreateHistoryInput = z.infer<typeof createHistorySchema>;

/**
 * `DELETE …/history/{eventId}` — the reason is **mandatory** (BR-DEC-003,
 * DEC-003: history removal "with a **mandatory reason**", for an event
 * "added in error"). It is persisted on the removed row, not only logged.
 * 300 characters, the ceiling the platform's other P4 reasons use.
 */
export const removeHistorySchema = z.object({
  reason: z.string().trim().min(1, 'A reason is required to remove a history event').max(300),
});

export type RemoveHistoryInput = z.infer<typeof removeHistorySchema>;

/** `POST/PATCH …/emergency-contacts`. */
export const createEmergencyContactSchema = z.object({
  name: z.string().trim().min(1, 'Name the contact').max(120),
  relationship: z.string().trim().min(1, 'Say how they are related').max(60),
  phone: z.string().trim().regex(phoneRegex, 'Enter a valid phone number').max(30),
  /**
   * At most one primary contact, enforced by a partial unique index in
   * the schema. The service clears the flag on the others rather than
   * letting the insert fail, because "you already have a primary
   * contact" is not something a user should have to resolve by hand.
   */
  isPrimary: z.boolean().default(false),
});

export const updateEmergencyContactSchema = patchOf(createEmergencyContactSchema).refine(
  (body) => Object.keys(body).length > 0,
  { message: 'Send at least one field' },
);

export type CreateEmergencyContactInput = z.infer<typeof createEmergencyContactSchema>;
export type UpdateEmergencyContactInput = z.infer<typeof updateEmergencyContactSchema>;

/**
 * `DELETE …/emergency-contacts/{contactId}` — the reason is **optional**
 * (BR-DEC-003 point 2, "optional-or-mandatory"). DEC-003 makes it required
 * "**if** the backend can record it", which is the client's to enforce now
 * that it can: the client calling this route today sends no body, and a
 * server-side requirement would break it on deploy.
 */
export const removeContactSchema = z.object({
  reason: z.string().trim().min(1).max(300).optional(),
});

export type RemoveContactInput = z.infer<typeof removeContactSchema>;

/**
 * `POST …/notes` — a clinical note.
 *
 * `signed` is absent: a note is created unsigned and signed through
 * `POST …/notes/{id}/sign`, because signing is an attestation with its
 * own timestamp and its own audit event rather than a field on a form.
 * `aiAssisted` **is** here, because the provenance belongs to the draft
 * — a note written from an AI draft is AI-assisted whether or not the
 * clinician rewrote every word, and it is the client that knows.
 */
export const createNoteSchema = z.object({
  title: z.string().trim().min(1, 'Give the note a title').max(200),
  body: z.string().trim().min(1, 'Write the note').max(20_000),
  aiAssisted: z.boolean().default(false),
});

export const updateNoteSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    body: z.string().trim().min(1).max(20_000).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, { message: 'Send at least one field' });

export type CreateNoteInput = z.infer<typeof createNoteSchema>;
export type UpdateNoteInput = z.infer<typeof updateNoteSchema>;

/**
 * `POST …/vitals` — one reading.
 *
 * **Blood pressure is two numbers** (API §4.6's "systolic/diastolic
 * split", DB §14.5-14). A `"128/82"` string cannot be range-checked and
 * cannot be charted, and both are requirements.
 *
 * `bmi` is deliberately not accepted: it is a stored generated column
 * that Postgres computes from weight and height on write, so a client
 * value would either be ignored or — worse — be believed and disagree
 * with its own inputs.
 */
export const createVitalsSchema = z
  .object({
    systolic: z.number().int().min(40).max(300),
    diastolic: z.number().int().min(20).max(200),
    heartRate: z.number().int().min(20).max(300),
    temperatureC: z.number().min(25).max(45),
    respiratoryRate: z.number().int().min(4).max(80),
    oxygenSaturation: z.number().int().min(50).max(100),
    weightKg: z.number().min(0.5).max(500),
    heightCm: z.number().min(20).max(260),
    /** Defaults to now; supplied when a reading is entered after the fact. */
    recordedAt: z.string().datetime({ offset: true }).optional(),
  })
  .refine((body) => body.systolic > body.diastolic, {
    message: 'Systolic pressure must exceed diastolic',
    path: ['systolic'],
  });

export type CreateVitalsInput = z.infer<typeof createVitalsSchema>;

/**
 * `POST …/documents` — link an upload to the chart's Documents tab.
 *
 * The bytes arrive through `POST /files` with `kind: patient_document`,
 * which owns the type and size rules, the checksum and the scan queue
 * (M25.1). This body only files that upload under a patient and a
 * category — the shape `POST /medical-records/{id}/attachments` uses, so
 * the platform keeps one upload path. The name is the one the file was
 * uploaded under.
 */
export const linkDocumentSchema = z.object({
  fileId: z.string().uuid('Upload the file through /files first and send its id'),
  category: z.enum(DOCUMENT_CATEGORY_VALUES),
});

export type LinkDocumentInput = z.infer<typeof linkDocumentSchema>;

/** Page parameters for the tab feeds. */
export const tabQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type TabQuery = z.infer<typeof tabQuerySchema>;
