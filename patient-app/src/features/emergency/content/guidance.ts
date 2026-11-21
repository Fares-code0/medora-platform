/**
 * Bundled emergency guidance.
 *
 * ── Why this is a TypeScript module and not a fetch ──────────────────
 * This is the one screen that must render with no network, no session and
 * no cache — in airplane mode, on a cold start, signed out (audit §11,
 * checklist N-06). Bundled content is the only storage tier that
 * guarantees that. Nothing here is fetched, cached or invalidated.
 *
 * ── Clinical status: NOT YET REVIEWED ────────────────────────────────
 * The copy below is deliberately confined to **navigation and
 * recognition** — "these signs mean call now", "Medora is not an
 * emergency service", "do not wait for a reply here". It contains **no
 * treatment instruction**: no CPR compression depth, no dosage, no
 * tourniquet technique, no positioning advice. That is not an oversight.
 *
 * Checklist N-07 ("static first-aid guidance, clinically reviewed and
 * attributed") is NOT satisfied by this file and is not marked complete.
 * Real first-aid instruction requires a named clinical owner and an
 * attributed source, and W-10 makes that sign-off a release gate.
 * Shipping plausible first-aid text written by a developer is the
 * category of harm this whole feature is careful about.
 *
 * If you are adding a step-by-step treatment instruction here: stop, and
 * take it to the clinical owner named in docs/SIGNOFF.md.
 */

export interface RedFlag {
  readonly id: string;
  readonly title: string;
  readonly detail: string;
}

/**
 * Signs that mean "call the emergency number now, do not book, do not
 * message". Recognition only — every item ends at "call", and none of
 * them tells the patient what to do while waiting.
 */
export const RED_FLAGS: readonly RedFlag[] = [
  {
    id: 'breathing',
    title: 'Trouble breathing',
    detail: 'Struggling for breath, choking, or unable to speak a full sentence.',
  },
  {
    id: 'chest',
    title: 'Chest pain or pressure',
    detail: 'Pain, tightness or heaviness in the chest, especially with sweating or nausea.',
  },
  {
    id: 'stroke',
    title: 'Signs of a stroke',
    detail: 'A drooping face, weakness on one side, or sudden trouble speaking or understanding.',
  },
  {
    id: 'consciousness',
    title: 'Unconscious or unresponsive',
    detail: 'Someone who cannot be woken, or who has had a seizure that is not stopping.',
  },
  {
    id: 'bleeding',
    title: 'Severe bleeding',
    detail: 'Bleeding that does not slow, or a serious injury after a fall or accident.',
  },
  {
    id: 'allergy',
    title: 'A severe allergic reaction',
    detail:
      'Swelling of the face, lips or throat, a spreading rash, or sudden difficulty breathing.',
  },
  {
    id: 'selfharm',
    title: 'Thoughts of harming yourself',
    detail: 'You are not alone and this is an emergency. Call now, or ask someone near you to.',
  },
];

/**
 * The disclaimer. Rendered at the top of the Emergency screen, always
 * visible, never behind a scroll or a dismiss control (checklist N-02).
 */
export const EMERGENCY_DISCLAIMER =
  'Medora is not an emergency service. Nobody is monitoring this app right now. ' +
  'If this is a life-threatening emergency, call your local emergency number immediately.';

/** Guidance for the case that is urgent but not an emergency (N-09). */
export const WHEN_TO_CALL_VS_BOOK = {
  callNow: 'Any of the signs above, or anything you believe is life-threatening.',
  callClinic:
    'Worsening symptoms, a reaction to a medicine, or a wound that needs looking at today.',
  bookAppointment:
    'A new symptom that is not getting worse, a follow-up, a repeat prescription, or a routine check.',
  neverMessage:
    'Do not use Medora messages for anything urgent. A clinician may not read a message for a day or more.',
} as const;
