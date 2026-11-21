#!/usr/bin/env node
/**
 * Counts FRONTEND_CHECKLIST.md §13's master task register by status.
 *
 * §13.1's totals were counted by a script that never reached the repository,
 * and one revision was counted by hand. This is that count, kept: every table
 * row in §13.2–§13.5 counts once, by the *last* status named in its status
 * cell (the third column, "Before → After"). §13.6's multi-hospital rows are
 * not in those tables and are not counted, as §13.1 says.
 *
 * Run: node scripts/count-checklist-register.mjs        (totals)
 *      node scripts/count-checklist-register.mjs --rows (one line per row)
 */
import { readFileSync } from 'node:fs';

const FILE = new URL('../FRONTEND_CHECKLIST.md', import.meta.url);

const STATUSES = [
  'COMPLETE_VERIFIED',
  'IMPLEMENTED_UNVERIFIED',
  'PARTIAL',
  'MOCK_ONLY',
  'BLOCKED_BACKEND',
  'BLOCKED_DECISION',
  'NOT_STARTED',
  'DEFERRED',
];
const COUNTED = new Set(['13.2', '13.3', '13.4', '13.5']);

const rows = [];
let section = null;
for (const line of readFileSync(FILE, 'utf8').split('\n')) {
  const heading = /^### (13\.\d+)/.exec(line);
  if (heading) {
    section = heading[1];
    continue;
  }
  if (line.startsWith('## ')) section = null;
  if (!COUNTED.has(section) || !line.startsWith('| ')) continue;
  if (line.startsWith('| ID') || line.startsWith('| ---')) continue;

  const cells = line
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim());
  let last = null;
  let at = -1;
  for (const status of STATUSES) {
    for (const match of cells[2].matchAll(new RegExp(`\\b${status}\\b`, 'g'))) {
      if (match.index > at) [at, last] = [match.index, status];
    }
  }
  rows.push({ section, id: cells[0], status: last });
}

const unclassified = rows.filter((row) => row.status === null);
if (process.argv.includes('--rows')) {
  for (const row of rows) console.log(`${row.section} | ${row.id} | ${row.status ?? '—'}`);
}
for (const status of STATUSES) {
  console.log(`${status.padEnd(24)}${rows.filter((row) => row.status === status).length}`);
}
console.log(`${'Rows'.padEnd(24)}${rows.length}`);
if (unclassified.length > 0) {
  console.error(`No status found in: ${unclassified.map((row) => row.id).join(', ')}`);
  process.exit(1);
}
