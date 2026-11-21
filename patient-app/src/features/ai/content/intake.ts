import type { SymptomOption } from '../model/types';

/**
 * The symptom intake vocabulary — the list the picker draws.
 *
 * ── What this is, and what it is emphatically not ───────────────────
 *
 * It is a **form's option list**. Every entry is a plain-language
 * description a patient might recognise in themselves, grouped so the
 * picker can section them. Nothing reads a selection and concludes
 * anything: there is no scoring, no weighting, no severity, no mapping
 * to a condition, no red-flag classification. Selecting "chest pain"
 * here produces a selected chip and nothing else.
 *
 * That last sentence is a deliberate limitation and not an oversight.
 * Client-side triage is precisely what K-04 forbids — "**Classification
 * is server-side. The client must not be the only guard**" — because a
 * classifier that lives in the bundle is one that can be wrong on a
 * phone with no way to correct it, and one that a patient can be
 * reassured by. The Emergency route on the intake screen is therefore
 * unconditional: it is offered to everyone, at every step, rather than
 * appearing when a list of words is matched.
 *
 * ── The W-10 sign-off applies to this file ──────────────────────────
 *
 * These are descriptions of symptoms, which puts them nearer the
 * clinical line than a button label. They are in the message catalogue
 * (so they translate) but, like the rest of the catalogue, W-10's
 * clinical review covers them before any build ships. A contributor
 * adding an entry is adding a phrase a patient will read about their own
 * body; treat it accordingly.
 *
 * Ordering is deliberate and not alphabetical: `general` first because
 * it is what most people reach for, `chest` early because it is where
 * the descriptions that should send somebody to Phase N live.
 */
export const SYMPTOM_OPTIONS: readonly SymptomOption[] = [
  { id: 'fever', labelKey: 'ai.symptom.fever', group: 'general' },
  { id: 'fatigue', labelKey: 'ai.symptom.fatigue', group: 'general' },
  { id: 'chills', labelKey: 'ai.symptom.chills', group: 'general' },
  { id: 'appetite', labelKey: 'ai.symptom.appetite', group: 'general' },

  { id: 'headache', labelKey: 'ai.symptom.headache', group: 'head' },
  { id: 'dizziness', labelKey: 'ai.symptom.dizziness', group: 'head' },
  { id: 'vision', labelKey: 'ai.symptom.vision', group: 'head' },
  { id: 'soreThroat', labelKey: 'ai.symptom.soreThroat', group: 'head' },

  { id: 'chestPain', labelKey: 'ai.symptom.chestPain', group: 'chest' },
  { id: 'breathless', labelKey: 'ai.symptom.breathless', group: 'chest' },
  { id: 'cough', labelKey: 'ai.symptom.cough', group: 'chest' },
  { id: 'palpitations', labelKey: 'ai.symptom.palpitations', group: 'chest' },

  { id: 'nausea', labelKey: 'ai.symptom.nausea', group: 'abdomen' },
  { id: 'abdominalPain', labelKey: 'ai.symptom.abdominalPain', group: 'abdomen' },
  { id: 'bowel', labelKey: 'ai.symptom.bowel', group: 'abdomen' },

  { id: 'rash', labelKey: 'ai.symptom.rash', group: 'skin' },
  { id: 'swelling', labelKey: 'ai.symptom.swelling', group: 'skin' },
  { id: 'wound', labelKey: 'ai.symptom.wound', group: 'skin' },

  { id: 'lowMood', labelKey: 'ai.symptom.lowMood', group: 'mood' },
  { id: 'anxiety', labelKey: 'ai.symptom.anxiety', group: 'mood' },
  { id: 'sleep', labelKey: 'ai.symptom.sleep', group: 'mood' },
];

/** The groups, in the order the picker sections them. */
export const SYMPTOM_GROUPS = ['general', 'head', 'chest', 'abdomen', 'skin', 'mood'] as const;

/** How long the intake is. Three steps: what, how long, review. */
export const INTAKE_TOTAL_STEPS = 3;

/**
 * How long it has been going on — the second step.
 *
 * A closed list rather than a date picker: "since Tuesday" is a harder
 * question than "a few days", and a patient who cannot answer precisely
 * should not be blocked by the field.
 */
export const DURATION_OPTIONS = [
  { id: 'today', labelKey: 'ai.duration.today' },
  { id: 'days', labelKey: 'ai.duration.days' },
  { id: 'weeks', labelKey: 'ai.duration.weeks' },
  { id: 'longer', labelKey: 'ai.duration.longer' },
] as const;

export type DurationId = (typeof DURATION_OPTIONS)[number]['id'];
