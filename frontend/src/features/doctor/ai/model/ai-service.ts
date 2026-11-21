import type {
  AiConversation,
  AiConversationContext,
  AiSettings,
} from './types';

/**
 * The assistant port — D-09 (FRONTEND_CHECKLIST §3.5, §9 row 4).
 *
 * **What this row is, and is not.** §9 row 4 records the frontend half as
 * built: the chat surface, the streaming render, the token rendering and the
 * error/retry states all exist and are not what is missing. What was missing
 * is the seam. `api/useAiQueries.ts` and `hooks/useChatSession.ts` imported
 * `mock/mock-ai-service` **directly**, which is the one thing
 * `docs/handoff/auth-seam.md` §1 rule 3 forbids — "nothing downstream may
 * import an adapter", the exact defect that doc was written about
 * (`AuthProvider` hard-importing `mock/mock-auth-service`). Every consumer
 * now goes through `../service`, so a model service arrives as one new
 * adapter and a `selectService` call rather than an edit to the chat.
 *
 * **The port is not "what the mock happens to do."** Typed as an assistant
 * API would answer, per rule 2:
 *
 *  · `generateReply` is a **whole-answer** promise, not a stream. The token
 *    animation in `useChatSession` is a render-time affordance over the text
 *    it already holds, and calling it a stream in the port would promise a
 *    transport nothing implements. A real SSE adapter adds a method; it does
 *    not silently change what this one means.
 *  · `attempt` is on the input because retry semantics belong to the
 *    caller — the UI decides a failure is retryable, and a real backend
 *    needs to know it is seeing a retry (idempotency, rate limiting).
 *  · Conversation CRUD stays on the port even though today it is
 *    `localStorage`: the moment conversations are server-side, the same four
 *    methods carry them, and the chat is already written against these.
 *
 * **`createConversation` is synchronous, and stays that way.** Creating one
 * gates navigation to `?c=<id>`, so it must not depend on an async callback
 * React can legitimately drop across a remount. A server-backed adapter
 * mints a local id and reconciles, which is the same shape.
 */

/** Thrown/rejected identifier for a generation that failed. */
export const AI_GENERATION_FAILED = 'AI_GENERATION_FAILED';

export interface GenerateReplyInput {
  readonly prompt: string;
  /** Suggested-prompt id when the message came from a prompt card. */
  readonly promptId: string | null;
  readonly context: AiConversationContext;
  readonly settings: AiSettings;
  /** 1 on first send; retries pass 2+. */
  readonly attempt: number;
}

export interface CreateConversationInput {
  readonly context: AiConversationContext;
  readonly title?: string;
  /** Seed a context-aware assistant greeting as the first message. */
  readonly seedGreeting?: boolean;
}

export type ConversationPatch = Partial<
  Pick<AiConversation, 'title' | 'favorite' | 'messages' | 'context'>
>;

export interface AiService {
  /* ── Conversation CRUD ───────────────────────────────────────── */
  listConversations(): Promise<readonly AiConversation[]>;
  /** Synchronous by contract — see the note above. */
  createConversation(input: CreateConversationInput): AiConversation;
  updateConversation(conversationId: string, patch: ConversationPatch): Promise<AiConversation>;
  deleteConversation(conversationId: string): Promise<void>;

  /* ── Generation ──────────────────────────────────────────────── */
  /**
   * One complete answer, in Markdown. Rejects with `AI_GENERATION_FAILED`
   * when the assistant could not answer; the caller owns whether that is
   * retryable and renders the retry affordance.
   */
  generateReply(input: GenerateReplyInput): Promise<string>;
}
