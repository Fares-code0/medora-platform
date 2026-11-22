import { SEED_CONVERSATIONS } from './seed';
import { conversationsStorageKey, registerConversationsMemoryReset } from './session-boundary';
import type { Conversation } from './types';

/**
 * Local persistence for the conversation model — the seed is written on
 * first run, then user actions (send/star/pin/archive/draft/…) mutate
 * the stored copy. Reads are defensive: malformed payloads fall back to
 * the seed. Like the auth, AI, and notifications stores, this is a
 * single `window.localStorage` boundary — moved here with the model
 * (rather than left behind in the doctor feature) so the admin's
 * communication monitoring reads the same persisted state the doctor
 * mutates. No PHI: mock names and mock ids only.
 *
 * The data is scoped to the signed-in user (`medora.messaging.v1.<userId>`),
 * set by `AuthProvider` via `setConversationsOwner`. With no owner nothing is
 * read from or written to `localStorage`: the session runs on an in-memory
 * copy, so a shared key can never carry one account's messages to another.
 * The pre-isolation global key is only ever removed, never read or written.
 */

let memoryOnly: readonly Conversation[] | null = null;
registerConversationsMemoryReset(() => {
  memoryOnly = null;
});

let idCounter = 0;

/** Unique-enough id for locally created entities (messages, threads). */
export function localId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${String(idCounter)}`;
}

function isConversation(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate['id'] === 'string' &&
    Array.isArray(candidate['participantIds']) &&
    Array.isArray(candidate['messages'])
  );
}

export function readStoredConversations(): readonly Conversation[] {
  const key = conversationsStorageKey();
  if (key === null) return memoryOnly ?? SEED_CONVERSATIONS;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) {
      writeStoredConversations(SEED_CONVERSATIONS);
      return SEED_CONVERSATIONS;
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every(isConversation)
      ? (parsed as Conversation[])
      : SEED_CONVERSATIONS;
  } catch {
    return SEED_CONVERSATIONS;
  }
}

export function writeStoredConversations(conversations: readonly Conversation[]): void {
  const key = conversationsStorageKey();
  if (key === null) {
    memoryOnly = conversations;
    return;
  }
  try {
    window.localStorage.setItem(key, JSON.stringify(conversations));
  } catch {
    // Storage unavailable/full — the session keeps working in memory.
  }
}
