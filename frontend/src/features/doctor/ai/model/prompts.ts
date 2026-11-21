import {
  FileScan,
  FlaskConical,
  ListChecks,
  Pill,
  Stethoscope,
  UserRound,
  type LucideIcon,
} from 'lucide-react';

import type { AiContextMode } from './types';

/**
 * Suggested-prompt library — the reusable quick-action cards shown on the
 * AI dashboard and above an empty chat. Each prompt carries the message
 * text sent on selection and the context mode it works best with (used to
 * rank suggestions). Becomes the prompt-template endpoint when the API
 * lands.
 */

export interface AiPrompt {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly icon: LucideIcon;
  /** The message inserted into the chat when the card is used. */
  readonly message: string;
  /** Context the prompt is most useful in (ranking only, never a gate). */
  readonly affinity: AiContextMode;
}

export const AI_PROMPTS: readonly AiPrompt[] = [
  {
    id: 'summarize-patient',
    title: 'Summarize patient',
    description: 'One-paragraph clinical summary with problems, medications, and risks.',
    icon: UserRound,
    message: 'Summarize this patient: active problems, current medications, allergies, and key risks.',
    affinity: 'patient',
  },
  {
    id: 'explain-labs',
    title: 'Explain lab results',
    description: 'Plain-language interpretation of the attached laboratory results.',
    icon: FlaskConical,
    message: 'Explain these lab results, flag anything abnormal, and suggest sensible next steps.',
    affinity: 'labs',
  },
  {
    id: 'drug-interactions',
    title: 'Drug interaction checker',
    description: 'Screen the medication list for interactions and cumulative risks.',
    icon: Pill,
    message: 'Check the current medication list for drug–drug interactions and high-risk combinations.',
    affinity: 'pharmacy',
  },
  {
    id: 'differential-diagnosis',
    title: 'Suggest differential diagnosis',
    description: 'Ranked differentials for the documented presentation.',
    icon: Stethoscope,
    message: 'Suggest a ranked differential diagnosis for the documented presentation, with reasoning.',
    affinity: 'record',
  },
  {
    id: 'review-medications',
    title: 'Review medications',
    description: 'Appropriateness, dosing, duplications, and deprescribing opportunities.',
    icon: ListChecks,
    message: 'Review the medication regimen for appropriateness, dosing, duplication, and deprescribing options.',
    affinity: 'pharmacy',
  },
  {
    id: 'explain-imaging',
    title: 'Explain imaging findings',
    description: 'Break an imaging report down into findings and implications.',
    icon: FileScan,
    message: 'Explain the imaging findings in this record and what follow-up they usually warrant.',
    affinity: 'record',
  },
];

export function findPrompt(promptId: string): AiPrompt | null {
  return AI_PROMPTS.find((prompt) => prompt.id === promptId) ?? null;
}

/** Prompts ranked for a context: affinity matches first, stable otherwise. */
export function rankPrompts(mode: AiContextMode): readonly AiPrompt[] {
  return [...AI_PROMPTS].sort(
    (a, b) => Number(b.affinity === mode) - Number(a.affinity === mode),
  );
}
