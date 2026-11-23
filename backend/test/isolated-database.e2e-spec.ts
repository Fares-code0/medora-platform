/**
 * The stale-database sweep of test/support/isolated-database.ts, on a real
 * PostgreSQL 16: which leftover databases it selects and drops.
 *
 * `LIKE` treats `_` as a single-character wildcard, so an unescaped stem
 * `medora_test_isotest_%` would also match the decoys below. Every database
 * created here uses the test-only `isotest` stem (no other spec uses it) and
 * is dropped in `afterAll`.
 */

import { randomUUID } from 'node:crypto';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { dropStaleDatabases, findStaleDatabases, stalePattern } from './support/isolated-database';

const rawDatabaseUrl = process.env['DATABASE_URL'] ?? '';
if (new URL(rawDatabaseUrl).pathname !== '/medora_test' || process.env['APP_ENV'] !== 'test') {
  throw new Error('Refusing isolated-database tests outside the disposable medora_test database.');
}

const PREFIX = 'isotest';
const tag = randomUUID().replaceAll('-', '').slice(0, 10);
const staleExact = [`medora_test_isotest_${tag}a`, `medora_test_isotest_${tag}b`];
const live = `medora_test_isotest_${tag}live`;
const decoys = [
  // Another prefix that begins with the same letters.
  `medora_test_isotestother_${tag}`,
  // Every underscore of the stem replaced by another character.
  `medoraxtestxisotestx${tag}`,
  // The stem without its trailing separator.
  `medora_test_isotest${tag}`,
];
const created = [...staleExact, live, ...decoys];

function urlFor(name: string): string {
  const url = new URL(rawDatabaseUrl);
  url.pathname = `/${name}`;
  return url.toString();
}

const admin = new Client({ connectionString: rawDatabaseUrl });
let liveSession: Client | undefined;

async function existing(): Promise<string[]> {
  const rows = await admin.query<{ datname: string }>(
    'SELECT datname FROM pg_database WHERE datname = ANY($1::text[]) ORDER BY datname',
    [created],
  );
  return rows.rows.map((row) => row.datname);
}

beforeAll(async () => {
  await admin.connect();
  for (const name of created) await admin.query(`CREATE DATABASE "${name}"`);
  liveSession = new Client({ connectionString: urlFor(live) });
  await liveSession.connect();
}, 60_000);

afterAll(async () => {
  try {
    await liveSession?.end();
  } finally {
    for (const name of created) await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    const left = await existing();
    await admin.end();
    expect(left).toEqual([]);
  }
}, 60_000);

describe('isolated-database stale sweep', () => {
  it('escapes every underscore of the stem', () => {
    expect(stalePattern(PREFIX)).toBe('medora\\_test\\_isotest\\_%');
  });

  it('the decoys would match an unescaped pattern (the escaping is what excludes them)', async () => {
    for (const name of decoys.slice(0, 2)) {
      const unescaped = await admin.query<{ hit: boolean }>(
        "SELECT $1::text LIKE 'medora_test_isotest_%' AS hit",
        [name],
      );
      expect(unescaped.rows[0]?.hit, name).toBe(true);
    }
  });

  it('selects stale databases with the exact prefix, never another prefix or one with a session', async () => {
    const stale = await findStaleDatabases(admin, PREFIX);
    for (const name of staleExact) expect(stale).toContain(name);
    for (const name of decoys) expect(stale).not.toContain(name);
    expect(stale).not.toContain(live);
  });

  it('drops only those: other prefixes and the database with a session survive', async () => {
    const dropped = await dropStaleDatabases(admin, PREFIX);
    expect([...dropped].sort()).toEqual(expect.arrayContaining([...staleExact].sort()));
    for (const name of [...decoys, live]) expect(dropped).not.toContain(name);
    expect(await existing()).toEqual([...decoys, live].sort());
  });

  it('a database becomes stale only once its last session has gone', async () => {
    expect(await findStaleDatabases(admin, PREFIX)).not.toContain(live);
    await liveSession?.end();
    liveSession = undefined;
    // The backend's exit is asynchronous; pg_stat_activity drops the row once it has.
    let stale: string[] = [];
    for (let attempt = 0; attempt < 50; attempt += 1) {
      stale = await findStaleDatabases(admin, PREFIX);
      if (stale.includes(live)) break;
      await new Promise((done) => setTimeout(done, 100));
    }
    expect(stale).toContain(live);
  });
});
