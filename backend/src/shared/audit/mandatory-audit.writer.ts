/**
 * Mandatory audit of a disclosure that is not inside a write transaction:
 * a PHI read, a download, an export (multi-hospital §2.13; audit F-02).
 *
 * `AUDIT_DISPATCHER` is best-effort by contract — it logs and swallows a
 * failed insert so the ledger never becomes an availability dependency of
 * clinical *work*. A *disclosure* is the opposite case: an unrecorded read
 * of protected data is the failure. So mandatory events go through the same
 * throwing writer the in-transaction disclosures use
 * (`TransactionalAuditWriter.recordWithin`), on the request's own
 * connection: the row is written before the response is released, and a
 * failure is a 503 `audit_unavailable` with nothing disclosed.
 *
 * Use it only where the event *is* the authorization record of a disclosure;
 * informational events stay on `AUDIT_DISPATCHER`.
 */

import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../database';
import { currentAuditAttribution } from './audit-attribution';
import type { AuditEvent } from './audit.types';
import { TransactionalAuditWriter } from './transactional-audit.writer';

@Injectable()
export class MandatoryAuditWriter {
  constructor(
    private readonly prisma: PrismaService,
    private readonly writer: TransactionalAuditWriter,
  ) {}

  /** Writes the event or throws 503 `audit_unavailable`. */
  async record(event: AuditEvent): Promise<void> {
    await this.writer.recordWithin(this.prisma, this.attributed(event));
  }

  /**
   * Writes the event on the caller's transaction, so it commits or rolls
   * back with the change it records (L1: a patient's registration and its
   * ownership evidence). Throws, like `record`.
   */
  async recordIn(tx: Prisma.TransactionClient, event: AuditEvent): Promise<void> {
    await this.writer.recordWithin(tx, this.attributed(event));
  }

  private attributed(event: AuditEvent): AuditEvent {
    const attribution = currentAuditAttribution();
    const attributed: AuditEvent =
      attribution === undefined
        ? event
        : {
            ...event,
            hospitalId: event.hospitalId === undefined ? attribution.hospitalId : event.hospitalId,
            actor:
              event.actor.sessionId === undefined && attribution.sessionId !== undefined
                ? { ...event.actor, sessionId: attribution.sessionId }
                : event.actor,
          };
    return attributed;
  }
}
