import {
  FlaskConical,
  FolderHeart,
  MessageSquare,
  Pill,
  UserRound,
  type LucideIcon,
} from 'lucide-react';

/**
 * AI assistant domain model — feature-local types mirroring the future
 * assistant DTOs (conversations, messages, settings). Everything is
 * frontend-only: conversations live in memory (never storage) through the mock
 * service, and the "model" is a deterministic canned-response generator.
 * The shapes are what a real assistant API would return, so the swap is
 * a data-layer change only.
 */

/* ── Context modes ──────────────────────────────────────────────── */

export type AiContextMode = 'general' | 'patient' | 'record' | 'labs' | 'pharmacy';

export const AI_CONTEXT_META: Record<
  AiContextMode,
  { readonly label: string; readonly icon: LucideIcon; readonly description: string }
> = {
  general: {
    label: 'General',
    icon: MessageSquare,
    description: 'No clinical context attached — general medical questions.',
  },
  patient: {
    label: 'Current patient',
    icon: UserRound,
    description: 'Grounded in the selected patient’s demographics and history.',
  },
  record: {
    label: 'Medical record',
    icon: FolderHeart,
    description: 'Grounded in one encounter record.',
  },
  labs: {
    label: 'Laboratory',
    icon: FlaskConical,
    description: 'Grounded in a laboratory order and its results.',
  },
  pharmacy: {
    label: 'Pharmacy',
    icon: Pill,
    description: 'Grounded in a prescription and the medication list.',
  },
};

export const AI_CONTEXT_MODES = Object.keys(AI_CONTEXT_META) as readonly AiContextMode[];

export function isAiContextMode(value: string): value is AiContextMode {
  return (AI_CONTEXT_MODES as readonly string[]).includes(value);
}

/** The context attached to a conversation (mock — ids only, no PHI). */
export interface AiConversationContext {
  readonly mode: AiContextMode;
  readonly patientId: string | null;
  readonly patientName: string | null;
  /** Entity id for record/labs/pharmacy modes (e.g. "LAB-100429"). */
  readonly refId: string | null;
}

export const GENERAL_CONTEXT: AiConversationContext = {
  mode: 'general',
  patientId: null,
  patientName: null,
  refId: null,
};

/** Short human label for a context, e.g. "Labs · LAB-100429 · Omar Saleh". */
export function contextLabel(context: AiConversationContext): string {
  const parts: string[] = [AI_CONTEXT_META[context.mode].label];
  if (context.refId) parts.push(context.refId);
  if (context.patientName) parts.push(context.patientName);
  return parts.join(' · ');
}

/* ── Messages & conversations ───────────────────────────────────── */

export type ChatRole = 'user' | 'assistant';

export type ChatMessageStatus = 'complete' | 'stopped' | 'error';

export interface ChatMessage {
  readonly id: string;
  readonly role: ChatRole;
  readonly content: string;
  readonly createdAt: string;
  readonly status: ChatMessageStatus;
  /** User-facing error line for status === 'error'. */
  readonly error: string | null;
}

export interface AiConversation {
  readonly id: string;
  readonly title: string;
  readonly context: AiConversationContext;
  readonly messages: readonly ChatMessage[];
  readonly favorite: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/* ── Settings ───────────────────────────────────────────────────── */

export type AiResponseLength = 'concise' | 'balanced' | 'detailed';

export const AI_RESPONSE_LENGTHS: readonly AiResponseLength[] = [
  'concise',
  'balanced',
  'detailed',
];

export const AI_RESPONSE_LENGTH_META: Record<AiResponseLength, { readonly label: string }> = {
  concise: { label: 'Concise' },
  balanced: { label: 'Balanced' },
  detailed: { label: 'Detailed' },
};

export type AiLanguage = 'en' | 'ar';

export const AI_LANGUAGE_META: Record<AiLanguage, { readonly label: string }> = {
  en: { label: 'English' },
  ar: { label: 'Arabic (falls back to English in the mock)' },
};

export interface AiSettings {
  /** Sampling temperature 0–1 in 0.1 steps (mock — annotated, not applied). */
  readonly temperature: number;
  readonly responseLength: AiResponseLength;
  readonly language: AiLanguage;
  /** Seed new chats with the surrounding page context automatically. */
  readonly autoContext: boolean;
  /** Simulated token streaming; off = responses appear at once. */
  readonly streaming: boolean;
  readonly favoritePromptIds: readonly string[];
}

export const DEFAULT_AI_SETTINGS: AiSettings = {
  temperature: 0.3,
  responseLength: 'balanced',
  language: 'en',
  autoContext: true,
  streaming: true,
  favoritePromptIds: ['summarize-patient', 'drug-interactions'],
};

export const AI_TEMPERATURES: readonly number[] = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1];

/* ── Assistant identity (status card) ───────────────────────────── */

export const AI_MODEL_NAME = 'Medora Clinical Assistant (mock)';
export const AI_MODEL_VERSION = 'preview-2026.07';
