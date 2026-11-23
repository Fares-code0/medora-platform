import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import { Client } from 'pg';

/**
 * A throwaway PostgreSQL database for one spec file, built the way CI builds
 * `medora_test`: an empty database, `prisma migrate deploy`, then the seed.
 *
 * Why it exists: the RLS-proposal and role-separation specs execute
 * `ALTER TABLE … ENABLE ROW LEVEL SECURITY` on 68 real tables inside a
 * transaction. Each statement takes an ACCESS EXCLUSIVE lock that is held
 * until the rollback, so on the shared `medora_test` those locks interleaved
 * with row locks taken by spec files running in parallel and PostgreSQL
 * aborted one side with `deadlock detected`. Locks never cross databases, so
 * running those specs in their own database removes the contention instead
 * of serialising the suite.
 *
 * Why not `CREATE DATABASE … TEMPLATE medora_test`: PostgreSQL refuses to
 * copy a template while any other session is connected to it (it waits about
 * five seconds, then fails with "source database is being accessed by other
 * users"), and parallel spec files are always connected to `medora_test`.
 * The default template (`template1`) has no clients, so a plain
 * `CREATE DATABASE` is safe to run from several workers at once.
 *
 * The caller keeps its own guard on the shared `DATABASE_URL` (the database
 * must be the disposable `medora_test`); this helper only creates siblings
 * named `medora_test_<prefix>_<random>` on the same server, as the same role,
 * and refuses any other prefix shape. It never touches `medora_test` itself.
 */

const execFileAsync = promisify(execFile);
const BACKEND = resolve(__dirname, '../..');
const PREFIX_SHAPE = /^[a-z][a-z0-9]{1,15}$/;

export interface IsolatedDatabase {
  /** Connection string for the throwaway database. */
  readonly url: string;
  /** Its name, for identity checks (`current_database()`). */
  readonly name: string;
  /**
   * Drops it (`WITH (FORCE)`). Idempotent once it has succeeded; a failed
   * drop is not remembered as done, so it can be retried.
   */
  drop(): Promise<void>;
}

function withDatabase(base: string, name: string): string {
  const url = new URL(base);
  url.pathname = `/${name}`;
  return url.toString();
}

async function onServer<T>(base: string, work: (admin: Client) => Promise<T>): Promise<T> {
  // Administrative statements run from the shared database's connection
  // string: CREATE/DROP DATABASE never lock the database they are issued from.
  const admin = new Client({ connectionString: base });
  await admin.connect();
  try {
    return await work(admin);
  } finally {
    await admin.end();
  }
}

/** Name stem shared by every isolated database of one prefix. */
function familyOf(prefix: string): string {
  if (!PREFIX_SHAPE.test(prefix)) throw new Error(`Invalid isolated-database prefix: ${prefix}`);
  return `medora_test_${prefix}_`;
}

/**
 * The `LIKE` pattern for one prefix's databases. `_` is a single-character
 * wildcard in `LIKE`, so every underscore of the stem is escaped with the
 * default escape character (backslash): `medora_test_roles_%` would otherwise
 * also match `medoraXtestXrolesX…` or `medora_test_rolesextra_…`. The prefix
 * shape admits no `%`, `_` or backslash of its own.
 */
export function stalePattern(prefix: string): string {
  return familyOf(prefix).replaceAll('_', '\\_') + '%';
}

/**
 * Databases of this prefix left by an interrupted run: exact stem match, and
 * no session connected (another process may be using one right now).
 */
export async function findStaleDatabases(admin: Client, prefix: string): Promise<string[]> {
  const stale = await admin.query<{ datname: string }>(
    `SELECT d.datname FROM pg_database d
      WHERE d.datname LIKE $1
        AND NOT EXISTS (SELECT 1 FROM pg_stat_activity a WHERE a.datname = d.datname)
      ORDER BY d.datname`,
    [stalePattern(prefix)],
  );
  return stale.rows.map((row) => row.datname);
}

/**
 * Drops {@link findStaleDatabases}' result without `FORCE`: if a session
 * connects between the check and the drop, PostgreSQL refuses the drop
 * (`55006`, object in use) and the database is left alone. Returns the names
 * actually dropped.
 */
export async function dropStaleDatabases(admin: Client, prefix: string): Promise<string[]> {
  const dropped: string[] = [];
  for (const name of await findStaleDatabases(admin, prefix)) {
    try {
      await admin.query(`DROP DATABASE IF EXISTS "${name}"`);
      dropped.push(name);
    } catch (error) {
      if ((error as { code?: unknown }).code !== '55006') throw error;
    }
  }
  return dropped;
}

/**
 * Teardown for a spec: closes its client, then drops its isolated database
 * even when closing failed. Both failures are reported, never swallowed.
 */
export async function closeThenDrop(
  client: { end(): Promise<void> } | undefined,
  isolated: IsolatedDatabase | undefined,
): Promise<void> {
  const errors: unknown[] = [];
  try {
    await client?.end();
  } catch (error) {
    errors.push(error);
  }
  try {
    await isolated?.drop();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(
      errors,
      'Closing the client and dropping the isolated database both failed',
    );
  }
}

export async function createIsolatedDatabase(
  sharedUrl: string,
  prefix: string,
): Promise<IsolatedDatabase> {
  const family = familyOf(prefix);
  if (new URL(sharedUrl).pathname !== '/medora_test') {
    throw new Error('Isolated databases are only created next to the disposable medora_test.');
  }
  const name = family + randomUUID().replaceAll('-', '').slice(0, 12);
  const url = withDatabase(sharedUrl, name);

  await onServer(sharedUrl, async (admin) => {
    await dropStaleDatabases(admin, prefix);
    await admin.query(`CREATE DATABASE "${name}"`);
  });

  let dropped = false;
  const drop = async (): Promise<void> => {
    if (dropped) return;
    await onServer(sharedUrl, (admin) =>
      admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`),
    );
    // Only after the drop succeeded: a failed drop stays retryable.
    dropped = true;
  };

  try {
    const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: url };
    // Nothing reads this database through the API's Redis cache, so the
    // seed's reference-cache bump (prisma/seed/cache-bust.ts) must not reach
    // the cache the parallel specs share: send it to an unused logical
    // database on the same server (the environment schema requires a URL).
    if (process.env['REDIS_URL']) {
      const redis = new URL(process.env['REDIS_URL']);
      redis.pathname = '/15';
      env['REDIS_URL'] = redis.toString();
    }
    // `migrate deploy`, as CI and production run it: committed migrations only.
    await execFileAsync('npx', ['prisma', 'migrate', 'deploy'], { cwd: BACKEND, env });
    // The same seed CI runs on medora_test (reference rows the specs read).
    await execFileAsync('npx', ['tsx', 'prisma/seed.ts'], { cwd: BACKEND, env });
  } catch (error) {
    await drop();
    throw error;
  }

  return { url, name, drop };
}
