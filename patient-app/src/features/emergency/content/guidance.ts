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
 *
 * ── Where the words live (W-10 translation approval, 2026-11-23) ─────
 * The owner approved translating this copy into Arabic. The words are
 * catalogue keys (`emergency.*` in `i18n/messages/en.ts` and `ar.ts`)
 * and this module holds only the KEYS and their order, so the screen
 * renders them in the patient's language. The English text is unchanged.
 * The Arabic is an engineering draft: the W-10 clinical sign-off is still
 * NOT given, and the named clinical reviewer in docs/SIGNOFF.md must read
 * both languages before a build ships. `test/signoff.test.ts` scans those
 * catalogue values, in both languages, for treatment instructions.
 */

import type { MessageKey } from '@/i18n';

export interface RedFlag {
  readonly id: string;
  readonly titleKey: MessageKey;
  readonly detailKey: MessageKey;
}

/**
 * Signs that mean "call the emergency number now, do not book, do not
 * message". Recognition only — every item ends at "call", and none of
 * them tells the patient what to do while waiting.
 */
export const RED_FLAGS: readonly RedFlag[] = [
  {
    id: 'breathing',
    titleKey: 'emergency.redFlag.breathing.title',
    detailKey: 'emergency.redFlag.breathing.detail',
  },
  {
    id: 'chest',
    titleKey: 'emergency.redFlag.chest.title',
    detailKey: 'emergency.redFlag.chest.detail',
  },
  {
    id: 'stroke',
    titleKey: 'emergency.redFlag.stroke.title',
    detailKey: 'emergency.redFlag.stroke.detail',
  },
  {
    id: 'consciousness',
    titleKey: 'emergency.redFlag.consciousness.title',
    detailKey: 'emergency.redFlag.consciousness.detail',
  },
  {
    id: 'bleeding',
    titleKey: 'emergency.redFlag.bleeding.title',
    detailKey: 'emergency.redFlag.bleeding.detail',
  },
  {
    id: 'allergy',
    titleKey: 'emergency.redFlag.allergy.title',
    detailKey: 'emergency.redFlag.allergy.detail',
  },
  {
    id: 'selfharm',
    titleKey: 'emergency.redFlag.selfharm.title',
    detailKey: 'emergency.redFlag.selfharm.detail',
  },
];

/**
 * The disclaimer. Rendered at the top of the Emergency screen, always
 * visible, never behind a scroll or a dismiss control (checklist N-02).
 */
export const EMERGENCY_DISCLAIMER_KEY: MessageKey = 'emergency.disclaimer';

/** Guidance for the case that is urgent but not an emergency (N-09). */
export const WHEN_TO_CALL_VS_BOOK = {
  callNow: 'emergency.when.callNow.body',
  callClinic: 'emergency.when.callClinic.body',
  bookAppointment: 'emergency.when.book.body',
  neverMessage: 'emergency.when.neverMessage',
} as const satisfies Record<string, MessageKey>;

/**
 * Every catalogue key this module and the Emergency screen render, for
 * the tests and the clinical review list: the whole of what a clinician
 * signs for under item 1 of docs/SIGNOFF.md.
 */
export const EMERGENCY_CONTENT_KEYS: readonly MessageKey[] = [
  EMERGENCY_DISCLAIMER_KEY,
  ...RED_FLAGS.flatMap((flag) => [flag.titleKey, flag.detailKey]),
  ...Object.values(WHEN_TO_CALL_VS_BOOK),
];
