/**
 * Staff-mediated patient account linking (ADR-048, contract §1).
 *
 * `verification` records *how* the person was identified, never *what* the
 * document said: there is no field for a document number, so none can be
 * stored. `attestedBy` is the caller — the session, not the body.
 */

import { z } from 'zod';

export const ID_DOCUMENT_TYPES = [
  'national_id',
  'passport',
  'residence_permit',
  'driving_licence',
] as const;

export const accountLinkSchema = z.object({
  // Bounded loosely here; `normalizeLinkCode` decides what is a code, so a
  // malformed one is the same `link_code_invalid` as an unknown one.
  code: z.string().trim().min(1).max(32),
  verification: z
    .object({
      method: z.literal('in_person_id_document'),
      documentType: z.enum(ID_DOCUMENT_TYPES),
    })
    .strict(),
});

export type AccountLinkInput = z.infer<typeof accountLinkSchema>;
