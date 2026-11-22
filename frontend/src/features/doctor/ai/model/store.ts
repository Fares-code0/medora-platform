import { AI_PROMPTS } from './prompts';
import { registerAiSessionReset } from './session-storage';
import {
  AI_LANGUAGE_META,
  AI_RESPONSE_LENGTHS,
  AI_TEMPERATURES,
  DEFAULT_AI_SETTINGS,
  GENERAL_CONTEXT,
  type AiConversation,
  type AiLanguage,
  type AiResponseLength,
  type AiSettings,
  type ChatMessage,
} from './types';

/**
 * Storage for the AI assistant — conversations and settings (frontend-only;
 * replaced by the assistant endpoints when the API lands). Reads are
 * defensive: a malformed settings payload falls back to the defaults
 * instead of throwing.
 *
 * Conversations are held IN MEMORY ONLY (S1). A conversation is PHI once it
 * carries a patient context: the deep-link seed copies the directory
 * patient's name into `context.patientName`, the title and the greeting,
 * and the clinician types clinical text into it. They used to persist under
 * the global `medora.ai.conversations.v1` key, which no logout cleared — so
 * the next account on the browser read the previous one's patient chats.
 * They now live in this module and end with the session: the module
 * registers its reset with `session-storage.ts`, whose `clearAiSessionData`
 * runs on sign-in, logout, lock and a refused refresh, through the same
 * `AuthProvider` paths that clear the query cache.
 *
 * Settings persist per user under `medora.<userId>.ai.settings.v1` and are
 * KEPT on logout (`clearUserPreferences`' kept list), like a composed
 * dashboard. That is only safe because they cannot hold patient data: every
 * field is a number, a boolean, an enum member or an id from the fixed
 * `AI_PROMPTS` catalogue, and `sanitizeAiSettings` drops anything else on
 * both read and write — there is no free text in them to type a name into.
 * This module is the feature's single `window.localStorage` boundary.
 */

function settingsKey(userId: string): string {
  return `medora.${userId}.ai.settings.v1`;
}

/** The session's conversations; `null` until first read (then seeded). */
let memoryConversations: readonly AiConversation[] | null = null;

registerAiSessionReset(() => {
  memoryConversations = null;
});

const HOUR_MS = 3_600_000;

let idCounter = 0;

/** Unique-enough id for local entities (no crypto dependency needed). */
export function localId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${String(idCounter)}`;
}

/* ── Seed conversations (first run only) ────────────────────────── */

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * HOUR_MS).toISOString();
}

function seedMessage(
  id: string,
  role: ChatMessage['role'],
  content: string,
  atHoursAgo: number,
): ChatMessage {
  return { id, role, content, createdAt: hoursAgo(atHoursAgo), status: 'complete', error: null };
}

function seedConversations(): readonly AiConversation[] {
  return [
    {
      id: 'conv-seed-metformin',
      title: 'Metformin renal dosing',
      context: GENERAL_CONTEXT,
      favorite: true,
      createdAt: hoursAgo(52),
      updatedAt: hoursAgo(52),
      messages: [
        seedMessage(
          'conv-seed-metformin-m1',
          'user',
          'When should metformin be dose-reduced or stopped based on renal function?',
          52,
        ),
        seedMessage(
          'conv-seed-metformin-m2',
          'assistant',
          '## Metformin & renal function\n\n- **eGFR ≥ 60** — no adjustment; review annually.\n- **eGFR 45–59** — continue; review dose and monitor renal function every 3–6 months.\n- **eGFR 30–44** — do not initiate; if already on it, halve the dose and monitor closely.\n- **eGFR < 30** — stop metformin.\n\nHold during acute illness with dehydration and around iodinated-contrast studies.\n\n---\n*Medora AI supports, but never replaces, clinical judgment.*',
          52,
        ),
      ],
    },
    {
      id: 'conv-seed-cbc',
      title: 'CBC interpretation basics',
      context: { mode: 'labs', patientId: null, patientName: null, refId: null },
      favorite: false,
      createdAt: hoursAgo(6),
      updatedAt: hoursAgo(6),
      messages: [
        seedMessage(
          'conv-seed-cbc-m1',
          'user',
          'Give me a quick framework for interpreting a CBC.',
          6,
        ),
        seedMessage(
          'conv-seed-cbc-m2',
          'assistant',
          '## CBC in three passes\n\n1. **Red line** — hemoglobin first, then MCV to classify anemia (micro/normo/macrocytic).\n2. **White line** — total WBC, then the differential; neutrophilia vs lymphocytosis point to different causes.\n3. **Platelets** — confirm true thrombocytopenia (clumping artifact) before acting.\n\nAlways interpret against the patient’s baseline, not just the reference range.\n\n---\n*Medora AI supports, but never replaces, clinical judgment.*',
          6,
        ),
      ],
    },
  ];
}

/* ── Conversations ──────────────────────────────────────────────── */

/** This session's conversations — seeded on first read, never persisted. */
export function readConversations(): readonly AiConversation[] {
  memoryConversations ??= seedConversations();
  return memoryConversations;
}

export function writeConversations(conversations: readonly AiConversation[]): void {
  memoryConversations = conversations;
}

/* ── Settings ───────────────────────────────────────────────────── */

const PROMPT_IDS: ReadonlySet<string> = new Set(AI_PROMPTS.map((prompt) => prompt.id));

/**
 * Settings reduced to the closed shape they may hold: each field is taken
 * only when it is a valid member of its type, else the default stands; an
 * unknown key is dropped, and a favourite is kept only if it names a prompt
 * in the catalogue. So what is stored, and what survives logout, can never
 * carry free text — a patient's name included.
 */
export function sanitizeAiSettings(value: unknown): AiSettings {
  if (typeof value !== 'object' || value === null) return DEFAULT_AI_SETTINGS;
  const candidate = value as Record<string, unknown>;
  const d = DEFAULT_AI_SETTINGS;
  const temperature = candidate['temperature'];
  const responseLength = candidate['responseLength'];
  const language = candidate['language'];
  const favorites = candidate['favoritePromptIds'];
  return {
    temperature:
      typeof temperature === 'number' && AI_TEMPERATURES.includes(temperature)
        ? temperature
        : d.temperature,
    responseLength:
      typeof responseLength === 'string' &&
      (AI_RESPONSE_LENGTHS as readonly string[]).includes(responseLength)
        ? (responseLength as AiResponseLength)
        : d.responseLength,
    language:
      typeof language === 'string' && Object.keys(AI_LANGUAGE_META).includes(language)
        ? (language as AiLanguage)
        : d.language,
    autoContext:
      typeof candidate['autoContext'] === 'boolean' ? candidate['autoContext'] : d.autoContext,
    streaming: typeof candidate['streaming'] === 'boolean' ? candidate['streaming'] : d.streaming,
    favoritePromptIds: Array.isArray(favorites)
      ? [
          ...new Set(
            favorites.filter(
              (id: unknown): id is string => typeof id === 'string' && PROMPT_IDS.has(id),
            ),
          ),
        ]
      : d.favoritePromptIds,
  };
}

/** The user's settings; the defaults when signed out or nothing is stored. */
export function readSettings(userId: string | null): AiSettings {
  if (userId === null) return DEFAULT_AI_SETTINGS;
  try {
    const raw = window.localStorage.getItem(settingsKey(userId));
    if (raw === null) return DEFAULT_AI_SETTINGS;
    return sanitizeAiSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_AI_SETTINGS;
  }
}

export function writeSettings(settings: AiSettings, userId: string | null): void {
  // No user means no namespace a logout would clear — keep it in memory.
  if (userId === null) return;
  try {
    window.localStorage.setItem(settingsKey(userId), JSON.stringify(sanitizeAiSettings(settings)));
  } catch {
    // Storage unavailable — settings stay session-local.
  }
}
