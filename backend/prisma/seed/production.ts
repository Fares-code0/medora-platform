import type { PrismaClient } from '../../src/generated/prisma/client';

import { seedCatalogues } from './catalogue-data';
import { seedPlatformSettings } from './platform-settings';
import { seedReferenceData } from './reference-data';

/**
 * What a production database needs before anyone can sign in (RM M38.4).
 *
 * The three layers `seed.ts` calls "every environment, production
 * included" — permissions and roles, the clinical catalogues, the
 * platform-settings slices — and **nothing else**. The demo layer is not
 * imported, so no demo patient, doctor or administrator can reach a
 * production database through this file, whatever the environment says.
 * No user and no credential of any kind is created: the first
 * administrator comes from `npm run admin:bootstrap`.
 *
 * `create-only` throughout (`seed-mode.ts`): a row that already exists is
 * left exactly as an administrator left it, so running this again after
 * go-live adds what a release introduced and changes nothing else. Grants
 * an administrator revoked stay revoked (`reference-data.ts`).
 */
export async function seedProduction(prisma: PrismaClient): Promise<Record<string, number>> {
  return {
    ...(await seedReferenceData(prisma, 'create-only')),
    ...(await seedCatalogues(prisma, 'create-only')),
    platformSettings: await seedPlatformSettings(prisma),
  };
}
