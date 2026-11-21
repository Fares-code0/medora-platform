/**
 * System Logs — domain types (ADM-07 · UX §3.7).
 *
 * `LogEvent` is the platform's investigation record: richer than the
 * `AuditEvent` summary the admin home feed renders, and the source that
 * summary is now projected from. One record shape for all five §3.7
 * categories, because an investigator filters across them in one table.
 */

import type { ActorRole } from '../appointments/oversight.types';

export type LogSeverity = 'info' | 'warning' | 'critical';

/** §3.7's five taxonomy groups. */
export type LogCategory =
  | 'authentication'
  | 'security'
  | 'user-action'
  | 'admin-activity'
  | 'system';

/**
 * The specific event within a category. Every member maps to exactly one
 * `LogCategory` through `TYPE_CATEGORY`; `other` exists only because two
 * sources (`AdminAuditEntry.action`, `AuditEvent.action`) are plain strings
 * rather than unions, so classification cannot be total by construction. A
 * test asserts `other` is never actually reached.
 */
export type LogEventType =
  // authentication
  | 'login-succeeded'
  | 'login-failed'
  | 'login-blocked'
  // security
  | 'impossible-travel'
  | 'phi-revealed'
  | 'account-locked'
  | 'failed-attempt-burst'
  | 'permission-changed'
  // A gated read of private conversation content (ADM-06B). Filed under
  // Security, not User actions: it is an administrator reading a patient's
  // messages under a justification, the same weight class as `phi-revealed`.
  | 'communication-content-accessed'
  // user-action
  | 'appointment-requested'
  | 'appointment-confirmed'
  | 'appointment-rescheduled'
  | 'appointment-cancelled'
  | 'appointment-completed'
  | 'appointment-no-show'
  | 'booking-made'
  | 'booking-cancelled'
  | 'messages-sent'
  | 'consent-change'
  // admin-activity
  | 'verification-decided'
  | 'documents-requested'
  | 'doctor-suspended'
  | 'doctor-reactivated'
  | 'credential-reset'
  | 'account-unlocked'
  | 'account-deactivated'
  | 'account-reactivated'
  | 'access-granted'
  | 'access-revoked'
  | 'appointment-nudged'
  | 'appointment-reassigned'
  | 'settings-changed'
  | 'data-export'
  // system
  | 'service-degraded'
  | 'integration-failed'
  | 'job-completed'
  | 'other';

/**
 * One investigable event. `ip` and `device` are nullable because not every
 * source carries them — doctor sign-ins do, patient account events and
 * appointment transitions do not. See `matchesFilters`: a null IP is
 * *excluded* by an IP filter rather than treated as a match.
 */
export interface LogEvent {
  readonly id: string;
  /** ISO 8601 with milliseconds. */
  readonly at: string;
  readonly category: LogCategory;
  readonly type: LogEventType;
  readonly severity: LogSeverity;
  readonly actor: string;
  readonly actorRole: ActorRole;
  /** A record reference — never a patient's name. */
  readonly target: string;
  /**
   * The human-readable action label. For events derived from a source that
   * already had one — `AdminAuditEntry.action`, `AuditEvent.action` — this is
   * that original string, preserved verbatim. Everything else uses
   * `EVENT_TYPE_LABEL[type]`.
   *
   * It exists because the summary-feed projection maps it straight onto
   * `AuditEvent.action`, and ADM-01's feed test asserts on the exact wording
   * of a seeded event. Substituting a generic type label there would rename
   * rows that are already on screen.
   */
  readonly action: string;
  readonly summary: string;
  readonly ip: string | null;
  readonly device: string | null;
  /** Rendered in the drawer's key-value grid and its raw-JSON toggle. */
  readonly payload: Readonly<Record<string, string | number | boolean>>;
}

export type SortOrder = 'newest' | 'oldest';

export interface LogFilters {
  /**
   * Matches actor, event-type label, summary and target — never a patient
   * name, which is a property of what goes *into* those fields rather than of
   * this search. See `matchesFilters`.
   */
  readonly query: string;
  readonly actorRole: ActorRole | 'all';
  readonly actor: string;
  readonly type: LogEventType | 'all';
  readonly severity: LogSeverity | 'all';
  /** ISO datetime-local strings, or '' for open-ended. */
  readonly from: string;
  readonly to: string;
  readonly ip: string;
}

/** One page of the log. `total` is the post-filter count, never `rows.length`. */
export interface LogPage {
  readonly rows: readonly LogEvent[];
  readonly total: number;
}

/**
 * What the service needs to serve one page. Shaped as a real paginated API
 * would take it, because that is the seam a server eventually sits behind.
 */
export interface LogListRequest {
  readonly filters: LogFilters;
  readonly sort: SortOrder;
  readonly offset: number;
  readonly limit: number;
}

export interface SavedView {
  readonly id: string;
  readonly name: string;
  readonly filters: LogFilters;
}
