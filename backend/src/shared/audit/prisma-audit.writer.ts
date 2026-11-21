import { Injectable, Logger } from '@nestjs/common';

import { describeError } from '../../common/logging/error-description';

import { PrismaService } from '../database';

import { auditRowOf } from './audit-row';
import { classify } from './audit-taxonomy';
import type { AuditDispatcher, AuditEvent } from './audit.types';

/**
 * The durable audit ledger (RM M28.1, API §14).
 *
 * > ✅ Verify: no update/delete method exists; DB role lacks
 * > UPDATE/DELETE on audit_events.
 *
 * ## INSERT-only, and the class is the proof
 *
 * There is one method. `AuditDispatcher` declares one. Nothing here
 * reaches `update`, `updateMany`, `delete`, `deleteMany` or `upsert` on
 * `auditEvent`, and `prisma-audit.writer.spec.ts` asserts that by reading
 * this file — a reviewer should not have to take it on trust, and a
 * future edit that added a correction path should fail a test rather than
 * pass review.
 *
 * Retention removes events by **dropping whole monthly partitions**
 * (ADR-007 R2, M28.5), never by deleting rows, which is why an
 * INSERT-only writer is sufficient rather than merely tidy.
 *
 * ## It never throws, and that is the M2 contract kept
 *
 * `record()` resolves even when the insert fails. `audit.types` fixed that
 * at M2 and the reason has not changed: an audit sink that can fail a
 * clinical write turns an observability dependency into an availability
 * one — a doctor unable to sign a prescription because the ledger was
 * unreachable is a worse outcome than a missing ledger row, and the
 * failure is logged at error level so it is not silent.
 *
 * ⚠️ **This is best-effort, not transactional.** M28's own description
 * imagines "an outbox row in the mutation's transaction", which needs the
 * caller's transaction handle — a change to the `AuditDispatcher`
 * signature and therefore to seventy call sites. Recorded as
 * **RA-M28.2** rather than half-built: what exists is durable storage
 * with a logged gap, not an exactly-once guarantee. The few call sites
 * where the audited thing is a *disclosure* rather than a mutation use
 * `TransactionalAuditWriter` instead, which writes on their transaction
 * and throws.
 *
 * ## What the caller does not have to say
 *
 * Category, severity and the human summary are derived from the action
 * (`audit-taxonomy.ts`), so no call site changed when this replaced the
 * logging stub. That was the promise `audit.types` made at M2.
 */
@Injectable()
export class PrismaAuditWriter implements AuditDispatcher {
  private readonly logger = new Logger('Audit');

  constructor(private readonly prisma: PrismaService) {}

  async record(event: AuditEvent): Promise<void> {
    const { unclassified } = classify(event.action);

    if (unclassified) {
      // Never silent. `audit-taxonomy.spec.ts` asserts no action the
      // codebase emits reaches here, so this firing means a new module
      // skipped the taxonomy — and the row it just filed under `system`
      // will be invisible to an investigator's category filter.
      this.logger.warn(
        { action: event.action },
        'Audit action has no category; filed as system',
      );
    }

    try {
      await this.prisma.auditEvent.create({ data: auditRowOf(event) });
    } catch (error) {
      // Logged with the action and the target so the lost row is
      // reconstructible from the log, which is the only mitigation a
      // best-effort writer can offer.
      this.logger.error(
        { err: describeError(error), action: event.action, entityId: event.entityId },
        'Audit event could not be written',
      );
    }
  }
}
