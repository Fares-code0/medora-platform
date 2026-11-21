/**
 * The assistant's vocabulary and view-model types — checklist K-01, and
 * the presentation half of K-02 … K-04 and L-01 … L-03.
 *
 * ── Read this before adding anything to this directory ──────────────
 *
 * **There is no AI in this application and these types do not imply
 * one.** They describe what the assistant screens *render*, not what
 * produces it. Nothing here is a port, a DTO or a request body: there is
 * deliberately no `features/ai/service.ts`, no adapter behind
 * `api/seam.ts` and no entry in `api/endpoints/`, because a seam is a
 * promise that something can be plugged in and nothing can be plugged in
 * yet. `availability.ts` is where that is stated once and enforced.
 *
 * The Phase K gate (audit AD-4, R-5) is unchanged and unmet. A
 * patient-facing symptom assistant needs a real model provider, a
 * server-side red-flag classifier that routes an emergency description to
 * Phase N *before* generating a word, an output filter that forbids
 * diagnosis and dosage, an audit trail over every exchange, and a named
 * clinical owner who signs the prompt and the refusal set. None of those
 * exists. The doctor-side assistant in `frontend/` is a canned-response
 * generator writing to `localStorage`, and pointing this tree at it would
 * be the single most dangerous thing this project could ship.
 *
 * What exists is the **interface**, designed, accessible, translated and
 * tested, so that the work waiting on AD-4 is the clinical and backend
 * work rather than a screen nobody has drawn. Every message type below
 * is rendered from props by a pure component in `components/`, exercised
 * directly by `ai-states.test.tsx`. None of them is ever constructed from
 * a hardcoded script and shown to a patient as if a model had produced
 * it — `ai-honesty.test.ts` is the assertion that keeps that true.
 */

/**
 * The patient-facing contexts — K-01.
 *
 * Four, and explicitly **not** the clinician modes (`record`, `labs`,
 * `pharmacy`). The clinician modes read a chart and reason about it; a
 * patient-facing assistant that did the same would be giving a diagnosis
 * with a disclaimer stapled to it. The split is the whole content of
 * K-01 and it belongs in a decision record before any of it is wired.
 *
 * - `navigation` — "I need a cardiologist" → the specialty → Phase G.
 * - `symptom` — structured intake, which routes to care, never to a name
 *   for the problem.
 * - `appointment` — help reaching the real Phase I booking flow.
 * - `medication-info` — what a medicine *is*. Never a dose, never a
 *   change to one.
 */
export const AI_CONTEXTS = ['navigation', 'symptom', 'appointment', 'medication-info'] as const;

export type AiContext = (typeof AI_CONTEXTS)[number];

/**
 * Who said it.
 *
 * A union of two, because a bubble must be attributable at a glance and
 * by a screen reader — never by alignment or colour alone (WCAG 1.4.1).
 * `AiMessageBubble` renders the author as text for that reason.
 */
export type AiAuthor = 'patient' | 'assistant';

/** One rendered turn. */
export interface AiMessage {
  readonly id: string;
  readonly author: AiAuthor;
  readonly body: string;
  /** ISO-8601 instant. Formatted by `utils/datetime`, never computed here. */
  readonly at: string;
}

/**
 * What the composer and the transcript are doing.
 *
 * `unavailable` is not an error state and is deliberately first: it is
 * the state every assistant screen is in today, and treating it as the
 * failure branch of a working feature is how a "coming soon" screen ends
 * up looking like a bug.
 *
 * - `unavailable` — no assistant is connected. The shipped state.
 * - `idle` — a connected assistant, waiting for the patient.
 * - `sending` — the turn has left the composer.
 * - `responding` — a reply is arriving. What the typing indicator draws.
 * - `failed` — the turn did not complete and can be retried.
 */
export type AiTurnState = 'unavailable' | 'idle' | 'sending' | 'responding' | 'failed';

/**
 * One symptom a patient can select — the intake vocabulary.
 *
 * A flat list of plain-language descriptions with stable ids. It is a
 * **form**, not a classifier: nothing in this tree reads a selection and
 * concludes anything from it, and `SymptomPicker` is as much an
 * inference engine as a checkbox is.
 *
 * The list itself is bundled content (`content/intake.ts`) and carries
 * the same W-10 sign-off requirement as the emergency guidance does.
 */
export interface SymptomOption {
  readonly id: string;
  /** Message key, so the option is shown in the patient's language. */
  readonly labelKey: string;
  /** Grouping for the picker's sections. */
  readonly group: 'general' | 'head' | 'chest' | 'abdomen' | 'skin' | 'mood';
}

/** How far through the intake the patient is. */
export interface IntakeProgress {
  /** 1-based, for display. */
  readonly step: number;
  readonly total: number;
}

/**
 * An image the patient has chosen but not sent — L-01.
 *
 * `uri` is a local file reference from the OS picker and never leaves
 * the device: there is no upload, no object storage and no malware
 * scanner behind it (BE-15). The type exists so the preview, the remove
 * control and the disabled send state can be drawn and tested.
 */
export interface ImageDraft {
  readonly id: string;
  readonly uri: string;
  readonly fileName?: string;
}
