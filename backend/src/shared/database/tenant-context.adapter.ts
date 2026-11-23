/**
 * Wraps the PostgreSQL driver adapter so that every transaction carries the
 * current tenant context (see `tenant-context.ts`).
 *
 * - `startTransaction` (interactive and batch transactions): the context is
 *   applied as the transaction's first statement.
 * - `queryRaw` / `executeRaw` outside a transaction: with a context, the
 *   statement runs inside its own short transaction, opened with the
 *   context, so `SET LOCAL` semantics hold and nothing outlives it.
 *
 * Without a context the adapter is a pass-through.
 */

import type { PrismaPg } from '@prisma/adapter-pg';

import { currentTenantContext, TENANT_SETTINGS_SQL, tenantSettings, type TenantContext } from './tenant-context';

type Adapter = Awaited<ReturnType<PrismaPg['connect']>>;
type Transaction = Awaited<ReturnType<Adapter['startTransaction']>>;
type Query = Parameters<Adapter['queryRaw']>[0];

const STRING = { scalarType: 'string', arity: 'scalar' } as const;

const statement = (sql: 'COMMIT' | 'ROLLBACK'): Query => ({ sql, args: [], argTypes: [] });

async function applyContext(tx: Transaction, context: TenantContext): Promise<void> {
  await tx.queryRaw({
    sql: TENANT_SETTINGS_SQL,
    args: tenantSettings(context),
    argTypes: [STRING, STRING, STRING, STRING],
  });
}

async function inContextTransaction<T>(
  adapter: Adapter,
  context: TenantContext,
  work: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const tx = await adapter.startTransaction();
  // `adapter-pg` sends BEGIN itself, but its `commit()` / `rollback()` only
  // release the connection: ending the transaction is the query engine's
  // job, done with a statement. This wrapper owns these short transactions,
  // so it sends COMMIT / ROLLBACK itself — otherwise the connection would
  // return to the pool mid-transaction, still carrying the context.
  try {
    await applyContext(tx, context);
    const result = await work(tx);
    await tx.executeRaw(statement('COMMIT'));
    await tx.commit();
    return result;
  } catch (error) {
    await tx.executeRaw(statement('ROLLBACK')).catch(() => undefined);
    await tx.rollback().catch(() => undefined);
    throw error;
  }
}

export function withTenantContext(adapter: Adapter): Adapter {
  return new Proxy(adapter, {
    get(target, property, receiver) {
      if (property === 'queryRaw') {
        return (query: Query) => {
          const context = currentTenantContext();
          return context === undefined
            ? target.queryRaw(query)
            : inContextTransaction(target, context, (tx) => tx.queryRaw(query));
        };
      }
      if (property === 'executeRaw') {
        return (query: Query) => {
          const context = currentTenantContext();
          return context === undefined
            ? target.executeRaw(query)
            : inContextTransaction(target, context, (tx) => tx.executeRaw(query));
        };
      }
      if (property === 'startTransaction') {
        return async (...args: Parameters<Adapter['startTransaction']>) => {
          const tx = await target.startTransaction(...args);
          const context = currentTenantContext();
          if (context !== undefined) await applyContext(tx, context);
          return tx;
        };
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/** A `PrismaPg` factory whose adapters carry the tenant context. */
export function tenantAwareFactory(factory: PrismaPg): PrismaPg {
  return new Proxy(factory, {
    get(target, property, receiver) {
      if (property === 'connect') {
        return async () => withTenantContext(await target.connect());
      }
      const value: unknown = Reflect.get(target, property, receiver);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}
