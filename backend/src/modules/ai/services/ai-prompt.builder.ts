/**
 * The grounding prompt (RM M16.3, M16.6).
 *
 * A pure function, unit-tested, because it is the boundary between what
 * the server knows and what leaves the deployment. Everything this
 * returns is sent to a third party, so what it may contain is a policy
 * question rather than a formatting one — and a policy in a pure
 * function with a test is one a reviewer can check.
 *
 * ## Three rules about what goes in
 *
 * **Identifiers and shape, not clinical content.** The context line
 * names *what* the thread is bound to — this patient, this encounter,
 * this order — and not what any of them say. The clinician has the chart
 * open; the assistant's job in v1 is to reason about the question they
 * typed, and shipping a chart to a provider to save them retyping is a
 * disclosure decision nobody has made. `BoundEntity.summary` is built
 * from the same narrow projections for the same reason.
 *
 * **The patient's name is included; the MRN is not.** The name is what
 * makes an answer readable and it is already in the thread's title bar.
 * The MRN is the clinic's internal key — it identifies the person
 * *across systems*, which is what makes it the more dangerous of the two
 * to hand to a third party, and it adds nothing to an answer.
 *
 * **The containment rule is stated to the model, not only enforced
 * around it.** M16.6 makes it structural — the module has no write path
 * into a chart — but a model that believes it is writing to the record
 * will phrase its answers as though it had. Telling it plainly that it
 * cannot is how the prose it produces matches what the system does.
 */

import type { ResolvedContext } from './ai-context.service';

/** `responseLength` → a token ceiling, per API §11.6's three values. */
export const OUTPUT_TOKEN_CEILING: Readonly<Record<string, number>> = {
  concise: 400,
  balanced: 1_000,
  detailed: 2_000,
};

/** The ceiling for a `responseLength` outside the vocabulary. */
export const DEFAULT_OUTPUT_TOKENS = OUTPUT_TOKEN_CEILING.balanced ?? 1_000;

export function outputTokensFor(responseLength: string): number {
  return OUTPUT_TOKEN_CEILING[responseLength] ?? DEFAULT_OUTPUT_TOKENS;
}

const BASE = [
  'You are a clinical assistant inside Medora, a healthcare management platform.',
  'You are speaking to a licensed physician, not to a patient.',
  'Be specific and cite the reasoning behind a recommendation.',
  'Say plainly when something cannot be determined from what you have been given;',
  'do not infer a clinical value that was not stated.',
  // The containment rule, told to the model — see the file header.
  'You cannot read or write the patient record. Nothing you say is saved to a',
  'chart: the physician must write and sign a note for that to happen.',
].join(' ');

const LENGTH_GUIDANCE: Readonly<Record<string, string>> = {
  concise: 'Answer in a few sentences.',
  balanced: 'Answer in a short structured response.',
  detailed: 'Answer thoroughly, with the reasoning set out.',
};

const LANGUAGE_GUIDANCE: Readonly<Record<string, string>> = {
  en: 'Answer in English.',
  ar: 'Answer in Arabic.',
};

export interface PromptOptions {
  readonly responseLength: string;
  readonly language: string;
}

export function buildSystemPrompt(
  context: ResolvedContext,
  options: PromptOptions,
): string {
  const lines = [BASE];

  const length = LENGTH_GUIDANCE[options.responseLength];
  if (length !== undefined) lines.push(length);

  const language = LANGUAGE_GUIDANCE[options.language];
  if (language !== undefined) lines.push(language);

  lines.push(describeContext(context));

  return lines.join('\n');
}

/**
 * One line naming the binding.
 *
 * `general` says so explicitly rather than saying nothing: a model given
 * no context line may assume it has one, and "no patient is attached to
 * this conversation" is the instruction that stops an answer being
 * phrased as though about someone.
 */
function describeContext(context: ResolvedContext): string {
  if (context.patient === null) {
    return 'No patient is attached to this conversation. Answer as a general clinical question.';
  }

  const parts = [
    `This conversation is about ${context.patient.fullName} (${context.patient.publicId}).`,
  ];

  if (context.entity !== null) {
    parts.push(`It is grounded in ${context.entity.refId}: ${context.entity.summary}.`);
  }

  parts.push(
    'You have not been given their chart. Ask the physician for any clinical detail you need.',
  );

  return parts.join(' ');
}

/**
 * A thread title derived from its opening question (RM M16.2).
 *
 * The frontend creates a conversation before the first message is typed,
 * so a client-supplied title would have to be invented from the context
 * alone — "Patient · PT-1004" on every thread about that patient, which
 * is no help in a sidebar of twenty. The first question is what a doctor
 * would recognise it by.
 */
export function titleFromMessage(content: string, fallback: string): string {
  const cleaned = content.trim().replace(/\s+/g, ' ');
  if (cleaned.length === 0) return fallback;
  if (cleaned.length <= 60) return cleaned;

  // Cut on a word boundary where there is one in reach, so the title
  // does not end mid-word; the ellipsis says it was cut either way.
  const cut = cleaned.slice(0, 60);
  const lastSpace = cut.lastIndexOf(' ');

  return `${(lastSpace > 40 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
