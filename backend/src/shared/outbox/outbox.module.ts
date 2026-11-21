import { Module } from '@nestjs/common';

import { DatabaseModule } from '../database';

import { PrismaOutbox } from './prisma-outbox';
import { OUTBOX } from './outbox.types';

/**
 * Binds `OUTBOX` to the durable writer (RM M19.1).
 *
 * This is the provider swap ADR-019 §1 was designed around: eighteen
 * modules were written against the token from their first line, so
 * replacing the M2 stub with a table-backed writer touched no call site.
 * M30.1 adds the drain on the other side of the same table.
 */
@Module({
  imports: [DatabaseModule],
  providers: [{ provide: OUTBOX, useClass: PrismaOutbox }],
  exports: [OUTBOX],
})
export class OutboxKernelModule {}
