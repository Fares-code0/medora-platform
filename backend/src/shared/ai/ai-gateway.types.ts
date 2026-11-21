/**
 * The LLM port (RM M16.1, API §11).
 *
 * > "`AiGateway` in `shared/`: provider-agnostic adapter owning every
 * > LLM call; keys server-side only; no other module talks to a
 * > provider."
 *
 * ## Why this is a kernel port and not a service in `modules/ai`
 *
 * The same argument `file-storage.types.ts` makes, with one addition.
 * Storage has six callers; today the assistant has one — but the thing
 * that must be centralised is not the *call*, it is the **credential**.
 * `AI_API_KEY` is read in exactly one place, and the only way to keep
 * that true as M21's report summaries and M16.5's prompt templates grow
 * is for there to be no second place a provider client could plausibly
 * live.
 *
 * The interface is deliberately shaped like a chat completion and not
 * like any one vendor's SDK: messages in, a token stream out. Nothing
 * here names a model family, a `system` parameter convention, or a
 * tool-use protocol, because those are the adapter's business. A caller
 * that had to know which of those the provider wanted would be a caller
 * that breaks when the provider changes — which is the failure the port
 * exists to prevent.
 *
 * ## Streaming is the primitive, not an option
 *
 * `generate` yields deltas. A whole-answer method would have to buffer
 * the stream anyway, and API §11.3 makes SSE the transport — so a port
 * that returned a string would force the one caller that matters to
 * wait for the last token before sending the first. The reverse is
 * cheap: a caller wanting the whole answer concatenates.
 *
 * `AbortSignal` rather than a `cancel()` handle, because cancellation
 * has to reach the HTTP request the adapter has in flight, and
 * `AbortSignal` is what every HTTP client already accepts. M16.4's
 * `stopped` status is a client disconnect propagated through this.
 *
 * ## What the port refuses to carry
 *
 * There is no `patientId`, no `recordId` and no context object. Binding
 * is M16.3's job and happens **above** this line: the module resolves
 * the bound entities through `PatientScopeService`, decides what may be
 * said, and hands this port prose. A gateway that took a patient id
 * would be a gateway that could fetch a chart, and the containment rule
 * of M16.6 — the AI module has no write access to clinical tables, and
 * no read path that bypasses care scope — would have a hole in it at
 * the bottom of the stack.
 */

/** A turn, in the only two roles API §11.2 defines on the wire. */
export type AiRole = 'user' | 'assistant';

export interface AiTurn {
  readonly role: AiRole;
  readonly content: string;
}

/**
 * One request to the model.
 *
 * `system` is separate from `turns` because every provider treats it
 * separately, and folding it into the first user turn — the workaround
 * for providers that do not — is a decision for an adapter that needs
 * it, not a shape every caller must adopt.
 */
export interface AiGenerationRequest {
  /** The grounding prompt: instructions and resolved context, no PHI the caller has not already scoped. */
  readonly system: string;
  /** Conversation so far, oldest first, ending with the user's new turn. */
  readonly turns: readonly AiTurn[];
  /** 0–1 in 0.1 steps (API §11.6). The adapter maps it to the provider's scale. */
  readonly temperature: number;
  /**
   * A ceiling on the answer, derived from `responseLength`. Named for
   * what it bounds rather than for the provider's parameter, which is
   * `max_tokens` on some and `maxOutputTokens` on others.
   */
  readonly maxOutputTokens: number;
  /** `en` | `ar` (API §11.6) — the language the answer should be in. */
  readonly language: string;
}

/**
 * A chunk of the answer.
 *
 * Deltas only — never a cumulative string. A stream that re-sent the
 * whole answer each time would make the transport quadratic in the
 * answer's length, and the SSE contract of API §11.3 says "token
 * deltas".
 */
export interface AiDelta {
  readonly text: string;
}

export interface AiGatewayPort {
  /**
   * Streams the answer, or rejects before yielding anything.
   *
   * Rejecting *before the first delta* matters: M16.4 persists a message
   * as `error` when generation fails, and `complete` when it finishes.
   * A provider failure halfway through is a third case the caller must
   * be able to tell apart, which is why this throws from inside the
   * iterator rather than yielding an error-shaped delta.
   */
  generate(
    request: AiGenerationRequest,
    signal?: AbortSignal,
  ): AsyncIterable<AiDelta>;

  /**
   * What the assistant should call itself (API §11's status card).
   *
   * On the port because it is the provider's fact, not the module's: a
   * hard-coded model name in the AI module would go stale the first time
   * the adapter was pointed somewhere else, and would claim a model the
   * deployment is not actually running.
   */
  describe(): AiModelDescription;
}

export interface AiModelDescription {
  readonly name: string;
  readonly version: string;
  /** False until a provider is configured; `/health` reports the same (ADR-016). */
  readonly configured: boolean;
}

/** DI token — inject the interface, never a concrete class. */
export const AI_GATEWAY = Symbol('AI_GATEWAY');
