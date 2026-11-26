import { PrismaPg } from '@prisma/adapter-pg';
import type { PoolConfig } from 'pg';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { PrismaClient } from '../../generated/prisma/client';
import { ConfigService } from '../../config';

import { tenantAwareFactory } from './tenant-context.adapter';
import { bypassReasons, ROLE_FACTS_SQL, type RoleFacts } from './runtime-role.check';
import { type SoftDeletedClient, withSoftDelete } from './soft-delete';

/**
 * OPS-03 — the `pg` pool configuration. `statement_timeout` and
 * `idle_in_transaction_session_timeout` are node-postgres client options sent
 * as startup parameters, so they are session defaults for every pooled
 * connection; transaction-local `set_config(..., true)` overrides still win.
 */
export function pgPoolConfig(
  env: Pick<
    ConfigService['env'],
    | 'DATABASE_URL'
    | 'DATABASE_POOL_MAX'
    | 'DATABASE_CONNECTION_TIMEOUT_MS'
    | 'DATABASE_IDLE_TIMEOUT_MS'
    | 'DATABASE_STATEMENT_TIMEOUT_MS'
    | 'DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS'
  >,
): PoolConfig {
  return {
    connectionString: env.DATABASE_URL,
    max: env.DATABASE_POOL_MAX,
    connectionTimeoutMillis: env.DATABASE_CONNECTION_TIMEOUT_MS,
    idleTimeoutMillis: env.DATABASE_IDLE_TIMEOUT_MS,
    statement_timeout: env.DATABASE_STATEMENT_TIMEOUT_MS,
    idle_in_transaction_session_timeout: env.DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  };
}

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

  constructor(private readonly config: ConfigService) {
    const adapter = new PrismaPg(pgPoolConfig(config.env));
    // §2.15: with tenant context on, every transaction opens with the
    // request's transaction-local RLS settings (tenant-context.adapter.ts).
    super({ adapter: config.env.DATABASE_TENANT_CONTEXT ? tenantAwareFactory(adapter) : adapter });
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
    await this.checkRuntimeRole();
  }

  /**
   * Nest calls this on SIGTERM because `main.ts` enables shutdown hooks.
   * Without it, in-flight queries are cut off mid-transaction on every
   * deploy.
   */
  /**
   * Refuses to serve production on a role that bypasses Row-Level Security
   * (see `runtime-role.check.ts`).
   */
  private async checkRuntimeRole(): Promise<void> {
    const [facts] = await this.$queryRawUnsafe<RoleFacts[]>(ROLE_FACTS_SQL);
    if (facts === undefined) throw new Error('Could not read the database role');
    const reasons = bypassReasons(facts);
    if (reasons.length === 0) return;
    const message = `Database role "${facts.role}" bypasses Row-Level Security: it ${reasons.join(', ')}`;
    if (this.config.isProduction) {
      throw new Error(`${message}. Connect as the provisioned runtime role (prisma/roles/provision-runtime-role.sql).`);
    }
    this.logger.warn(`${message} (allowed outside production)`);
  }

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
