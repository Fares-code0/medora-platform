import {
  DEFAULT_AI_SETTINGS,
  GENERAL_CONTEXT,
  type AiConversation,
  type AiSettings,
  type ChatMessage,
} from './types';

/**
 * Local persistence for the AI assistant — conversations and settings in
 * browser storage (frontend-only; replaced by the assistant endpoints
 * when the API lands). Reads are defensive: any malformed payload falls
 * back to the seed/defaults instead of throwing.
 *
 * Storage note: conversations are documents, not UI preferences, so they
 * don't belong in the typed preferences service (§12.5). Like the auth
 * session store, this module accesses `window.localStorage` directly and
 * is the feature's single storage boundary. No PHI: mock ids and mock
 * text only.
 */

const CONVERSATIONS_KEY = 'medora.ai.conversations.v1';
const SETTINGS_KEY = 'medora.ai.settings.v1';

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

function isConversationArray(value: unknown): value is AiConversation[] {
  return Array.isArray(value) && value.every((c: unknown) => {
    if (typeof c !== 'object' || c === null) return false;
    const candidate = c as Record<string, unknown>;
    return (
      typeof candidate['id'] === 'string' &&
      typeof candidate['title'] === 'string' &&
      Array.isArray(candidate['messages'])
    );
  });
}

export function readConversations(): readonly AiConversation[] {
  try {
    const raw = window.localStorage.getItem(CONVERSATIONS_KEY);
    if (raw === null) {
      const seeded = seedConversations();
      writeConversations(seeded);
      return seeded;
    }
    const parsed: unknown = JSON.parse(raw);
    return isConversationArray(parsed) ? parsed : seedConversations();
  } catch {
    return seedConversations();
  }
}

export function writeConversations(conversations: readonly AiConversation[]): void {
  try {
    window.localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(conversations));
  } catch {
    // Storage unavailable/full — the session keeps working in memory.
  }
}

/* ── Settings ───────────────────────────────────────────────────── */

export function readSettings(): AiSettings {
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (raw === null) return DEFAULT_AI_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_AI_SETTINGS;
    return { ...DEFAULT_AI_SETTINGS, ...(parsed as Partial<AiSettings>) };
  } catch {
    return DEFAULT_AI_SETTINGS;
  }
}

export function writeSettings(settings: AiSettings): void {
  try {
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable — settings stay session-local.
  }
}
