import { z } from 'zod';

/**
 * Patient assistant request bodies (ADR-050, contract §6).
 *
 * `.strict()` on both: a client cannot smuggle a `patientId`, a context or
 * a system prompt into a patient thread — the server decides all of it.
 */

export const PATIENT_AI_MODES = ['general', 'personal'] as const;

export const createPatientConversationSchema = z
  .object({
    mode: z.enum(PATIENT_AI_MODES),
  })
  .strict();

export type CreatePatientConversationInput = z.infer<typeof createPatientConversationSchema>;

export const sendPatientMessageSchema = z
  .object({
    content: z.string().trim().min(1).max(2_000),
    /** The language of the fixed escalation copy and of the answer; falls back to the user's setting. */
    locale: z.enum(['en', 'ar']).optional(),
  })
  .strict();

export type SendPatientMessageInput = z.infer<typeof sendPatientMessageSchema>;
