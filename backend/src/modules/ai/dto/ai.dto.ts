/**
 * Assistant response shapes (RM M16, API §11).
 *
 * Mirrors of `features/doctor/ai/model/types.ts`, which is rank-1 source
 * (MG §18.5: "field names/shapes in `features/**\/model/types.ts` are
 * the contract"). Where this file departs from that mirror it says so at
 * the field.
 */

/** `AiConversationContext`, with one field the mock could not have. */
export interface AiContextView {
  readonly mode: string;
  /** `PT-…`, or null in `general` mode. */
  readonly patientId: string | null;
  /**
   * The bound patient's name, resolved server-side.
   *
   * The frontend types this and its mock filled it from a local store.
   * Here it is read through the same care-scoped query that authorised
   * the binding, so a client cannot put a name on a thread it has no
   * right to see — `contextLabel()` renders it into the thread header.
   */
  readonly patientName: string | null;
  /** `MR-…` | `LAB-…` | `RX-…`, or null. */
  readonly refId: string | null;
}

/** `ChatMessage`. */
export interface AiMessageView {
  readonly id: string;
  readonly role: string;
  readonly content: string;
  readonly createdAt: string;
  /** `complete` | `stopped` | `error`. */
  readonly status: string;
  /** User-facing error line when `status` is `error`; null otherwise. */
  readonly error: string | null;
  /**
   * `-1` | `1` | null — the §11.7 thumbs.
   *
   * Not on the frontend's `ChatMessage`, and additive for the reason
   * M13.6's `prescriptionId` was: the rating is persisted (DB §H2's
   * `feedback`), so a client that could not read it back would render a
   * thumb as un-pressed after a refresh and invite the doctor to rate
   * the same answer twice.
   */
  readonly feedback: number | null;
}

/** `AiConversation`, minus `messages` — the list row. */
export interface AiConversationView {
  readonly id: string;
  readonly title: string;
  readonly context: AiContextView;
  readonly favorite: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  /**
   * How many turns the thread holds.
   *
   * The list does not carry the messages — a doctor with fifty threads
   * would otherwise download every word of every one to render a
   * sidebar — but an empty thread and a fifty-turn thread must not look
   * alike in it.
   */
  readonly messageCount: number;
}

/** `AiConversation` in full — API §11.2. */
export interface AiConversationDetailView extends AiConversationView {
  readonly messages: readonly AiMessageView[];
}

/** `AiPrompt` — API §11.5. */
export interface AiPromptView {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly message: string;
  /** Ranking affinity only, "never a gate" (the frontend's own words). */
  readonly affinity: string | null;
  /** Whether this template is in the caller's `favoritePromptIds`. */
  readonly favorite: boolean;
}

/** `AiSettings` — API §11.6. */
export interface AiSettingsView {
  readonly temperature: number;
  readonly responseLength: string;
  readonly language: string;
  readonly autoContext: boolean;
  readonly streaming: boolean;
  readonly favoritePromptIds: readonly string[];
}

/**
 * The assistant's identity card (API §11's status panel).
 *
 * `configured` is the honest half: the frontend's constants call the
 * mock "Medora Clinical Assistant (mock)" precisely so a reader can tell
 * it apart from a real model, and this is the server's version of that
 * distinction.
 */
export interface AiModelView {
  readonly name: string;
  readonly version: string;
  readonly configured: boolean;
}
