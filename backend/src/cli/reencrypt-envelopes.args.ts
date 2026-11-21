/**
 * Arguments of `npm run crypto:reencrypt` (`reencrypt-envelopes.ts`).
 *
 * Pure, and in its own file, for the reason `bootstrap-admin.args.ts`
 * gives: a typo must stop the command before it touches a database.
 */

export const REENCRYPT_USAGE = [
  'Usage: npm run crypto:reencrypt -- (--dry-run | --confirm | --status) [--batch-size <n>]',
  '',
  'Re-seals every stored envelope (TOTP secrets, recovery codes, integration',
  'credentials) under the current DATA_ENCRYPTION_KEY and verifies them. See',
  'docs/PRODUCTION_SETUP.md §2.1 for the rotation order and its preconditions.',
  '',
  '  --dry-run         Report what would be re-sealed. Writes nothing, and never',
  '                    authorizes retiring a key.',
  '  --confirm         Re-seal, then verify every value. Safe to interrupt',
  '                    (SIGTERM / SIGINT stop it between rows) and to rerun.',
  '  --status          List recent runs from the audit ledger, and any that',
  '                    started but never recorded an outcome.',
  '  --batch-size <n>  Rows read per page (1-5000, default 200).',
  '',
  'Exit codes: 0 verified at the time of the pass (point-in-time) · 1 values',
  'remain, a stale writer was seen, or the run failed part-way · 2 usage ·',
  '3 another re-encryption is running · 4 the audit ledger could not record it',
  '· 5 interrupted by a signal · 6 unsupported connection pooling, nothing done.',
  '--status: 1 a started run has no outcome and no complete run since · 0 otherwise.',
].join('\n');

export interface ReencryptArgs {
  readonly dryRun: boolean;
  readonly batchSize: number | undefined;
}

export type ParsedReencryptArgs =
  | { readonly kind: 'run'; readonly args: ReencryptArgs }
  | { readonly kind: 'status' }
  | { readonly kind: 'usage'; readonly problem: string | null };

const MAX_BATCH_SIZE = 5000;

export function parseReencryptArgs(argv: readonly string[]): ParsedReencryptArgs {
  let dryRun = false;
  let confirm = false;
  let status = false;
  let batchSize: number | undefined;

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];

    switch (token) {
      case '--dry-run':
        dryRun = true;
        break;
      case '--confirm':
        confirm = true;
        break;
      case '--batch-size': {
        const value = argv[index + 1];
        if (value === undefined || !/^\d+$/.test(value)) {
          return { kind: 'usage', problem: '--batch-size needs a whole number' };
        }
        const parsed = Number(value);
        if (parsed < 1 || parsed > MAX_BATCH_SIZE) {
          return {
            kind: 'usage',
            problem: `--batch-size must be between 1 and ${String(MAX_BATCH_SIZE)}`,
          };
        }
        batchSize = parsed;
        index++;
        break;
      }
      case '--status':
        status = true;
        break;
      case '--help':
      case '-h':
        return { kind: 'usage', problem: null };
      default:
        return { kind: 'usage', problem: `Unknown argument: ${String(token)}` };
    }
  }

  if (status) {
    return dryRun || confirm || batchSize !== undefined
      ? { kind: 'usage', problem: '--status takes no other option.' }
      : { kind: 'status' };
  }

  if (dryRun && confirm) {
    return { kind: 'usage', problem: 'Choose one of --dry-run and --confirm, not both.' };
  }

  if (!dryRun && !confirm) {
    return {
      kind: 'usage',
      problem:
        'Nothing was done. Rerun with --dry-run to see what would be re-sealed, or --confirm to re-seal.',
    };
  }

  return { kind: 'run', args: { dryRun, batchSize } };
}
