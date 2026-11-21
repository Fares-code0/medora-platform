/**
 * Communication monitoring — mock service and content-access log
 * (ADM-06 sub-project B · UX §3.6, Task 5).
 *
 * **The access log is append-only.** `openAccess` appends and `closeAccess`
 * patches the `closedAt`/`outcome` of the entry it already wrote — neither
 * removes a row, and there is no third verb that could. The access log is
 * the record of who read private messages; a service that can rewrite or
 * delete an entry is not an audit trail, and "we just won't call that
 * method" is not a guarantee. `communications.api.test.ts` asserts the
 * service's exact key set for exactly this reason, following ADM-07.
 *
 * **Every entry this log holds is also a `/admin/logs` row.** `logs.api.ts`
 * reads `list().accessLog` fresh on every aggregate and classifies each entry
 * through `fromContentAccess` under the *same* id — not a namespaced one —
 * so the "ref #" the viewer banner shows (Task 6) is the exact id an
 * investigator finds the row by (ADM-06B Task 12). One log, read twice, not
 * two logs that could disagree.
 *
 * **`openAccess` re-validates the reason.** The dialog validates
 * `validateAccessReason` for the administrator's benefit — so they see the
 * problem before submitting — but this service validates it again because
 * it is the actual boundary a caller cannot route around.
 *
 * **The shared `medora.messaging.v1` store is read-only from here.**
 * `readStoredConversations()` is called on every `list()`; this module never
 * imports or calls `writeStoredConversations`. Everything this feature
 * mutates — flag overlays and the access log — lives in its own document
 * under `medora.admin.communications.v1`.
 *
 * Shape follows `patients.api.ts`: a `LATENCY_MS` delay, a module-level
 * store over `localStorage`, and mutations that resolve to the full patched
 * document so the query layer seeds its cache instead of refetching —
 * except `openAccess`, which resolves to the entry it just wrote, because
 * that entry's `id` is the reference the viewer banner shows (Task 6).
 */

import { readStoredConversations, SEED_CONTACTS } from '@/features/shared-domain/conversations';

import {
  buildOverview,
  toConversationRows,
  validateAccessReason,
  deriveFlags,
} from './communications';
import type {
  CommunicationsDocument,
  ContentAccessCategory,
  ContentAccessEntry,
  FlagOverlay,
  FlagResolution,
  FlagStatus,
} from './communications.types';

export type { CommunicationsDocument };

const LATENCY_MS = 260;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

/* ── Store ────────────────────────────────────────────────────── */

const STORAGE_KEY = 'medora.admin.communications.v1';

interface StoredDocument {
  readonly overlays: readonly FlagOverlay[];
  readonly accessLog: readonly ContentAccessEntry[];
}

const DEFAULT_STORE: StoredDocument = { overlays: [], accessLog: [] };

function load(): StoredDocument {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_STORE;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_STORE;
    return { ...DEFAULT_STORE, ...(parsed as Partial<StoredDocument>) };
  } catch {
    return DEFAULT_STORE;
  }
}

function persist(store: StoredDocument): StoredDocument {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Storage unavailable — decisions stay session-local.
  }
  return store;
}

export class CommunicationsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommunicationsError';
  }
}

/**
 * Monotonic within the session, so `ca-2` never collides with an earlier
 * `ca-2` after entries accumulate — the same reasoning `localId` uses in
 * `shared-domain/conversations/store.ts`, not `Date.now()` alone, which two
 * calls within the same millisecond could tie.
 */
let accessLogSequence = 0;

function nextAccessLogId(): string {
  accessLogSequence += 1;
  return `ca-${String(accessLogSequence)}`;
}

/** Builds the whole-screen document from the read-only conversation store plus this feature's own overlays and log. */
function toDocument(store: StoredDocument): CommunicationsDocument {
  const conversations = readStoredConversations();
  const now = Date.now();
  const flags = deriveFlags(conversations, SEED_CONTACTS, store.overlays);
  const rows = toConversationRows(conversations, SEED_CONTACTS, flags, now);
  const overview = buildOverview(conversations, rows, flags, now);
  return { rows, overview, flags, accessLog: store.accessLog };
}

function upsertOverlay(
  store: StoredDocument,
  overlay: FlagOverlay,
): StoredDocument {
  const withoutExisting = store.overlays.filter((entry) => entry.flagId !== overlay.flagId);
  return { ...store, overlays: [...withoutExisting, overlay] };
}

/* ── Inputs ───────────────────────────────────────────────────── */

export interface OpenAccessInput {
  readonly conversationId: string;
  readonly category: ContentAccessCategory;
  readonly reason: string;
  readonly actor: string;
}

export interface CloseAccessInput {
  readonly id: string;
  readonly outcome: 'completed' | 'incomplete';
}

export interface FlagStatusInput {
  readonly flagId: string;
  readonly status: FlagStatus;
  readonly decidedBy: string;
}

export interface ResolveFlagInput {
  readonly flagId: string;
  readonly resolution: FlagResolution;
  readonly note: string;
  readonly decidedBy: string;
}

/* ── Service ──────────────────────────────────────────────────── */

export const communicationsApi = {
  list: (): Promise<CommunicationsDocument> => delay(toDocument(load())),

  /**
   * Appends one access-log entry and returns it — never the whole document,
   * because the caller needs the entry's `id` before the document round
   * trips back, to show as the viewer banner's reference (Task 6).
   *
   * Re-validates the reason rather than trusting the dialog: the dialog's
   * own check is for the administrator's benefit, this one is the boundary.
   */
  openAccess: async ({
    conversationId,
    category,
    reason,
    actor,
  }: OpenAccessInput): Promise<ContentAccessEntry> => {
    const check = validateAccessReason(reason);
    if (!check.ok) {
      throw new CommunicationsError(check.message ?? 'A written reason is required.');
    }

    const entry: ContentAccessEntry = {
      id: nextAccessLogId(),
      conversationId,
      category,
      reason: reason.trim(),
      actor,
      openedAt: new Date().toISOString(),
      closedAt: null,
      outcome: null,
    };

    const store = load();
    persist({ ...store, accessLog: [...store.accessLog, entry] });
    return delay(entry);
  },

  /**
   * Patches the matching entry's `closedAt`/`outcome` in place. Never
   * removes it — the log stays a complete record of every open, not just
   * the ones that closed cleanly.
   */
  closeAccess: ({ id, outcome }: CloseAccessInput): Promise<CommunicationsDocument> => {
    const store = load();
    const closedAt = new Date().toISOString();
    const accessLog = store.accessLog.map((entry) =>
      entry.id === id ? { ...entry, closedAt, outcome } : entry,
    );
    return delay(toDocument(persist({ ...store, accessLog })));
  },

  /** Upserts an overlay with no resolution yet — moving a flag into review, not deciding it. */
  setFlagStatus: ({
    flagId,
    status,
    decidedBy,
  }: FlagStatusInput): Promise<CommunicationsDocument> => {
    const store = load();
    const overlay: FlagOverlay = {
      flagId,
      status,
      resolution: null,
      note: null,
      decidedBy,
      decidedAt: new Date().toISOString(),
    };
    return delay(toDocument(persist(upsertOverlay(store, overlay))));
  },

  /** Decides a flag. Refuses an empty or whitespace-only note — a resolution with no note is not a decision an auditor can evaluate. */
  resolveFlag: async ({
    flagId,
    resolution,
    note,
    decidedBy,
  }: ResolveFlagInput): Promise<CommunicationsDocument> => {
    if (note.trim() === '') {
      throw new CommunicationsError('A note is required to resolve a flag.');
    }

    const store = load();
    const overlay: FlagOverlay = {
      flagId,
      status: 'resolved',
      resolution,
      note: note.trim(),
      decidedBy,
      decidedAt: new Date().toISOString(),
    };
    return delay(toDocument(persist(upsertOverlay(store, overlay))));
  },
};
