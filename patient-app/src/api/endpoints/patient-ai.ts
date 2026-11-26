import { z } from 'zod';

import { envelopeSchema, parseResponse } from '@/schemas/envelope';

import { apiClient } from '../client';
import { readSseFrames } from '../sse';

/**
 * The patient assistant — `/me/ai/conversations`.
 *
 *   POST   /me/ai/conversations               { mode } → the conversation
 *   GET    /me/ai/conversations               the caller's own
 *   GET    /me/ai/conversations/{id}          one, with its messages
 *   DELETE /me/ai/conversations/{id}          soft delete
 *   POST   /me/ai/conversations/{id}/messages { content } → text/event-stream
 *
 * These are NOT the doctor's `/ai/conversations`: patients hold no
 * `ai.use` permission and never reach that tree.
 *
 * ── Two modes, fixed at creation ─────────────────────────────────────
 *
 * `general` never loads any patient data. `personal` is grounded in the
 * §4 information layer plus the patient's own appointment summaries — no
 * record, no result — assembled and audited SERVER-side. The mode is
 * chosen by which screen the patient entered through and cannot be
 * changed afterwards; this module never sends a patient datum itself.
 *
 * ── The stream ───────────────────────────────────────────────────────
 *
 * Frames mirror the doctor route's: `event: delta` `{ text }` repeated,
 * then `event: done` `{ messageId, status, error }`. A red-flag message
 * is answered by the server WITHOUT calling the model and arrives as the
 * same frames with `escalated: true` (on `done`, or on an `escalation`
 * frame carrying `{ text }`); this client does not classify anything.
 * Unknown frame names are ignored, so an additive server change does not
 * break an older app.
 */

export const AI_MODES = ['general', 'personal'] as const;
export type WireAiMode = (typeof AI_MODES)[number];

const conversationSchema = z.object({
  id: z.string().min(1),
  mode: z.enum(AI_MODES),
  createdAt: z.string().min(1),
  title: z.string().nullable().optional(),
});

const messageSchema = z.object({
  id: z.string().min(1),
  // The doctor route stores `USER`/`ASSISTANT`; read either case.
  role: z.string().transform((value) => value.toLowerCase()),
  content: z.string(),
  createdAt: z.string().min(1),
  escalated: z.boolean().optional().default(false),
});

const conversationDetailSchema = conversationSchema.extend({
  messages: z.array(messageSchema).optional().default([]),
});

/** A bare array or a paginated envelope: the list route's shape is the server's to choose. */
const conversationListSchema = z.union([
  z.array(conversationSchema),
  z.object({ items: z.array(conversationSchema) }).transform((page) => page.items),
]);

export type WireAiConversation = z.infer<typeof conversationSchema>;
export type WireAiConversationDetail = z.infer<typeof conversationDetailSchema>;

export type AiStreamEvent =
  | { readonly type: 'delta'; readonly text: string }
  | { readonly type: 'escalation'; readonly text: string }
  | {
      readonly type: 'done';
      readonly messageId: string | null;
      readonly status: string;
      readonly error: string | null;
      readonly escalated: boolean;
    };

const deltaSchema = z.object({ text: z.string() });
const escalationFrameSchema = z.object({ text: z.string().optional(), content: z.string().optional() });
const doneSchema = z.object({
  messageId: z.string().nullable().optional(),
  status: z.string().optional(),
  error: z.string().nullable().optional(),
  escalated: z.boolean().optional(),
});

function parseJson(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

export const patientAiEndpoints = {
  async createConversation(mode: WireAiMode) {
    const raw = await apiClient.post<unknown>('me/ai/conversations', { mode });
    return parseResponse(
      'POST /me/ai/conversations',
      envelopeSchema(conversationSchema),
      raw,
    );
  },

  async listConversations() {
    const raw = await apiClient.get<unknown>('me/ai/conversations');
    return parseResponse(
      'GET /me/ai/conversations',
      envelopeSchema(conversationListSchema),
      raw,
    );
  },

  async getConversation(id: string) {
    const raw = await apiClient.get<unknown>(`me/ai/conversations/${encodeURIComponent(id)}`);
    return parseResponse(
      'GET /me/ai/conversations/{id}',
      envelopeSchema(conversationDetailSchema),
      raw,
    );
  },

  async deleteConversation(id: string): Promise<void> {
    await apiClient.delete<unknown>(`me/ai/conversations/${encodeURIComponent(id)}`);
  },

  /**
   * Sends one turn and yields the reply as it arrives.
   *
   * The refusals (503 `service_unavailable`, 409 `patient_not_linked`,
   * 404) are thrown by `openStream` before the first yield, as ordinary
   * `ApiError`s. A frame whose payload does not parse is skipped rather
   * than failing the turn: one malformed delta must not discard a reply
   * the patient is already reading.
   */
  async *sendMessage(
    conversationId: string,
    content: string,
    signal?: AbortSignal,
  ): AsyncGenerator<AiStreamEvent> {
    const response = await apiClient.openStream(
      `me/ai/conversations/${encodeURIComponent(conversationId)}/messages`,
      { content },
      signal === undefined ? {} : { signal },
    );

    for await (const frame of readSseFrames(response)) {
      const payload = parseJson(frame.data);
      if (frame.event === 'delta') {
        const parsed = deltaSchema.safeParse(payload);
        if (parsed.success) yield { type: 'delta', text: parsed.data.text };
      } else if (frame.event === 'escalation') {
        const parsed = escalationFrameSchema.safeParse(payload);
        const text = parsed.success ? (parsed.data.text ?? parsed.data.content) : undefined;
        if (text !== undefined) yield { type: 'escalation', text };
      } else if (frame.event === 'done') {
        const parsed = doneSchema.safeParse(payload ?? {});
        const data = parsed.success ? parsed.data : {};
        yield {
          type: 'done',
          messageId: data.messageId ?? null,
          status: data.status ?? 'COMPLETE',
          error: data.error ?? null,
          escalated: data.escalated ?? false,
        };
        return;
      }
    }
  },
};
