import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database';

import { PrismaAuditWriter } from './prisma-audit.writer';
import { MandatoryAuditWriter } from './mandatory-audit.writer';
import { TransactionalAuditWriter } from './transactional-audit.writer';
import { AUDIT_DISPATCHER } from './audit.types';

/**
 * Binds `AUDIT_DISPATCHER` to the durable ledger (RM M28.1).
 *
 * This provider line is what M2 predicted: "M28 changes `useClass` here
 * and nothing else". Seventy call sites across eighteen modules started
 * writing rows without one of them being edited, which is the return on
 * defining the port before the table existed.
 *
 * `LoggingAuditDispatcher` is kept rather than deleted. It is the honest
 * binding for anything that runs without a database — and it is what
 * `module-graph.e2e-spec.ts` measures the *shape* of the port against.
 *
 * `TransactionalAuditWriter` is exported as a class rather than behind a
 * token: it has one implementation by design (it must write on the
 * caller's Prisma transaction), so a port would abstract over nothing.
 */
@Module({
  imports: [DatabaseModule],
  providers: [
    { provide: AUDIT_DISPATCHER, useClass: PrismaAuditWriter },
    TransactionalAuditWriter,
    MandatoryAuditWriter,
  ],
  exports: [AUDIT_DISPATCHER, TransactionalAuditWriter, MandatoryAuditWriter],
})
export class AuditKernelModule {}
