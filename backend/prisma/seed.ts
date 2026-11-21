import { PrismaPg } from '@prisma/adapter-pg';
import 'dotenv/config';

import { ConfigService } from '../src/config/config.service';
import { loadEnv } from '../src/config/env';
import { PrismaClient } from '../src/generated/prisma/client';
import { PasswordService } from '../src/modules/auth/services/password.service';
import { EnvelopeService } from '../src/shared/crypto/envelope.service';

import { describeBust, invalidateReferenceCache } from './seed/cache-bust';
import { seedCatalogues } from './seed/catalogue-data';
import { seedDemo } from './seed/demo';
import {
  demoCredentialCountsFor,
  demoCredentialSettings,
  demoCredentialsPermitted,
  describeDemoAccounts,
  provisionDemoAccounts,
} from './seed/demo-accounts';
import { seedPlatformSettings } from './seed/platform-settings';
import { seedReferenceData } from './seed/reference-data';

/**
 * Database seed (RM M4.3, filled in from RM M5.1).
 *
 * Three rules, established at M4 before there was anything to seed,
 * because a seed script written casually becomes the thing nobody dares
 * run twice:
 *
 *  1. **Idempotent.** Every insert is an upsert on a natural key. Running
 *     the seed twice must leave the database as it was after the first
 *     run — otherwise it can only ever be used on an empty database,
 *     which is the one case where it is least useful.
 *  2. **Never destructive.** No truncate, no delete. `npm run db:reset`
 *     exists for starting over and says so in its name; a seed that
 *     quietly wipes tables is one careless `npm run` away from taking
 *     the development database with it.
 *  3. **Refuses to run against production.** A seed inserting demo
 *     accounts into a live clinic is not recoverable by rerunning it.
 *
 * What it writes is layered, and the layers are not the same kind of
 * thing:
 *
 *  · **Reference data** (M5.1) and **clinical catalogues** (M5.5) — the
 *    vocabularies and orderable definitions the whole
 *    schema references. Seeded in **every** environment, production
 *    included: without permissions and roles there is no authorization,
 *    and without departments no clinical row can name where it happened.
 *  · **Platform settings** (M5.10) — the eleven configuration slices.
 *    Also every environment: M6's lockout and session handling read the
 *    security slice, and a missing row means falling back to defaults an
 *    administrator cannot see or change.
 *  · **Demo clinical data** (M5.10) — the five canonical patients and
 *    the doctors around them. **Development, test and staging**, per RM
 *    M5.10 and ADR-017 §2 ("dev and staging seeds may carry more"),
 *    gated on `APP_ENV` rather than on a flag someone has to remember to
 *    pass. Production is refused outright by rule 3 above.
 *  · **Demo sign-in credentials** — a password for every demo account,
 *    and the demo administrator's second factor. **Explicit
 *    `APP_ENV=development` only** — not staging, not the test database
 *    (the e2e suite asserts it holds none), and not an unset `APP_ENV`. Hashed with the application's `PasswordService`,
 *    never overwriting a password that exists. `seed/demo-accounts.ts`
 *    holds the rules; `docs/LOCAL_DEMO_ACCOUNTS.md` lists the accounts.
 *
 * Run with `npm --prefix backend run db:seed`.
 */

const connectionString = process.env['DATABASE_URL'];

if (connectionString === undefined || connectionString.length === 0) {
  throw new Error('DATABASE_URL is not set — copy backend/.env.example to backend/.env');
}

if (process.env['APP_ENV'] === 'production') {
  // Rule 3. Deliberately a hard failure rather than a prompt: the seed
  // runs unattended in CI, where nobody is there to answer a prompt.
  throw new Error('Refusing to seed a production database (APP_ENV=production)');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function seed(): Promise<void> {
  // Connect before doing anything, so a wrong `DATABASE_URL` fails here
  // with a connection error rather than partway through the first insert.
  await prisma.$connect();

  const counts: Record<string, number> = {
    ...(await seedReferenceData(prisma)),
    ...(await seedCatalogues(prisma)),
    platformSettings: await seedPlatformSettings(prisma),
  };

  // Demo clinical data is gated on the environment, not on a flag
  // somebody has to remember to pass. DB §14.5-15: the mock credentials
  // must never reach production, and a staging database can be restored
  // somewhere nobody expected — which is why the credentials below are
  // gated more tightly than the clinical data.
  const appEnv = process.env['APP_ENV'] ?? 'development';
  let demoAccounts: string | undefined;
  if (appEnv === 'development' || appEnv === 'test' || appEnv === 'staging') {
    Object.assign(counts, await seedDemo(prisma));

    // Read from `process.env`, not `appEnv`: the default above must not be
    // what decides whether known passwords are written.
    if (demoCredentialsPermitted(process.env['APP_ENV'])) {
      // The API's own validated environment, so the administrator's TOTP
      // secret is sealed under the `DATA_ENCRYPTION_KEY` the API decrypts with.
      const envelope = new EnvelopeService(new ConfigService(loadEnv()));
      const reports = await provisionDemoAccounts(
        prisma,
        { passwords: new PasswordService(), envelope },
        demoCredentialSettings(process.env),
        process.env['APP_ENV'],
      );
      Object.assign(counts, demoCredentialCountsFor(reports));
      demoAccounts = describeDemoAccounts(reports);
    } else {
      demoAccounts = `Skipping demo credentials (APP_ENV=${process.env['APP_ENV'] ?? 'unset'}).`;
    }
  } else {
    console.info(`Skipping demo clinical data (APP_ENV=${appEnv}).`);
  }

  const summary = Object.entries(counts)
    .map(([table, count]) => `${table} ${String(count)}`)
    .join(' · ');
  console.info(`Seed complete — ${summary}.`);
  if (demoAccounts !== undefined) console.info(demoAccounts);

  // After every write above has committed (RM M31.1): the seed is the only
  // writer of the formulary, the lab catalogue and the ICD-10 codes.
  console.info(describeBust(await invalidateReferenceCache()));
}

seed()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error('Seed failed:', error);
    await prisma.$disconnect();
    // Non-zero, so a failed seed fails the CI step it runs in rather
    // than passing with an error printed into the log.
    process.exit(1);
  });
