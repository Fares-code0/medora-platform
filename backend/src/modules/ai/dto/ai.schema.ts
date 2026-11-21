/**
 * Request validation for the assistant (RM M16, API §11).
 *
 * The bounds are the database's, restated so a violation is a 422 naming
 * the field rather than a constraint error the client cannot read:
 * `ai_conversations.title` is `VarChar(200)`, `ref_public_id` is
 * `VarChar(20)`, `ai_user_settings.temperature` is `Decimal(2,1)`.
 */

import { z } from 'zod';

import {
  AI_CONTEXT_MODE_VALUES,
  AI_LANGUAGE_VALUES,
  AI_RESPONSE_LENGTH_VALUES,
} from './ai-enums';

/** `PT-…`, `MR-…`, `LAB-…`, `RX-…` — never uuids on the wire. */
const handle = z.string().trim().min(1).max(20);

/**
 * API §11.4 — the context a client may ask for.
 *
 * **Ids only, and never a name.** `AiConversationContext` on the
 * frontend carries `patientName`, and it is deliberately not accepted
 * here: the server resolves it from the bound patient (M16.3), and a
 * name a client could supply would be a name the server would echo into
 * a thread header without ever checking it belonged to the patient.
 *
 * The cross-field rules — which modes require a patient, which also
 * require a `refId` — are **not** in this schema. They live in the
 * service, because refusing them here would produce a 422 where M16.3
 * requires a 409: "partial or failed resolution ⇒ 409, no generation".
 * The distinction is real. A body that names no patient in `patient`
 * mode is malformed (422); a body that names one the caller cannot
 * reach, or one that has been deleted, is well-formed and unresolvable
 * (409), and the two must not be collapsed — a 422 on the second would
 * tell a client to fix its request when the answer is that the request
 * was never permitted.
 */
export const aiContextSchema = z.object({
  mode: z.enum(AI_CONTEXT_MODE_VALUES),
  patientId: handle.optional(),
  refId: handle.optional(),
});

export type AiContextInput = z.infer<typeof aiContextSchema>;

/** API §11.1 — `POST /ai/conversations`. */
export const createConversationSchema = z.object({
  context: aiContextSchema,
  /**
   * Optional: a thread's opening question is a better title than
   * anything a client can invent before one is asked, so the server
   * derives one from the first message when none is given.
   */
  title: z.string().trim().min(1).max(200).optional(),
});

export type CreateConversationInput = z.infer<typeof createConversationSchema>;

/**
 * API §11.1 — `PATCH /ai/conversations/{id}`.
 *
 * Title and favourite only. **The context is not patchable**, and that
 * is a containment rule rather than an omission: re-pointing an existing
 * thread at a different patient is precisely how "one patient maximum
 * per conversation" (M16.3) would be defeated — the history would stay
 * and the binding would move, leaving turns about one patient under
 * another patient's context. A different patient is a different thread.
 */
export const updateConversationSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    favorite: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Send at least one field to change',
  });

export type UpdateConversationInput = z.infer<typeof updateConversationSchema>;

/** API §11.1 — `GET /ai/conversations?q=&favorite=`. */
export const listConversationsSchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  favorite: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export type ListConversationsQuery = z.infer<typeof listConversationsSchema>;

/** API §11.3 — `POST /ai/conversations/{id}/messages`. */
export const sendMessageSchema = z.object({
  /**
   * 8 000 characters. Generous for a clinical question and far short of
   * what would let a caller push a provider's context window around as
   * a denial-of-service against the deployment's own spend.
   */
  content: z.string().trim().min(1).max(8_000),
  /** The suggested-prompt card this came from, when it came from one. */
  promptId: handle.optional(),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;

/**
 * API §11.6 — `PUT /me/ai-settings`.
 *
 * Every field required: this is a PUT of the whole document, which is
 * what the contract says and what the settings drawer sends. The
 * temperature rule is the contract's own — "0–1 (0.1 steps)" — and the
 * step is enforced rather than merely the range, because
 * `AI_TEMPERATURES` on the frontend is an eleven-element array and a
 * slider that can only produce those values would be silently
 * contradicted by an API that accepted 0.37.
 */
export const updateAiSettingsSchema = z.object({
  temperature: z
    .number()
    .min(0)
    .max(1)
    // Compared with a tolerance rather than `value * 10 % 1 === 0`:
    // 0.3 * 10 is 2.9999999999999996 in IEEE 754, so the exact test
    // would reject a value the frontend's own slider produces.
    .refine((value) => Math.abs(value * 10 - Math.round(value * 10)) < 1e-9, {
      message: 'must be between 0 and 1 in steps of 0.1',
    }),
  responseLength: z.enum(AI_RESPONSE_LENGTH_VALUES),
  language: z.enum(AI_LANGUAGE_VALUES),
  autoContext: z.boolean(),
  streaming: z.boolean(),
  /**
   * `ai_user_settings.favorite_prompt_ids` is `uuid[]`, so these are the
   * template rows' ids. Capped at the catalogue's plausible size: a
   * favourites list longer than the library is a client bug, not a
   * preference.
   */
  favoritePromptIds: z.array(z.string().trim().uuid()).max(50),
});

export type UpdateAiSettingsInput = z.infer<typeof updateAiSettingsSchema>;

/** API §11.7 — `POST /ai/messages/{id}/feedback`. */
export const messageFeedbackSchema = z.object({
  rating: z.enum(['up', 'down']),
});

export type MessageFeedbackInput = z.infer<typeof messageFeedbackSchema>;
