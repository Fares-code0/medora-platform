/**
 * The investigation surface — API §14.1–§14.2, RM M28.3.
 *
 * > ✅ Verify: pagination stable at 100k seeded rows; p95 < 300 ms.
 *
 * ## What "stable" means here, and why keyset delivers it
 *
 * The ledger is written to while it is being read. Under `OFFSET`, one
 * event inserted between two page requests shifts every later page by
 * one — so an investigator paging through an incident **silently skips an
 * event**, which is the one failure an audit browser must not have. A
 * keyset cursor is a position in the data rather than a count from the
 * start, so an insert cannot move it.
 */

import { Injectable } from '@nestjs/common';

import { AppException } from '../../../common/errors/app.exception';
import {
  AuditRepository,
  cursorFor,
  parseCursor,
  type AuditEventDetailRow,
  type AuditEventRow,
} from '../repositories/audit.repository';
import type { AuditQuery } from '../dto/audit.schema';

/** How many correlated events §14.2 hands back with a detail. */
const CORRELATED_LIMIT = 50;

@Injectable()
export class AuditQueryService {
  constructor(private readonly audit: AuditRepository) {}

  /** §14.1 — a filtered, keyset-paginated page, with its pivot. */
  /**
   * S5: `hospitalId` restricts the page, the pivot and the correlated set to
   * `audit_events.hospital_id` = the Hospital Admin's hospital; `null` is the
   * Platform Admin's whole, metadata-only ledger (unchanged).
   */
  async list(query: AuditQuery, retentionDays: number, hospitalId: string | null) {
    if (query.from !== undefined && query.to !== undefined) {
      if (Date.parse(query.from) > Date.parse(query.to)) {
        throw AppException.validation(
          { from: ['The start of the window must be before its end'] },
          'That time window is empty',
        );
      }
    }

    // Page one carries the pivot; a cursor page carries it only on request
    // (`pivot` in `audit.schema.ts`). Same filters, same pivot: recounting
    // it per page was two full scans of the filtered ledger each time.
    // A mangled cursor is already read as no cursor (`parseCursor`), so it
    // is page one here too.
    const withPivot = query.pivot ?? parseCursor(query.cursor) === null;

    const [{ rows, hasMore }, pivot] = await Promise.all([
      this.audit.page(query, hospitalId),
      withPivot ? this.audit.pivot(query, hospitalId) : Promise.resolve(undefined),
    ]);
    const last = rows.at(-1);

    return {
      items: rows.map(toView),
      // Absent rather than null when there is no next page: a client
      // that sends back a cursor it was not given gets the first page,
      // and one that checks for the key gets a clean stop.
      ...(hasMore && last !== undefined ? { nextCursor: cursorFor(last) } : {}),
      hasMore,
      // Absent rather than null on a page that did not compute it, like
      // `nextCursor`: a client that checks for the key is never handed an
      // empty pivot that looks like "no events".
      ...(pivot === undefined ? {} : { pivot }),
      // §14.1: "retention window returned in meta". A reader looking at
      // an empty result for last year needs to know whether the platform
      // deleted it or nothing happened.
      meta: { retentionDays },
    };
  }

  /** §14.2 — one event, its payload, and what happened around it. */
  /** Another hospital's event is 404, as a missing one (ADR-022). */
  async detail(id: string, hospitalId: string | null) {
    const event = await this.audit.findById(id, hospitalId);

    if (event === null) throw AppException.notFound('Audit event not found');

    const correlated = await this.audit.correlated(event, CORRELATED_LIMIT, hospitalId);

    return {
      ...toView(event),
      // The structured detail §14.2 asks for, including whatever
      // before/after diff the writer recorded. Never clinical content —
      // `AuditMetadata` is scalar-only by contract and names fields
      // rather than values (MG §11.6).
      payload: event.payload ?? {},
      correlated: correlated.map(toView),
    };
  }
}

export function toView(row: AuditEventRow | AuditEventDetailRow) {
  return {
    id: row.id,
    occurredAt: row.occurredAt.toISOString(),
    actorId: row.actorId,
    actorRole: row.actorRole,
    // The wire spellings, which are the enum's `@map` values and what
    // §14.1's filters take.
    category: row.category.toLowerCase(),
    eventType: row.eventType,
    severity: row.severity.toLowerCase(),
    summary: row.summary,
    target: row.target,
    ipAddress: row.ipAddress,
    device: row.device,
    sessionId: row.sessionId,
    incidentRef: row.incidentRef,
  };
}
