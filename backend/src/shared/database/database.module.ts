import { Module } from '@nestjs/common';

import { PrismaService } from './prisma.service';

/**
 * Database access (RM M4).
 *
 * Exported through `SharedKernelModule`, which is `@Global` — so every
 * repository from M8 onward injects `PrismaService` without listing an
 * import, exactly like the audit and outbox tokens (ADR-019 §3).
 */
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
