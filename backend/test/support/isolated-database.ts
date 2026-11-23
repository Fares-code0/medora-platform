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
  /** Drops it (`WITH (FORCE)`); safe to call more than once. */
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

export async function createIsolatedDatabase(
  sharedUrl: string,
  prefix: string,
): Promise<IsolatedDatabase> {
  if (!PREFIX_SHAPE.test(prefix)) throw new Error(`Invalid isolated-database prefix: ${prefix}`);
  if (new URL(sharedUrl).pathname !== '/medora_test') {
    throw new Error('Isolated databases are only created next to the disposable medora_test.');
  }
  const family = `medora_test_${prefix}_`;
  const name = family + randomUUID().replaceAll('-', '').slice(0, 12);
  const url = withDatabase(sharedUrl, name);

  await onServer(sharedUrl, async (admin) => {
    // Leftovers of this prefix from an interrupted run, but never one that
    // still has a session (another process may be using it right now).
    const stale = await admin.query<{ datname: string }>(
      `SELECT d.datname FROM pg_database d
        WHERE d.datname LIKE $1
          AND NOT EXISTS (SELECT 1 FROM pg_stat_activity a WHERE a.datname = d.datname)`,
      [family.replaceAll('_', '\\_') + '%'],
    );
    for (const row of stale.rows) await admin.query(`DROP DATABASE IF EXISTS "${row.datname}"`);
    await admin.query(`CREATE DATABASE "${name}"`);
  });

  let dropped = false;
  const drop = async (): Promise<void> => {
    if (dropped) return;
    dropped = true;
    await onServer(sharedUrl, (admin) =>
      admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`),
    );
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
