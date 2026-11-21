import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { EnvValidationError, loadDotenvFile, loadEnv } from '../config/env';
import { EnvelopeReencryptionService } from '../shared/crypto';

import { type ReencryptApplication, runReencryptCommand } from './reencrypt-envelopes.command';
import { installInterruptHandlers } from './reencrypt-signals';

/**
 * `npm run crypto:reencrypt -- (--dry-run | --confirm)` — the re-encryption
 * step of a `DATA_ENCRYPTION_KEY` rotation (M37). What it does is
 * `envelope-reencryption.service.ts`; where it sits in a rotation is
 * `backend/docs/PRODUCTION_SETUP.md` §2.
 *
 * SIGKILL and machine failure cannot be handled: such a run keeps only its
 * `encryption_key.reencrypt_started` record, which `--status` lists.
 *
 * Runs from the **build** (`node dist/cli/reencrypt-envelopes.js`), as
 * `admin:bootstrap` does, for the reason given there: Nest's injector
 * needs the decorator metadata `tsc` emits.
 */
async function open(): Promise<ReencryptApplication> {
  // Boots the application only to reach its services; it must not start
  // this instance's scheduled sweeps on the way.
  process.env['JOBS_ENABLED'] = 'false';
  loadDotenvFile();
  loadEnv();

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  return { service: app.get(EnvelopeReencryptionService), close: () => app.close() };
}

// SIGTERM / SIGINT stop the run between rows and record its outcome (R5).
// Installed before the application boots, so a signal during boot is not
// the default handler's immediate exit.
const interrupt = new AbortController();
installInterruptHandlers(
  process,
  interrupt,
  (line) => {
    console.error(line);
  },
  (code) => {
    process.exit(code);
  },
);

runReencryptCommand(
  process.argv.slice(2),
  open,
  {
    log: (line) => {
      console.log(line);
    },
    error: (line) => {
      console.error(line);
    },
  },
  { signal: interrupt.signal },
).then(
  (code) => {
    process.exit(code);
  },
  (error: unknown) => {
    console.error(
      error instanceof EnvValidationError || error instanceof Error ? error.message : error,
    );
    process.exit(1);
  },
);
