import { z } from 'zod';

import type { BootstrapDelivery } from '../modules/auth/services/admin-bootstrap.service';

/**
 * Arguments of `npm run admin:bootstrap` (`bootstrap-admin.ts`).
 *
 * Pure, and in its own file, so the rules are tested without booting the
 * application: an unknown flag, a missing address or a missing
 * `--confirm` must stop the command before it touches a database.
 */

export const BOOTSTRAP_USAGE = [
  'Usage: npm run admin:bootstrap -- --email <address> --confirm [--print-link] [--reissue]',
  '',
  'Issues the single invitation that creates the first administrator of this',
  'deployment. Refuses if an administrator already exists.',
  '',
  '  --email <address>  The administrator-to-be. The invitation is sent here.',
  '  --confirm          Required. Without it the command only explains itself.',
  '  --print-link       Print the acceptance link instead of mailing it. The link',
  '                     is a credential: do not run this where output is logged.',
  '  --reissue          First remove an earlier bootstrap that was accepted but',
  '                     never completed (an INACTIVE account that never signed in).',
].join('\n');

export interface BootstrapArgs {
  readonly email: string;
  readonly delivery: BootstrapDelivery;
  readonly reissue: boolean;
}

export type ParsedBootstrapArgs =
  | { readonly kind: 'run'; readonly args: BootstrapArgs }
  | { readonly kind: 'usage'; readonly problem: string | null };

const emailSchema = z.string().trim().min(1).email().max(160);

export function parseBootstrapArgs(argv: readonly string[]): ParsedBootstrapArgs {
  let email: string | undefined;
  let confirm = false;
  let print = false;
  let reissue = false;

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];

    switch (token) {
      case '--email': {
        const value = argv[index + 1];
        if (value === undefined || value.startsWith('--')) {
          return { kind: 'usage', problem: '--email needs an address' };
        }
        email = value;
        index++;
        break;
      }
      case '--confirm':
        confirm = true;
        break;
      case '--print-link':
        print = true;
        break;
      case '--reissue':
        reissue = true;
        break;
      case '--help':
      case '-h':
        return { kind: 'usage', problem: null };
      default:
        return { kind: 'usage', problem: `Unknown argument: ${String(token)}` };
    }
  }

  if (email === undefined) return { kind: 'usage', problem: '--email is required' };

  const parsed = emailSchema.safeParse(email);
  if (!parsed.success) return { kind: 'usage', problem: `Not an email address: ${email}` };

  if (!confirm) {
    return {
      kind: 'usage',
      problem: `Nothing was done. Rerun with --confirm to invite ${parsed.data} as the first administrator.`,
    };
  }

  return {
    kind: 'run',
    args: { email: parsed.data, delivery: print ? 'print' : 'email', reissue },
  };
}
