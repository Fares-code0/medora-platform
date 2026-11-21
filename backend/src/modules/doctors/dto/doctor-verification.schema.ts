/**
 * Request validation for the doctor's own verification documents
 * (frontend checklist NEW-46).
 */

import { z } from 'zod';

import { VERIFICATION_DOCUMENT_KINDS } from './admin-doctor.schema';

/** `YYYY-MM-DD` naming a day that exists — `2028-02-30` does not. */
function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/**
 * File one upload as a verification document.
 *
 * The bytes go through `POST /files` with `kind=verification_document`
 * first — the size, type, signature and malware rules live there — and
 * this files the id it returned, as `POST /medical-records/:id/attachments`
 * does for a record attachment.
 *
 * `expiresOn` is a calendar date (`YYYY-MM-DD`), the column's type: a
 * licence expires on a day, not at an instant in some timezone.
 */
export const submitVerificationDocumentSchema = z.object({
  fileId: z.string().uuid('Upload the file through /files first and send its id'),
  kind: z.enum(VERIFICATION_DOCUMENT_KINDS),
  expiresOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
    // One refine that cannot throw: zod runs refinements even after the
    // regex has failed, so a value like `2028-02-01T00:00:00Z` reaches
    // here too, and `toISOString()` on an invalid date is a RangeError —
    // a 500 where a field error belongs.
    .refine(isCalendarDate, 'Not a calendar date')
    .optional(),
});

export type SubmitVerificationDocumentInput = z.infer<typeof submitVerificationDocumentSchema>;
