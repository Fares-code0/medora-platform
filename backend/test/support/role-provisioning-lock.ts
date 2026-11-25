/**
 * Serialises, and makes retry-safe, the test suites that provision or drop
 * database roles.
 *
 * The role templates (`prisma/roles/*.sql`) and `DROP OWNED BY` rewrite shared
 * catalog rows — the ACL of every table and audit partition, the maintenance
 * functions' ACLs, the owner's default privileges — whichever role they name.
 * PostgreSQL refuses two concurrent updates of one catalog row with
 * `tuple concurrently updated` (XX000). In production an operator runs a
 * template once; in a parallel test run several files provision at the same
 * moment, and others create and drop audit partitions while a template is
 * granting on them.
 *
 * Two measures, neither of which changes what the templates do:
 *
 * - a session-level advisory lock, taken around the whole provisioning (or the
 *   whole rolled-back transaction that contains it), so provisioning files
 *   take turns;
 * - a bounded retry of the idempotent template on that one transient error, for
 *   collisions with concurrent partition DDL the lock cannot cover. Inside an
 *   open transaction the retry rolls back to a savepoint, so a failed attempt's
 *   partial work never survives into the next.
 */

interface Queryable {
  query(text: string, values?: unknown[]): Promise<unknown>;
}

const KEY = 'medora.test.role_provisioning';
const ATTEMPTS = 5;

export async function withRoleProvisioningLock<T>(client: Queryable, work: () => Promise<T>): Promise<T> {
  await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [KEY]);
  try {
    return await work();
  } finally {
    await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [KEY]);
  }
}

function isConcurrentCatalogUpdate(error: unknown): boolean {
  const { code, message } = error as { code?: string; message?: string };
  return code === 'XX000' && /tuple concurrently (updated|deleted)/.test(message ?? '');
}

/**
 * Runs an idempotent role statement (a template, `DROP OWNED BY`), retrying
 * only on a concurrent catalog update. `inTransaction` wraps each attempt in a
 * savepoint, for callers that hold a transaction open around it.
 */
export async function applyRoleStatement(
  client: Queryable,
  sql: string,
  options: { readonly inTransaction?: boolean } = {},
): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    if (options.inTransaction === true) await client.query('SAVEPOINT role_statement');
    try {
      await client.query(sql);
      if (options.inTransaction === true) await client.query('RELEASE SAVEPOINT role_statement');
      return;
    } catch (error) {
      if (options.inTransaction === true) await client.query('ROLLBACK TO SAVEPOINT role_statement');
      if (!isConcurrentCatalogUpdate(error) || attempt >= ATTEMPTS) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50 * attempt));
    }
  }
}
