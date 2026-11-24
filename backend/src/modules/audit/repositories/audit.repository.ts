/**
 * The audit ledger's read side (DB §M1, API §14, RM M28.3–M28.5).
 *
 * ## Read-only, by construction
 *
 * There is no method here that writes an `audit_events` row. The single
 * writer is `shared/audit`'s dispatcher, which is what "the single write
 * choke point" in M28.1 means — a repository in a domain module that
 * could insert one would be a second choke point, and two choke points
 * are none.
 *
 * The one thing this file does remove is a **partition**, not a row
 * (M28.5): ADR-007 R2 makes retention a `DROP TABLE` of a whole month,
 * and that is the only mechanism by which anything ever leaves this
 * table.
 */

import { Injectable } from '@nestjs/common';

import { Prisma } from '../../../generated/prisma/client';
import { PrismaService } from '../../../shared/database';
import type { AuditQuery } from '../dto/audit.schema';

export interface AuditEventRow {
  readonly id: string;
  readonly occurredAt: Date;
  readonly actorId: string | null;
  readonly actorRole: string | null;
  readonly category: string;
  readonly eventType: string;
  readonly severity: string;
  readonly summary: string;
  readonly target: string | null;
  readonly ipAddress: string | null;
  readonly device: string | null;
  readonly sessionId: string | null;
  readonly incidentRef: string | null;
  /** The hospital the event belongs to (§2.13); null for platform-wide. */
  readonly hospitalId: string | null;
}

export interface AuditEventDetailRow extends AuditEventRow {
  readonly payload: Prisma.JsonValue | null;
}

/** ±5 minutes, which is §14.2's own window for "correlated". */
export const CORRELATION_WINDOW_MS = 5 * 60 * 1000;

/**
 * The shape of `audit_events.id` and `incident_bookmarks.id`. An id that
 * is not one names nothing: "not found" here, never a uuid cast that
 * PostgreSQL answers with a 500 (API contract audit, 2026-11-14).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const LIST_SELECT = {
  id: true,
  occurredAt: true,
  actorId: true,
  actorRole: true,
  category: true,
  eventType: true,
  severity: true,
  summary: true,
  target: true,
  ipAddress: true,
  device: true,
  sessionId: true,
  incidentRef: true,
  hospitalId: true,
} as const;

/** A ledger query with the caller's hospital scope applied (`undefined` = platform). */
export type ScopedAuditQuery = AuditQuery & { readonly scopeHospitalId?: string };

@Injectable()
export class AuditRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * One page, newest first, by keyset.
   *
   * Ordered by `(occurred_at DESC, id DESC)` and cursored on the same
   * pair. `occurred_at` alone is not unique — the writer can file two
   * events in the same millisecond, and M14's lab timeline is the lesson
   * that a tie in an ordering column is a defect rather than a detail —
   * so the tuple comparison carries `id` as the tiebreak. Without it a
   * page boundary landing inside a tie drops or repeats an event.
   *
   * One row beyond the page is fetched to decide `hasMore`, which is
   * cheaper and more honest than a `COUNT` over a hundred thousand rows
   * that the caller cannot use anyway.
   */
  async page(
    query: ScopedAuditQuery,
  ): Promise<{ rows: AuditEventRow[]; hasMore: boolean }> {
    const rows = await this.prisma.auditEvent.findMany({
      where: this.whereFor(query),
      select: LIST_SELECT,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: query.pageSize + 1,
    });

    return { rows: rows.slice(0, query.pageSize), hasMore: rows.length > query.pageSize };
  }

  /** The full row, payload included — §14.2. */
  detail(id: string, occurredAt: Date): Promise<AuditEventDetailRow | null> {
    if (!UUID.test(id)) return Promise.resolve(null);
    return this.prisma.auditEvent.findFirst({
      where: { id, occurredAt },
      select: { ...LIST_SELECT, payload: true },
    });
  }

  /** By id alone, which is how a client addresses an event it listed. */
  findById(id: string): Promise<AuditEventDetailRow | null> {
    if (!UUID.test(id)) return Promise.resolve(null);
    return this.prisma.auditEvent.findFirst({
      where: { id },
      select: { ...LIST_SELECT, payload: true },
    });
  }

  /**
   * §14.2's `correlated`: the same session, or the same actor within
   * ±5 minutes.
   *
   * An `OR` rather than two queries, because the two sets overlap and a
   * client showing them separately would show the same event twice. The
   * session half only applies when the row has one — `sessionId` reached
   * `AuditActor` at M28.1, after seventy call sites already existed, so
   * the actor-and-time half is what makes correlation work regardless of
   * whether a call site was updated.
   */
  correlated(event: AuditEventRow, limit: number): Promise<AuditEventRow[]> {
    const window = {
      gte: new Date(event.occurredAt.getTime() - CORRELATION_WINDOW_MS),
      lte: new Date(event.occurredAt.getTime() + CORRELATION_WINDOW_MS),
    };

    const sameSession =
      event.sessionId === null ? [] : [{ sessionId: event.sessionId, occurredAt: window }];
    const sameActor =
      event.actorId === null ? [] : [{ actorId: event.actorId, occurredAt: window }];

    // Neither an actor nor a session: a system event correlates with
    // nothing, and inventing a "same minute" set would put unrelated
    // traffic into an investigation.
    if (sameSession.length === 0 && sameActor.length === 0) return Promise.resolve([]);

    return this.prisma.auditEvent.findMany({
      where: { id: { not: event.id }, OR: [...sameSession, ...sameActor] },
      select: LIST_SELECT,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
  }

  /** Rows for an export, bounded — §14.3. */
  forExport(query: AuditQuery, limit: number): Promise<AuditEventRow[]> {
    return this.prisma.auditEvent.findMany({
      where: this.whereFor(query),
      select: LIST_SELECT,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
  }

  /**
   * §14.1's "pivot support": the counts a browser shows beside its
   * filters, over the *filtered* set.
   *
   * Grouped in the database rather than by reading the page and tallying
   * it — a pivot over the page is a pivot over fifty rows, which is not
   * what a hundred-thousand-row ledger is being asked about.
   *
   * **The cursor is not a filter**, so it is not applied here. It was
   * until M32.3, and every page after the first then counted only the rows
   * older than its cursor — numbers beside the filters that shrank as the
   * reader paged. `filtersOf` is the filter alone.
   */
  async pivot(query: ScopedAuditQuery): Promise<{
    byCategory: Record<string, number>;
    bySeverity: Record<string, number>;
  }> {
    const where = this.filtersOf(query);

    const [categories, severities] = await Promise.all([
      this.prisma.auditEvent.groupBy({ by: ['category'], where, _count: { _all: true } }),
      this.prisma.auditEvent.groupBy({ by: ['severity'], where, _count: { _all: true } }),
    ]);

    return {
      byCategory: Object.fromEntries(
        categories.map((row) => [String(row.category).toLowerCase(), row._count._all]),
      ),
      bySeverity: Object.fromEntries(
        severities.map((row) => [String(row.severity).toLowerCase(), row._count._all]),
      ),
    };
  }

  /* ── Partitions (M28.5) ────────────────────────────────────── */

  /** The monthly partitions that exist, oldest first. */
  async partitions(): Promise<{ name: string; from: Date }[]> {
    const rows = await this.prisma.$queryRaw<{ name: string; from: Date | null }[]>`
      SELECT c.relname AS name,
             -- The lower bound of FOR VALUES FROM (x) TO (y), parsed out
             -- of the bound expression Postgres prints. The DEFAULT
             -- partition has no bound and comes back null.
             NULLIF(
               substring(pg_get_expr(c.relpartbound, c.oid) FROM 'FROM \\(''([^'']+)'''),
               ''
             )::timestamptz AS from
      FROM pg_class c
      JOIN pg_inherits i ON i.inhrelid = c.oid
      JOIN pg_class parent ON parent.oid = i.inhparent
      WHERE parent.relname = 'audit_events'
      ORDER BY 2 NULLS FIRST
    `;

    return rows
      .filter((row): row is { name: string; from: Date } => row.from !== null)
      .map((row) => ({ name: row.name, from: row.from }));
  }

  /** Creates the month's partition if absent — idempotent by the function. */
  async ensurePartition(monthStart: Date): Promise<void> {
    const month = monthStart.toISOString().slice(0, 10);

    await this.prisma.$executeRaw`SELECT create_audit_events_partition(${month}::date)`;
  }

  /**
   * Drops one monthly partition.
   *
   * `$executeRawUnsafe` because a table name cannot be a bind parameter.
   * The name is **not** caller input: it comes from `partitions()`, which
   * reads `pg_class`, and the service additionally refuses any name that
   * is not `audit_events_YYYY_MM`. Those two together are what make this
   * safe — either alone would not be.
   */
  async dropPartition(name: string): Promise<void> {
    if (!/^audit_events_\d{4}_\d{2}$/.test(name)) {
      throw new Error(`Refusing to drop "${name}": not an audit_events month partition`);
    }

    // Through the owner-run, validated function (migration
    // 20261125090000): the application holds no DDL right of its own, and
    // the database refuses a partition whose month has not ended.
    await this.prisma.$executeRaw`SELECT drop_audit_events_partition(${name})`;
  }

  /* ── Incident bookmarks (§14.4) ────────────────────────────── */

  bookmarks(ownerId: string) {
    return this.prisma.db.incidentBookmark.findMany({
      where: { ownerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  createBookmark(ownerId: string, data: {
    readonly name: string;
    readonly description?: string | undefined;
    readonly eventIds: readonly string[];
    readonly incidentRef?: string | undefined;
  }) {
    return this.prisma.db.incidentBookmark.create({
      data: {
        ownerId,
        name: data.name,
        ...(data.description === undefined ? {} : { description: data.description }),
        eventIds: [...data.eventIds],
        ...(data.incidentRef === undefined ? {} : { incidentRef: data.incidentRef }),
      },
    });
  }

  /** Scoped to the owner: a bookmark is the investigator's own note. */
  async deleteBookmark(ownerId: string, id: string): Promise<boolean> {
    if (!UUID.test(id)) return false;
    const deleted = await this.prisma.db.incidentBookmark.deleteMany({
      where: { id, ownerId },
    });

    return deleted.count === 1;
  }

  /** The filters and, when the query carries one, the keyset cursor's bound. */
  private whereFor(query: ScopedAuditQuery): Prisma.AuditEventWhereInput {
    return this.conditionsFor(query, parseCursor(query.cursor));
  }

  /** The filters alone: the set every page of one listing is drawn from. */
  private filtersOf(query: ScopedAuditQuery): Prisma.AuditEventWhereInput {
    return this.conditionsFor(query, null);
  }

  private conditionsFor(
    query: ScopedAuditQuery,
    cursor: { occurredAt: Date; id: string } | null,
  ): Prisma.AuditEventWhereInput {
    return {
      // Hospital Admin scope (multi-hospital §2.13): the service sets it from
      // the caller's administrative scope, never from the query string.
      ...(query.scopeHospitalId === undefined ? {} : { hospitalId: query.scopeHospitalId }),
      ...(query.q === undefined
        ? {}
        : { summary: { contains: query.q, mode: 'insensitive' } }),
      ...(query.actorRole === undefined ? {} : { actorRole: query.actorRole }),
      ...(query.actorId === undefined ? {} : { actorId: query.actorId }),
      ...(query.category === undefined
        ? {}
        : { category: query.category.toUpperCase() as never }),
      ...(query.severity === undefined
        ? {}
        : { severity: query.severity.toUpperCase() as never }),
      ...(query.incidentRef === undefined ? {} : { incidentRef: query.incidentRef }),
      ...(query.from === undefined && query.to === undefined && cursor === null
        ? {}
        : {
            occurredAt: {
              ...(query.from === undefined ? {} : { gte: new Date(query.from) }),
              ...(query.to === undefined ? {} : { lte: new Date(query.to) }),
              // The keyset's own bound, intersected with the filter's:
              // a cursor inside a `from`/`to` window must not widen it.
              ...(cursor === null ? {} : { lte: cursor.occurredAt }),
            },
          }),
      // The tuple comparison, expressed the only way Prisma can: rows
      // strictly older, or the same instant with a smaller id. Written
      // as a raw fragment it would be `(occurred_at, id) < (…, …)`.
      ...(cursor === null
        ? {}
        : {
            OR: [
              { occurredAt: { lt: cursor.occurredAt } },
              { occurredAt: cursor.occurredAt, id: { lt: cursor.id } },
            ],
          }),
      ...(query.ip === undefined
        ? {}
        : {
            // `inet` has no `LIKE`, so a prefix search is a cast. An
            // exact address still uses `audit_events_ip_address_idx`.
            ipAddress: query.ip.includes('/') ? { equals: query.ip } : { equals: query.ip },
          }),
    };
  }
}

/** `<ISO>|<uuid>`, or `null` when absent or malformed. */
export function parseCursor(cursor: string | undefined): { occurredAt: Date; id: string } | null {
  if (cursor === undefined) return null;

  const separator = cursor.lastIndexOf('|');
  if (separator === -1) return null;

  const at = Date.parse(cursor.slice(0, separator));
  const id = cursor.slice(separator + 1);

  // A malformed cursor is treated as no cursor rather than as an error:
  // it can only come from a client that mangled one this server issued,
  // and the first page is a safe answer where a 422 would break paging.
  // Both halves are checked: an id that is not a uuid would otherwise
  // reach the keyset comparison on a uuid column and answer 500.
  return Number.isNaN(at) || !UUID.test(id) ? null : { occurredAt: new Date(at), id };
}

/** The cursor for the last row of a page. */
export function cursorFor(row: AuditEventRow): string {
  return `${row.occurredAt.toISOString()}|${row.id}`;
}
