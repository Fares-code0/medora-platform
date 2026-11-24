import 'dotenv/config';

import { Client } from 'pg';

import {
  assertApplyPermitted,
  runPlatformAdminDesignation,
  validateRequest,
  type DesignationRequest,
} from './platform-admin-designation';

/**
 * CLI: mark ONE named account as Platform Admin (S5; OD-07, M-13). Dry run
 * by default:
 *
 *   npm --prefix backend run db:reconcile:platform-admin -- \
 *     --email ops.lead@example.org --reason "M-13 mapping list #4"            # report only
 *   npm --prefix backend run db:reconcile:platform-admin -- \
 *     --email ops.lead@example.org --reason "M-13 mapping list #4" --apply    # write the grant
 *
 * Optional: `--granted-by <email>` records the approving administrator.
 * There is no bulk form: one invocation, one account, one reviewed reason.
 * `--apply` is refused for APP_ENV=production before any connection opens.
 */
function parse(args: readonly string[]): { request: DesignationRequest; apply: boolean } {
  let email: string | undefined;
  let reason: string | undefined;
  let grantedByEmail: string | undefined;
  let apply = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const value = (): string => {
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error(`${arg} needs a value`);
      i += 1;
      return next;
    };
    if (arg === '--apply') apply = true;
    else if (arg === '--email') email = value();
    else if (arg === '--reason') reason = value();
    else if (arg === '--granted-by') grantedByEmail = value();
    else throw new Error(`Unknown argument: ${String(arg)}`);
  }

  if (email === undefined) throw new Error('--email is required');
  if (reason === undefined) throw new Error('--reason is required');
  const request: DesignationRequest = { email, reason, grantedByEmail };
  validateRequest(request);
  return { request, apply };
}

async function main(): Promise<void> {
  const { request, apply } = parse(process.argv.slice(2));
  const appEnv = process.env['APP_ENV'];
  if (apply) assertApplyPermitted(appEnv);

  const connectionString = process.env['DATABASE_URL'];
  if (connectionString === undefined || connectionString.length === 0) {
    throw new Error('DATABASE_URL is not set — copy backend/.env.example to backend/.env');
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    const report = await runPlatformAdminDesignation(client, request, { apply, appEnv });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    console.error(`[${report.mode}] ${report.database}: ${report.email} → ${report.verdict}`);
    if (report.verdict !== 'would_grant' && report.verdict !== 'granted') process.exitCode = 2;
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  console.error('Platform Admin designation failed:', error);
  process.exitCode = 1;
});
