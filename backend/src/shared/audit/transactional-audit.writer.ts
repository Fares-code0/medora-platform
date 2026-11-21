import { HttpStatus, Injectable, Logger } from '@nestjs/common';

import { AppException } from '../../common/errors/app.exception';
import { describeError } from '../../common/logging/error-description';
import type { Prisma } from '../../generated/prisma/client';

import { auditRowOf } from './audit-row';
import type { AuditEvent } from './audit.types';

/**
 * The audit write a disclosure is conditional on (RM M7.3, ADR-006 §5).
 *
 * ## Why a second writer, and why it is not the dispatcher
 *
 * `AuditDispatcher.record()` never throws and writes on its own
 * connection. That is right for the seventy-odd call sites that record a
 * *mutation* — a clinician must not be stopped signing a prescription
 * because the ledger is unreachable (RA-M28.2). It is wrong for the few
 * places where the thing being audited is a **disclosure**: an identity
 * reveal (API §4.9: "atomically audit-logged") and an administrator
 * reading message content (ADR-006 §5: "if the audit write fails, no
 * content is returned"). There, an unlogged success is the failure.
 *
 * So this writer does the opposite of the dispatcher on both counts. It
 * writes **on the caller's transaction**, so the row commits with the read
 * or not at all, and it **throws**, so a failed insert aborts that
 * transaction and the caller returns an error instead of the data.
 *
 * It does not replace the dispatcher anywhere else. Moving a mutation onto
 * it would turn the ledger into an availability dependency of clinical
 * work, which `audit.types` rejected at M2.
 *
 * ## Still one ledger, still INSERT-only
 *
 * The row is built by the same `auditRowOf` the dispatcher uses, so an
 * event files identically through either writer. There is one method and
 * it creates; `transactional-audit.writer.spec.ts` holds this file to the
 * same no-mutation-verb rule as the dispatcher.
 */
@Injectable()
export class TransactionalAuditWriter {
  private readonly logger = new Logger('Audit');

  /**
   * Inserts the event on `tx`, or throws a 503 `audit_unavailable`.
   *
   * The caller lets the exception propagate out of its `$transaction`
   * callback, which rolls the unit back, and the client receives the 503
   * instead of the data. The provider's own error is logged and never
   * reaches the response — it names the database, not the request.
   */
  async recordWithin(tx: Prisma.TransactionClient, event: AuditEvent): Promise<void> {
    try {
      await tx.auditEvent.create({ data: auditRowOf(event) });
    } catch (error) {
      this.logger.error(
        { err: describeError(error), action: event.action, entityId: event.entityId },
        'Audit event could not be written; the disclosure it covers was refused',
      );

      throw new AppException(HttpStatus.SERVICE_UNAVAILABLE, {
        message: 'This access could not be recorded, so nothing was disclosed',
        code: 'audit_unavailable',
      });
    }
  }
}
