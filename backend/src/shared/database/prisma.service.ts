import { PrismaPg } from '@prisma/adapter-pg';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { PrismaClient } from '../../generated/prisma/client';
import { ConfigService } from '../../config';

import { type SoftDeletedClient, withSoftDelete } from './soft-delete';

/**
 * The database client (RM M4).
 *
 * Extends `PrismaClient` so transactions, raw queries and lifecycle are
 * available directly, and exposes `db` — the same client wrapped in the
 * soft-delete extension. Repositories use `db`; the few places that
 * legitimately need to see deleted rows use the base client or
 * `INCLUDE_DELETED`.
 *
 * The connection string is passed explicitly from `ConfigService` rather
 * than read from `process.env` by Prisma itself. That keeps ADR-020 §1
 * true — one validated environment, read in one place — and means a
 * malformed `DATABASE_URL` is caught at boot by the Zod contract with a
 * readable message, not by a driver error on the first query.
 *
 * Prisma 7 connects through a **driver adapter** rather than the Rust
 * query engine, so the transport is `pg` — an ordinary Node Postgres
 * pool. That is Prisma 7's required path, not a preference (ADR-021).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  /**
   * The client repositories should use: soft-deleted rows are invisible
   * to it unless asked for explicitly.
   */
  readonly db: SoftDeletedClient;

  constructor(config: ConfigService) {
    super({ adapter: new PrismaPg({ connectionString: config.env.DATABASE_URL }) });
    this.db = withSoftDelete(this);
  }

  /**
   * Connect eagerly at boot rather than lazily on first query. A
   * database that is unreachable should fail the readiness probe
   * immediately, not on whichever request happens to arrive first.
   */
  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connected');
  }

  /**
   * Nest calls this on SIGTERM because `main.ts` enables shutdown hooks.
   * Without it, in-flight queries are cut off mid-transaction on every
   * deploy.
   */
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Cheap liveness probe for the health endpoint. `SELECT 1` and not a
   * table read: this must answer whether the connection works, not
   * whether any particular migration has run.
   */
  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }
}
