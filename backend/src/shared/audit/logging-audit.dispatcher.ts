import { Injectable, Logger } from '@nestjs/common';

import type { AuditDispatcher, AuditEvent } from './audit.types';

/**
 * The M2 stub: audit events go to the log, not to a table.
 *
 * There is no database until M4 and no `audit_logs` table until M28, so
 * the alternative to this is either dropping events silently or blocking
 * every module that mutates anything. Logging keeps the call sites real
 * and the events visible in development.
 *
 * **Not a substitute for M28.** Logs are not queryable by entity, are
 * not retained per DB §7, and are lost on a crash. M28 swaps the
 * provider behind `AUDIT_DISPATCHER`; no call site changes.
 */
@Injectable()
export class LoggingAuditDispatcher implements AuditDispatcher {
  private readonly logger = new Logger('Audit');

  record(event: AuditEvent): Promise<void> {
    // Only the identifying fields are logged, and `metadata` is included
    // because its contract forbids clinical values (see audit.types).
    // The entity *id* is logged; the entity's contents never are.
    this.logger.log({
      audit: {
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        actorId: event.actor.userId,
        actorRole: event.actor.role,
        correlationId: event.correlationId,
        metadata: event.metadata,
        occurredAt: (event.occurredAt ?? new Date()).toISOString(),
      },
    });

    return Promise.resolve();
  }
}
