import type { AiContext } from './model/types';

/**
 * Whether an assistant is connected — the one place that answers it.
 *
 * ── It answers "no", and that is not a placeholder ──────────────────
 *
 * Every assistant screen asks this and renders its unavailable state.
 * The value is a constant rather than a flag, a remote setting or an
 * environment variable, because each of those is a switch somebody can
 * flip — and flipping it would not connect an assistant, it would only
 * stop the screens from saying that none is connected. There is nothing
 * behind them to turn on:
 *
 * - **No provider.** This project has no model provider of any kind. The
 *   doctor-side assistant in `frontend/` is a deterministic
 *   canned-response generator persisting to `localStorage` (audit R-5).
 * - **No endpoint.** BE-14 does not exist. `api/endpoints/` has no AI
 *   module and `docs/TRACEABILITY.md` records the absence rather than
 *   reserving a path for it.
 * - **No decision.** AD-4 is open. The Phase K gate names what must be
 *   true first: a red-flag triage classifier running **server-side**
 *   before any text is generated (K-04), an output filter forbidding
 *   diagnosis and dosage, an audit trail over every exchange, and a
 *   named clinical owner signing the prompt and the refusal set.
 * - **No storage.** K-07 requires server-side conversation persistence
 *   and forbids MMKV and `localStorage` outright. A patient's account of
 *   their symptoms is PHI (T-03), and this client writes no PHI to disk.
 *
 * ── What a future contributor must not do here ──────────────────────
 *
 * Not one of those four is fixed by anything that could be written in
 * this directory. In particular: do not make `connected` true and script
 * the replies; do not add a fixture adapter behind `api/seam.ts` and let
 * it answer in development; do not have the composer echo a canned
 * sentence so the screen "feels finished". A scripted reply on a symptom
 * screen is a machine answering a medical question with something nobody
 * clinical has read, which is the exact harm the gate exists to prevent —
 * and it is worse than an empty screen, because an empty screen tells
 * the truth about itself.
 *
 * `ai-honesty.test.ts` enforces all of that mechanically: this tree
 * contains no network call, no persistence, and no stored assistant
 * prose that a screen could present as a reply.
 */
export interface AiAvailability {
  /** Always `false` today. See the note above before changing it. */
  readonly connected: boolean;
  /**
   * Why, in a form the UI can branch on. One value, because there is one
   * reason: nothing has been built. It is a union rather than a boolean
   * so that "connected, but your clinic has turned it off" — a real
   * future state — is a new member rather than a rewrite.
   */
  readonly reason: 'not-implemented';
  /** The dependencies a reader can look up, rendered as provenance. */
  readonly blockedBy: readonly string[];
}

export const AI_AVAILABILITY: AiAvailability = {
  connected: false,
  reason: 'not-implemented',
  blockedBy: ['AD-4', 'BE-14'],
};

/**
 * The hook every assistant screen calls.
 *
 * A function rather than the bare constant so that the screens are
 * already shaped for the day this becomes a real query — and so that a
 * test can read what the screens read.
 */
export function useAiAvailability(): AiAvailability {
  return AI_AVAILABILITY;
}

/**
 * Which contexts a connected assistant would offer.
 *
 * Exported so the assistant home can draw its capability list from one
 * ordered source rather than from JSX order, and so `parity`-style tests
 * can assert the four K-01 contexts are all represented and none of the
 * clinician modes is.
 */
export const OFFERED_CONTEXTS: readonly AiContext[] = [
  'navigation',
  'symptom',
  'appointment',
  'medication-info',
];
