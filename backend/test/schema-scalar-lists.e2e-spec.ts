import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ConfigModule } from '../src/config';
import { DatabaseModule, PrismaService } from '../src/shared/database';

/**
 * The nullability of every scalar-list column, pinned.
 *
 * Prisma cannot declare a list column NOT NULL — `String[]` migrates to a
 * nullable `TEXT[]` — and `db:check` ignores list nullability in both
 * directions, so this is the only thing that notices the dictionary's
 * "Null: no" going missing again. Migration
 * `20261030120000_spec_scalar_lists_not_null` restored it; see
 * `docs/DATABASE_BRANCH_RECONCILIATION.md` §5.
 *
 * Both sets are exhaustive on purpose. A new list column fails the last
 * test until someone decides which set it belongs in.
 */
const NOT_NULL: readonly string[] = [
  'admin_profiles.certifications', // DB §B2
  'admin_profiles.education', // DB §B2
  'admin_profiles.experience', // DB §B2
  'doctors.certifications', // DB §B1
  'doctors.education', // DB §B1
  'doctors.languages', // DB §B1
  'doctors.skills', // DB §B1
  'medications.durations_days', // DB §F1
  'medications.frequencies', // DB §F1
  'scheduled_reports.recipients', // DB §I2
  'staff_members.permissions', // DB §K2
  'staff_shift_assignments.days', // DB §K3
];

const NULLABLE: readonly string[] = [
  'admin_invitations.permissions', // ADR-035; not in the dictionary
  'ai_user_settings.favorite_prompt_ids', // DB §H3 states no nullability
  'incident_bookmarks.event_ids', // DB §13, inferred table
  'lab_analyte_specs.qualitative_options', // DB §E2, "Null: yes"
];

describe('scalar-list nullability (DB §2)', () => {
  let prisma: PrismaService;
  let columns: Map<string, boolean>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();

    const rows = await prisma.$queryRaw<Array<{ name: string; nullable: string }>>`
      SELECT table_name || '.' || column_name AS name, is_nullable AS nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND data_type = 'ARRAY'
    `;
    columns = new Map(rows.map((row) => [row.name, row.nullable === 'YES']));
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('makes every list the dictionary declares NOT NULL, NOT NULL', () => {
    const nullable = NOT_NULL.filter((name) => columns.get(name) !== false);

    expect(nullable).toEqual([]);
  });

  it('leaves the lists the dictionary allows to be null alone', () => {
    const tightened = NULLABLE.filter((name) => columns.get(name) !== true);

    expect(tightened).toEqual([]);
  });

  it('has no list column that is in neither set', () => {
    const known = new Set([...NOT_NULL, ...NULLABLE]);
    const unclassified = [...columns.keys()].filter((name) => !known.has(name)).sort();

    expect(unclassified).toEqual([]);
  });

  it('rejects a NULL written past the client', async () => {
    // The client cannot send one; hand-written SQL can, and is the only
    // path the constraint exists for. The statement fails, so the seeded
    // row is left as it was.
    const { id } = await prisma.medication.findFirstOrThrow({ select: { id: true } });

    await expect(
      prisma.$executeRaw`UPDATE "medications" SET "frequencies" = NULL WHERE "id" = ${id}::uuid`,
    ).rejects.toThrow(/null value in column "frequencies"/);
  });
});
