import { SEED_CONVERSATIONS, SEED_NOTIFICATIONS } from './mock-data';
import type { Conversation, DoctorNotification } from './types';

/**
 * Local persistence for notifications and conversations — the seed is
 * written on first run, then user actions (read/archive/pin/send/…)
 * mutate the stored copy. Reads are defensive: malformed payloads fall
 * back to the seed. Like the auth session and AI stores, this module is
 * the feature's single `window.localStorage` boundary (documents, not UI
 * preferences — the typed preferences service §12.5 does not apply). No
 * PHI: mock names and mock ids only.
 */

// v2: Phase 12 replaced the 64-item generated seed with the 5-item
// canonical dataset — bumping the keys discards stale v1 snapshots.
const NOTIFICATIONS_KEY = 'medora.notifications.v2';
const CONVERSATIONS_KEY = 'medora.messages.v2';
const LIVE_DELIVERY_KEY = 'medora.notifications.live-delivered.v2';

let idCounter = 0;

/** Unique-enough id for locally created entities (chat messages). */
export function localId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${String(idCounter)}`;
}

function readArray<T>(
  key: string,
  seed: readonly T[],
  probe: (item: unknown) => boolean,
): readonly T[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) {
      writeArray(key, seed);
      return seed;
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every(probe) ? (parsed as T[]) : seed;
  } catch {
    return seed;
  }
}

function writeArray<T>(key: string, value: readonly T[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable/full — the session keeps working in memory.
  }
}

function isNotification(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate['id'] === 'string' && typeof candidate['title'] === 'string';
}

function isConversation(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate['id'] === 'string' && Array.isArray(candidate['messages']);
}

/* ── Notifications ──────────────────────────────────────────────── */

export function readNotifications(): readonly DoctorNotification[] {
  return readArray(NOTIFICATIONS_KEY, SEED_NOTIFICATIONS, isNotification);
}

export function writeNotifications(notifications: readonly DoctorNotification[]): void {
  writeArray(NOTIFICATIONS_KEY, notifications);
}

/* ── Conversations ──────────────────────────────────────────────── */

export function readConversations(): readonly Conversation[] {
  return readArray(CONVERSATIONS_KEY, SEED_CONVERSATIONS, isConversation);
}

export function writeConversations(conversations: readonly Conversation[]): void {
  writeArray(CONVERSATIONS_KEY, conversations);
}

/* ── One-shot "realtime" delivery flag ──────────────────────────── */

export function wasLiveDelivered(): boolean {
  try {
    return window.localStorage.getItem(LIVE_DELIVERY_KEY) === '1';
  } catch {
    return true; // storage unavailable — skip the demo delivery
  }
}

export function markLiveDelivered(): void {
  try {
    window.localStorage.setItem(LIVE_DELIVERY_KEY, '1');
  } catch {
    // Storage unavailable — nothing to record.
  }
}
