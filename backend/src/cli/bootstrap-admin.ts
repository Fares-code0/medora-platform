import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from '../app.module';
import { EnvValidationError, loadDotenvFile, loadEnv } from '../config/env';
import { AdminBootstrapService } from '../modules/auth/services/admin-bootstrap.service';

import { type BootstrapApplication, runBootstrapCommand } from './bootstrap-admin.command';

/**
 * `npm run admin:bootstrap -- --email <address> --confirm` — the first
 * administrator of a deployment (RM M38.4). What it does and refuses is
 * `admin-bootstrap.service.ts`; where it sits in a deployment is
 * `backend/docs/PRODUCTION_SETUP.md`.
 *
 * An operator command, not a route: it needs a shell on the server and the
 * deployment's environment, which is the authority ADR-035 leaves for the
 * one administrator no administrator can invite.
 *
 * Runs from the **build** (`node dist/cli/bootstrap-admin.js`), as the API
 * does. Nest's injector reads the decorator metadata `tsc` emits; `tsx`
 * (esbuild) emits none, so the source cannot be run with it.
 */
async function open(): Promise<BootstrapApplication> {
  // The command boots the application only to reach its services; it must
  // not start this instance's scheduled sweeps on the way.
  process.env['JOBS_ENABLED'] = 'false';
  loadDotenvFile();
  loadEnv();

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });

  return { service: app.get(AdminBootstrapService), close: () => app.close() };
}

runBootstrapCommand(process.argv.slice(2), open, {
  log: (line) => {
    console.log(line);
  },
  error: (line) => {
    console.error(line);
  },
}).then(
  (code) => {
    process.exit(code);
  },
  (error: unknown) => {
    // An invalid environment names each variable; anything else is a
    // failure the operator needs the message of, not a stack.
    console.error(
      error instanceof EnvValidationError || error instanceof Error ? error.message : error,
    );
    process.exit(1);
  },
);
