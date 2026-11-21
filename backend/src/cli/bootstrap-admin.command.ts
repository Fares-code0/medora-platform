import {
  type AdminBootstrapService,
  BootstrapRefused,
} from '../modules/auth/services/admin-bootstrap.service';

import { BOOTSTRAP_USAGE, parseBootstrapArgs } from './bootstrap-admin.args';

/**
 * The body of `npm run admin:bootstrap`, without the process around it.
 *
 * `bootstrap-admin.ts` owns what only a real process can do — load the
 * environment, boot the application, exit with a code. This owns the rest
 * and takes the application as a function, so the e2e drives the same
 * argument handling, output and exit codes against an application it
 * booted itself. The application is opened only after the arguments
 * pass: a usage error never touches a database.
 *
 * Exit codes: 0 issued · 1 refused · 2 usage (nothing was done).
 */

export interface BootstrapApplication {
  readonly service: AdminBootstrapService;
  close(): Promise<void>;
}

export interface CommandOutput {
  log(line: string): void;
  error(line: string): void;
}

export async function runBootstrapCommand(
  argv: readonly string[],
  open: () => Promise<BootstrapApplication>,
  out: CommandOutput,
): Promise<number> {
  const parsed = parseBootstrapArgs(argv);

  if (parsed.kind === 'usage') {
    if (parsed.problem !== null) out.error(`${parsed.problem}\n`);
    out.error(BOOTSTRAP_USAGE);
    return 2;
  }

  const app = await open();

  try {
    const result = await app.service.issue(parsed.args);
    const expires = result.expiresAt.toISOString();

    if (result.removedPlaceholders > 0) {
      out.log(`Removed ${String(result.removedPlaceholders)} abandoned bootstrap account(s).`);
    }

    if (result.link === undefined) {
      out.log(`Invitation sent to ${result.email}. It can be used once, until ${expires}.`);
    } else {
      out.log(`Invitation for ${result.email}, usable once until ${expires}:`);
      out.log('');
      out.log(result.link);
      out.log('');
      out.log('This link is a credential. Hand it to the administrator directly.');
    }

    out.log(
      'They set a password, then enrol an authenticator app; the account is not usable before both.',
    );
    return 0;
  } catch (error) {
    if (error instanceof BootstrapRefused) {
      out.error(`Refused (${error.reason}): ${error.message}`);
      return 1;
    }
    throw error;
  } finally {
    await app.close();
  }
}
