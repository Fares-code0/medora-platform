/**
 * The RLS coverage inventory (docs/multi-hospital/RLS_DESIGN.md, Appendix A)
 * must list every table in the PostgreSQL catalog exactly once. A new table
 * that nobody classified, a dropped table still listed, or a duplicate row
 * fails here — so the inventory cannot silently go stale.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const rawDatabaseUrl = process.env['DATABASE_URL'] ?? '';
if (new URL(rawDatabaseUrl).pathname !== '/medora_test' || process.env['APP_ENV'] !== 'test') {
  throw new Error('Refusing the RLS inventory test outside the disposable medora_test database.');
}

const CLASSES = ['Direct', 'Indirect', 'Global/reference', 'Internal/system', 'Unresolved'] as const;
const client = new Client({ connectionString: rawDatabaseUrl });

function inventory(): { table: string; cls: string; policy: string }[] {
  const doc = readFileSync(resolve(__dirname, '../../docs/multi-hospital/RLS_DESIGN.md'), 'utf8');
  const appendix = doc.slice(doc.indexOf('## Appendix A'));
  return appendix
    .split('\n')
    .filter((line) => line.startsWith('| `'))
    .map((line) => {
      const cells = line.split(' | ');
      return {
        table: cells[0]!.replace(/^\| `|`$/g, ''),
        cls: cells[1]!,
        policy: cells[7]!.replace(/ \|$/, ''),
      };
    });
}

beforeAll(async () => {
  await client.connect();
});

afterAll(async () => {
  await client.end();
});

describe('RLS coverage inventory (Appendix A)', () => {
  it('lists every catalog table exactly once, and nothing else', async () => {
    const catalog = (
      await client.query<{ relname: string }>(
        "SELECT c.relname FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p') AND c.oid NOT IN (SELECT inhrelid FROM pg_inherits) AND c.relname <> '_prisma_migrations' ORDER BY 1",
      )
    ).rows.map((row) => row.relname);
    const listed = inventory().map((row) => row.table);

    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(catalog);
  });

  it('gives every table one of the five classes, and requires a policy for every Direct and Indirect table', () => {
    for (const row of inventory()) {
      expect(CLASSES, row.table).toContain(row.cls);
      if (row.cls === 'Direct' || row.cls === 'Indirect') expect(row.policy, row.table).toBe('Yes');
    }
  });

  it('classifies every table that has a hospital_id column as Direct or Internal/system', async () => {
    const owned = (
      await client.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'hospital_id' ORDER BY 1",
      )
    ).rows.map((row) => row.table_name);
    const cls = new Map(inventory().map((row) => [row.table, row.cls]));
    for (const table of owned.filter((t) => cls.has(t))) {
      expect(['Direct', 'Internal/system'], table).toContain(cls.get(table));
    }
  });
});
