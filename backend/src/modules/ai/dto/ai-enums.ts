/**
 * Wire vocabularies for the assistant (RM M16, API §11).
 *
 * The same treatment `record-enums.ts` and `labs-enums.ts` apply: the
 * Prisma enum members are SCREAMING_CASE and the contract's literals are
 * lower-case hyphenated, so the mapping is written out rather than
 * derived with `.toLowerCase()`. Every literal below is transcribed from
 * `features/doctor/ai/model/types.ts`, which is rank-1 source.
 */

import type {
  AiChatRole,
  AiContextMode,
  AiLanguage,
  AiMessageStatus,
  AiResponseLength,
} from '../../../generated/prisma/enums';

const CONTEXT_MODE_WIRE: Record<AiContextMode, string> = {
  GENERAL: 'general',
  PATIENT: 'patient',
  RECORD: 'record',
  LABS: 'labs',
  PHARMACY: 'pharmacy',
};

const CHAT_ROLE_WIRE: Record<AiChatRole, string> = {
  USER: 'user',
  ASSISTANT: 'assistant',
};

const MESSAGE_STATUS_WIRE: Record<AiMessageStatus, string> = {
  COMPLETE: 'complete',
  STOPPED: 'stopped',
  ERROR: 'error',
};

const RESPONSE_LENGTH_WIRE: Record<AiResponseLength, string> = {
  CONCISE: 'concise',
  BALANCED: 'balanced',
  DETAILED: 'detailed',
};

const LANGUAGE_WIRE: Record<AiLanguage, string> = {
  EN: 'en',
  AR: 'ar',
};

function reverse<T extends string>(map: Record<T, string>): Record<string, T> {
  return Object.fromEntries(Object.entries(map).map(([key, value]) => [value, key])) as Record<
    string,
    T
  >;
}

export const aiContextModeToWire = (value: AiContextMode): string => CONTEXT_MODE_WIRE[value];
export const aiChatRoleToWire = (value: AiChatRole): string => CHAT_ROLE_WIRE[value];
export const aiMessageStatusToWire = (value: AiMessageStatus): string =>
  MESSAGE_STATUS_WIRE[value];
export const aiResponseLengthToWire = (value: AiResponseLength): string =>
  RESPONSE_LENGTH_WIRE[value];
export const aiLanguageToWire = (value: AiLanguage): string => LANGUAGE_WIRE[value];

export const AI_CONTEXT_MODE_FROM_WIRE = reverse(CONTEXT_MODE_WIRE);
export const AI_MESSAGE_STATUS_FROM_WIRE = reverse(MESSAGE_STATUS_WIRE);
export const AI_RESPONSE_LENGTH_FROM_WIRE = reverse(RESPONSE_LENGTH_WIRE);
export const AI_LANGUAGE_FROM_WIRE = reverse(LANGUAGE_WIRE);

/**
 * The wire vocabularies, for the Zod enums that validate bodies.
 *
 * Cast to a non-empty tuple because `z.enum` requires one and
 * `Object.values` cannot prove it — the same narrowing the other enum
 * files apply. Every map above is a `Record` over a Prisma enum, so none
 * of them can be empty.
 */
export const AI_CONTEXT_MODE_VALUES = Object.values(CONTEXT_MODE_WIRE) as [string, ...string[]];
export const AI_RESPONSE_LENGTH_VALUES = Object.values(RESPONSE_LENGTH_WIRE) as [
  string,
  ...string[],
];
export const AI_LANGUAGE_VALUES = Object.values(LANGUAGE_WIRE) as [string, ...string[]];

/**
 * The modes that require a bound patient.
 *
 * DB §H1 enforces it with a CHECK — "`patient_id` is required for every
 * mode except `general`" — and the reason is UX §2.5's rule that "AI
 * never has cross-patient context in a single thread": a patient-mode
 * thread with no patient bound is precisely the row that would let
 * context leak between patients. Restated here so the refusal is a 422
 * naming the field rather than a constraint error a client cannot read.
 */
export const PATIENT_BOUND_MODES: readonly string[] = ['patient', 'record', 'labs', 'pharmacy'];

/**
 * The modes that also require a `refId`.
 *
 * `patient` mode binds the chart as a whole; the other three bind one
 * entity within it (`MR-…`, `LAB-…`, `RX-…`) and are meaningless without
 * it — "grounded in one encounter record" with no record named is a
 * thread whose context claim is false.
 */
export const REF_BOUND_MODES: readonly string[] = ['record', 'labs', 'pharmacy'];
