import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/generated/prisma/client';

import { describeBust, invalidateReferenceCache } from './seed/cache-bust';
import { seedProduction } from './seed/production';

/**
 * `npm run db:seed:production` — the reference data a production database
 * needs, and no demo data and no account (`seed/production.ts`).
 *
 * `npm run db:seed` still refuses `APP_ENV=production`, deliberately: it
 * carries the demo layer. This is the separate, explicit entry point for a
 * live database. Safe to rerun; it only creates what is missing.
 */

const connectionString = process.env['DATABASE_URL'];

if (connectionString === undefined || connectionString.length === 0) {
  throw new Error('DATABASE_URL is not set');
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

async function run(): Promise<void> {
  await prisma.$connect();
  const counts = await seedProduction(prisma);
  const summary = Object.entries(counts)
    .map(([table, count]) => `${table} ${String(count)}`)
    .join(' · ');
  console.info(`Production reference data in place — ${summary}. No account was created.`);

  // RM M31.1 — the reference caches, after the writes have committed.
  console.info(describeBust(await invalidateReferenceCache()));
}

run()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    console.error('Production seed failed:', error);
    await prisma.$disconnect();
    process.exit(1);
  });
