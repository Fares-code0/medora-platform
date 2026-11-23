import 'dotenv/config';

import { Client } from 'pg';

import { assertApplyPermitted, runLegacyAssignmentBackfill } from './legacy-assignment-ownership';

/**
 * CLI for the legacy assignment ownership backfill (S2). Dry run by default:
 *
 *   npm --prefix backend run db:backfill:assignments              # report only
 *   npm --prefix backend run db:backfill:assignments -- --apply   # write proven rows
 *
 * The JSON report goes to stdout; a one-line summary to stderr. `--apply` is
 * refused for `APP_ENV=production` before any connection is opened. Running
 * it against any real environment requires the #17 owner decision
 * (docs/multi-hospital/LEGACY_OWNERSHIP_BACKFILL.md).
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const unknown = args.filter((arg) => arg !== '--apply');
  if (unknown.length > 0) throw new Error(`Unknown argument(s): ${unknown.join(' ')}`);
  const apply = args.includes('--apply');
  const appEnv = process.env['APP_ENV'];
  if (apply) assertApplyPermitted(appEnv);

  const connectionString = process.env['DATABASE_URL'];
  if (connectionString === undefined || connectionString.length === 0) {
    throw new Error('DATABASE_URL is not set — copy backend/.env.example to backend/.env');
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const report = await runLegacyAssignmentBackfill(client, { apply, appEnv });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    const counts = Object.entries(report.counts)
      .map(([name, n]) => `${name}=${n}`)
      .join(' ');
    console.error(
      `[${report.mode}] ${report.database}: ${report.candidates} unowned assignment(s); ${counts}; rows updated: ${report.rowsUpdated}`,
    );
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error('Legacy assignment ownership backfill failed:', error);
  process.exitCode = 1;
});
