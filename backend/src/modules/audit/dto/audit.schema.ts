/**
 * Request validation for the audit surface (API §14, RM M28.3–M28.4).
 *
 * ## The filter vocabulary is the writer's, imported rather than repeated
 *
 * `category` and `severity` come from `shared/audit`, which is where the
 * writer files rows under them. Two copies of a five-member union drift,
 * and the drift would be silent: a filter offering a category no row is
 * ever written under returns an empty page that looks like "no events".
 */

import { z } from 'zod';

export const AUDIT_CATEGORIES = [
  'authentication',
  'security',
  'user_action',
  'admin_activity',
  'system',
] as const;

export const AUDIT_SEVERITIES = ['info', 'warning', 'critical'] as const;

/** §14.1's `actorRole` filter. Snapshotted on the row, not joined. */
export const AUDIT_ACTOR_ROLES = ['doctor', 'admin', 'system'] as const;

/**
 * §14.1's filters, plus keyset pagination.
 *
 * `cursor` rather than `page`, and that is the requirement rather than a
 * preference: §14.1 says "keyset pagination (100k+ rows)". An `OFFSET`
 * deep into a hundred thousand rows makes the database count its way
 * there on every page, and — worse for a ledger that is still being
 * written to — a row inserted between two requests shifts every
 * subsequent page by one, so a reader paging through an incident silently
 * skips an event. A keyset cursor cannot skip.
 */
export const auditQuerySchema = z.object({
  /** Free text over `summary`, trigram-backed (`audit_events_summary_trgm_idx`). */
  q: z.string().trim().min(2, 'Search for at least two characters').max(120).optional(),
  actorRole: z.enum(AUDIT_ACTOR_ROLES).optional(),
  actorId: z.string().uuid().optional(),
  category: z.enum(AUDIT_CATEGORIES).optional(),
  severity: z.enum(AUDIT_SEVERITIES).optional(),
  /** Time precision, as §14.1 asks: ISO instants, not dates. */
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  /** An address or a prefix — `ip=10.` finds a subnet. */
  ip: z.string().trim().max(45).optional(),
  incidentRef: z.string().trim().max(40).optional(),
  /** `<occurredAt ISO>|<uuid>` — opaque to clients, and validated here. */
  cursor: z.string().trim().max(120).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  /**
   * Whether to return the pivot (RM M28.3, M32.3). Absent: yes on the
   * first page, no on a cursor page.
   *
   * The pivot counts the *filtered set*, and a cursor does not change the
   * filtered set, so every page of one listing has the same pivot. Counting
   * it again on page two is two full scans of the filtered ledger that tell
   * the client what page one already did. `pivot=true` asks for it anyway
   * (a client that lost page one's); `pivot=false` skips it on page one.
   */
  pivot: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});

export type AuditQuery = z.infer<typeof auditQuerySchema>;

/**
 * §14.3's export.
 *
 * The same filters, because "filter-respecting" is the whole point, plus
 * the format. A hard row ceiling rather than "everything": an unbounded
 * export of a partitioned ledger is a way to read a hundred thousand rows
 * into one response and take the process down with it.
 */
export const auditExportSchema = auditQuerySchema
  .omit({ cursor: true, pageSize: true, pivot: true })
  .extend({
    format: z.enum(['csv', 'json']).default('csv'),
    limit: z.coerce.number().int().min(1).max(10_000).default(1_000),
  });

export type AuditExportInput = z.infer<typeof auditExportSchema>;

/* ── Incident bookmarks (§14.4) ───────────────────────────────────── */

export const incidentBookmarkSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(300).optional(),
  /**
   * The selection. Bounded, because `event_ids` is a `uuid[]` on one row
   * (ADR-024) rather than a join table — a saved selection is a case
   * file, not a dataset.
   */
  eventIds: z.array(z.string().uuid()).max(500).default([]),
  incidentRef: z.string().trim().max(40).optional(),
});

export type IncidentBookmarkInput = z.infer<typeof incidentBookmarkSchema>;
