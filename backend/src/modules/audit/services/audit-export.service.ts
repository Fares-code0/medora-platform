/**
 * Export and incident bookmarks — API §14.3–§14.4, RM M28.4.
 *
 * > ✅ Verify: export produces an `admin_activity` audit row.
 *
 * ## The export audits itself, and that is the point of the item
 *
 * Reading the ledger in bulk is itself a privileged act: it is the step
 * that takes a hundred thousand records of who did what out of the system
 * and puts them in a file. So `admin.audit_export` is written **through
 * the same dispatcher** every other audited action uses, which files it
 * as `admin_activity` by the taxonomy rather than by this service
 * asserting a category.
 *
 * The event is written **after** the rows are read, so an export that
 * failed does not claim to have happened, and it records the filters and
 * the row count — not the rows. An audit event containing the export it
 * describes would double the ledger every time somebody read it.
 *
 * ## Served as a body, not as a job
 *
 * §12.5's *report* exports are asynchronous because they render PDFs and
 * need M25 and M30. This is a filtered projection of one table, bounded
 * at ten thousand rows, so it is computed and returned. That keeps the
 * audited act and the data in one request — an async export would need
 * the file to live somewhere, which is the M25 dependency M22.4 is
 * already blocked on.
 */

import { Inject, Injectable } from '@nestjs/common';

import type { AuthenticatedUser } from '../../../common/auth/authenticated-user';
import { AppException } from '../../../common/errors/app.exception';
import { AUDIT_DISPATCHER, type AuditDispatcher } from '../../../shared/audit';
import type { AuditExportInput, IncidentBookmarkInput } from '../dto/audit.schema';
import { AuditRepository } from '../repositories/audit.repository';
import { toView } from './audit-query.service';

export interface AuditExport {
  readonly format: 'csv' | 'json';
  readonly contentType: string;
  readonly fileName: string;
  readonly body: string;
  readonly rowCount: number;
}

/** The columns an export carries, in a fixed order. */
const COLUMNS = [
  'occurredAt',
  'category',
  'severity',
  'eventType',
  'summary',
  'actorId',
  'actorRole',
  'target',
  'ipAddress',
  'sessionId',
  'incidentRef',
] as const;

@Injectable()
export class AuditExportService {
  constructor(
    private readonly audit: AuditRepository,
    @Inject(AUDIT_DISPATCHER) private readonly dispatcher: AuditDispatcher,
  ) {}

  /**
   * S5: a Hospital Admin exports its hospital's rows only, and the export's
   * own audit row is filed under that hospital so it shows in that ledger.
   */
  async export(
    actor: AuthenticatedUser,
    input: AuditExportInput,
    hospitalId: string | null,
  ): Promise<AuditExport> {
    const rows = await this.audit.forExport(
      { ...input, pageSize: input.limit },
      input.limit,
      hospitalId,
    );
    const items = rows.map(toView);

    const body =
      input.format === 'json' ? JSON.stringify({ items }, null, 2) : toCsv(items);

    // After the read, so a failed export does not claim to have
    // happened. Filters and counts, never the rows.
    await this.dispatcher.record({
      action: 'admin.audit_export',
      actor: { userId: actor.id, role: actor.role, sessionId: actor.sessionId },
      entityType: 'audit_events',
      entityId: 'export',
      ...(hospitalId === null ? {} : { hospitalId }),
      metadata: {
        format: input.format,
        rowCount: items.length,
        category: input.category ?? null,
        severity: input.severity ?? null,
        actorFilter: input.actorId ?? null,
        from: input.from ?? null,
        to: input.to ?? null,
        query: input.q ?? null,
      },
    });

    return {
      format: input.format,
      contentType: input.format === 'json' ? 'application/json' : 'text/csv; charset=utf-8',
      fileName: `audit-events-${new Date().toISOString().slice(0, 10)}.${input.format}`,
      body,
      rowCount: items.length,
    };
  }

  /* ── Incident bookmarks (§14.4) ────────────────────────────── */

  async bookmarks(ownerId: string) {
    return (await this.audit.bookmarks(ownerId)).map(toBookmark);
  }

  async createBookmark(ownerId: string, input: IncidentBookmarkInput) {
    try {
      return toBookmark(await this.audit.createBookmark(ownerId, input));
    } catch (error) {
      // `(owner_id, name)` is UNIQUE. A pre-check cannot see an
      // uncommitted row, so the constraint is what tells the truth when
      // one investigator saves the same case name twice.
      if (isUniqueViolation(error)) {
        throw AppException.conflict(`You already have a bookmark named "${input.name}"`);
      }

      throw error;
    }
  }

  async deleteBookmark(ownerId: string, id: string): Promise<void> {
    // Scoped to the owner, and a bookmark belonging to someone else is
    //404 rather than 403 — the refusal must not confirm it exists.
    if (!(await this.audit.deleteBookmark(ownerId, id))) {
      throw AppException.notFound('Bookmark not found');
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

function toBookmark(row: {
  id: string;
  name: string;
  description: string | null;
  eventIds: string[];
  incidentRef: string | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    eventIds: row.eventIds,
    incidentRef: row.incidentRef,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * RFC 4180 quoting, applied to every field rather than to the ones that
 * look like they need it.
 *
 * A summary containing a comma splits a row; one containing a quote
 * breaks the parser; one containing a newline creates a record that was
 * never logged. Quoting conditionally means deciding correctly every
 * time, and the cost of quoting always is a few bytes.
 */
function toCsv(items: readonly Record<string, unknown>[]): string {
  const lines = [COLUMNS.join(',')];

  for (const item of items) {
    lines.push(COLUMNS.map((column) => quote(item[column])).join(','));
  }

  return `${lines.join('\r\n')}\r\n`;
}

function quote(value: unknown): string {
  if (value === null || value === undefined) return '""';

  // Narrowed rather than `String(value)`: every column of the projection
  // is a scalar, and an object reaching here would be written as
  // `[object Object]` — a cell that silently loses its content in a file
  // somebody is about to treat as evidence.
  const text =
    typeof value === 'string'
      ? value
      : typeof value === 'number' || typeof value === 'boolean'
        ? String(value)
        : JSON.stringify(value);

  return `"${(text ?? '').replace(/"/g, '""')}"`;
}
