/**
 * The patient assistant's vocabulary — two experiences, one transport.
 *
 * ── Two modes, and they are different products ───────────────────────
 *
 * - **`general`** — "Health assistant". General health information. It is
 *   given NO patient data, by the server, in any turn.
 * - **`personal`** — "My care assistant". Grounded in what the app
 *   already shows the patient: their appointments, the status of their
 *   tests, and the insurance on file. **Not** their results and **not**
 *   their medical record — neither is exposed to anyone through this app
 *   (ADR-050, ADR-031). It needs a linked account.
 *
 * The mode is chosen by the entry point the patient taps, is fixed when
 * the conversation is created, and is never inferred from what they type.
 * This client sends no patient data of its own in either mode; what the
 * personal assistant is grounded in is assembled and audited server-side.
 *
 * ── What this client does NOT do ─────────────────────────────────────
 *
 * It does not classify symptoms, detect emergencies, script a reply or
 * keep a transcript on the device. Red-flag detection runs on the server
 * BEFORE the model and answers with a fixed escalation message; the
 * client renders what it is given and puts the Emergency screen one tap
 * away. `ai-honesty.test.ts` holds those lines.
 */

export const AI_MODES = ['general', 'personal'] as const;
export type AiMode = (typeof AI_MODES)[number];

/** Who said it. Rendered as text, never by alignment or colour alone (WCAG 1.4.1). */
export type AiAuthor = 'patient' | 'assistant';

/** The longest message the server accepts. The composer enforces it. */
export const AI_MESSAGE_MAX_LENGTH = 2000;

export interface AiConversationSummary {
  readonly id: string;
  readonly mode: AiMode;
  readonly title: string | null;
  /** ISO-8601 instant. */
  readonly createdAt: string;
}

/** One rendered turn. */
export interface AiMessage {
  readonly id: string;
  readonly author: AiAuthor;
  readonly body: string;
  /** ISO-8601 instant. Formatted by `utils/datetime`, never computed here. */
  readonly at: string;
  /**
   * The SERVER's red-flag pre-check fired and this is its fixed
   * escalation message, not model output. Rendered prominently with the
   * Emergency route attached.
   */
  readonly escalated?: boolean;
}

export interface AiConversation extends AiConversationSummary {
  readonly messages: readonly AiMessage[];
}

/** One frame of a reply, as the port yields it. */
export type AiTurnEvent =
  | { readonly type: 'delta'; readonly text: string }
  | { readonly type: 'escalation'; readonly text: string }
  | {
      readonly type: 'done';
      readonly messageId: string | null;
      readonly status: string;
      readonly error: string | null;
      readonly escalated: boolean;
    };

export interface AiService {
  createConversation(mode: AiMode): Promise<AiConversationSummary>;
  listConversations(): Promise<readonly AiConversationSummary[]>;
  getConversation(id: string): Promise<AiConversation>;
  deleteConversation(id: string): Promise<void>;
  /** Yields the reply as it arrives; rejects before the first yield on a refusal. */
  sendMessage(conversationId: string, content: string, signal?: AbortSignal): AsyncIterable<AiTurnEvent>;
}

/**
 * What the composer and the transcript are doing.
 *
 * - `idle` — waiting for the patient.
 * - `sending` — the turn has left the composer; nothing has come back.
 * - `responding` — a reply is arriving. What the typing indicator draws.
 * - `failed` — the turn did not complete and can be retried.
 * - `unavailable` — the server answered 503: no assistant is configured.
 *   Not an error to retry past, and deliberately its own state.
 */
export type AiTurnState = 'idle' | 'sending' | 'responding' | 'failed' | 'unavailable';
