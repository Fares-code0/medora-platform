/**
 * Communication monitoring domain types (ADM-06 · UX §3.6).
 *
 * Two things here are deliberately absent. There is no `SafetyFlag.body` —
 * only `excerpt`, the matched message and nothing around it, because §3.6
 * says minimum necessary context and a queue is not a reader. And no type
 * here carries a patient's name in a field the table renders directly; the
 * row carries it only to hand to `MaskedIdentifier`.
 */

import type { NamedSeries } from '@/components/charts';

/* ── Safety flags ─────────────────────────────────────────────── */

export type FlagCategory =
  | 'emergency-language'
  | 'harassment'
  | 'phi-wrong-channel'
  | 'prescription-solicitation';

export type FlagSource = 'auto' | 'user';

export type FlagStatus = 'open' | 'under-review' | 'resolved';

export type FlagResolution = 'dismissed' | 'warned' | 'escalated';

/**
 * A flag is derived, never stored. Its id is a deterministic function of
 * the message and category it came from — see `flagId` in `flag-rules.ts`.
 */
export interface SafetyFlag {
  readonly id: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly category: FlagCategory;
  readonly source: FlagSource;
  /** The matched message only. Never the surrounding thread. */
  readonly excerpt: string;
  /** "Dr. Omar Khalil" or "Patient" — never a patient's name. */
  readonly authorLabel: string;
  readonly at: string;
  readonly status: FlagStatus;
  readonly resolution: FlagResolution | null;
  readonly note: string | null;
  readonly decidedBy: string | null;
  readonly decidedAt: string | null;
}

/** The persisted half: everything a reviewer decided about a derived flag. */
export interface FlagOverlay {
  readonly flagId: string;
  readonly status: FlagStatus;
  readonly resolution: FlagResolution | null;
  readonly note: string | null;
  readonly decidedBy: string;
  readonly decidedAt: string;
}

/* ── Conversation metadata ────────────────────────────────────── */

export type ConversationStatus = 'active' | 'unanswered' | 'archived';

export interface ConversationRow {
  readonly id: string;
  readonly doctorName: string;
  /** Null for threads with no patient participant (doctor-to-doctor). */
  readonly patientId: string | null;
  /** Handed to `MaskedIdentifier`, never rendered directly. */
  readonly patientName: string | null;
  readonly participantCount: number;
  readonly startedAt: string;
  readonly lastActivityAt: string;
  readonly messageCount: number;
  readonly status: ConversationStatus;
  readonly flagCount: number;
}

export interface ConversationFilters {
  /**
   * Matches doctor name and conversation id — never topic, and never a
   * patient name. Topic is excluded because the seeded care-team thread's
   * topic IS a patient name ('Care team — Omar Farouk'); matching it would
   * make patient names searchable through the back door.
   */
  readonly query: string;
  readonly status: ConversationStatus | 'all';
  readonly flagged: 'all' | 'flagged' | 'unflagged';
}

export type ConversationSort = 'recent' | 'oldest' | 'most-messages' | 'most-flags';

/* ── Overview aggregates ──────────────────────────────────────── */

export interface CommunicationsOverview {
  /** Messages per day across the trailing window. */
  readonly volume: NamedSeries;
  /** Null when no patient message has yet received a reply. */
  readonly medianResponseMinutes: number | null;
  readonly unansweredOver48h: number;
  readonly activeConversations: number;
  /** 0–1. Conversation-level: one thread with three flags counts once. */
  readonly flagRate: number;
}

/* ── Content access ───────────────────────────────────────────── */

export type ContentAccessCategory =
  | 'patient-complaint'
  | 'safety-flag'
  | 'legal-request'
  | 'quality-audit';

/**
 * One gated read. `id` is the "ref #" rendered in the viewer banner AND the
 * id of the log event written in `/admin/logs` — one identifier, not two.
 */
export interface ContentAccessEntry {
  readonly id: string;
  readonly conversationId: string;
  readonly category: ContentAccessCategory;
  readonly reason: string;
  readonly actor: string;
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly outcome: 'completed' | 'incomplete' | null;
}

/** The whole screen, in one object. */
export interface CommunicationsDocument {
  readonly rows: readonly ConversationRow[];
  readonly overview: CommunicationsOverview;
  readonly flags: readonly SafetyFlag[];
  readonly accessLog: readonly ContentAccessEntry[];
}
