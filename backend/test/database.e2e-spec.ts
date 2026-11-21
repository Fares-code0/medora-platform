import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ConfigModule } from '../src/config';
import {
  auditCreate,
  auditSoftDelete,
  DatabaseModule,
  ONLY_DELETED,
  PrismaService,
  softDeletableModelsOf,
} from '../src/shared/database';

/**
 * The M4 verification, against a **real Postgres** (RM M4.2, M4.3).
 *
 * A mocked Prisma client would prove nothing here. Every property under
 * test is the database's behaviour, not the client's: `gen_random_uuid()`
 * is pgcrypto, case-insensitive matching is citext, the trigram index is
 * pg_trgm, and the soft-delete filter only matters once real SQL runs.
 *
 * Requires `DATABASE_URL` to point at a migrated database. `npm test`
 * has needed one since M4 — `test/setup-env.ts` defaults it to
 * `medora_test`, and CI provisions it as a service.
 */
describe('database conventions (RM M4)', () => {
  let prisma: PrismaService;
  const actor = '11111111-1111-4111-8111-111111111111';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    // Hard delete here on purpose: this is test cleanup, not application
    // behaviour, and leftovers would make the counts below meaningless.
    // The unextended client, so soft-deleted leftovers are removed too.
    await prisma.conventionsReference.deleteMany({});
  });

  describe('M4.1 — extensions and conventions', () => {
    it('has all three extensions installed', async () => {
      const rows = await prisma.$queryRaw<Array<{ extname: string }>>`
        SELECT extname FROM pg_extension ORDER BY extname
      `;
      const names = rows.map((row) => row.extname);

      expect(names).toContain('pgcrypto');
      expect(names).toContain('citext');
      expect(names).toContain('pg_trgm');
    });

    it('generates the primary key in the database, not the client', async () => {
      // No id supplied — if pgcrypto were missing this insert fails.
      const row = await prisma.conventionsReference.create({ data: { label: 'ward-a' } });

      expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('compares citext columns case-insensitively', async () => {
      await prisma.conventionsReference.create({ data: { label: 'Ward-A' } });

      // Plain text would need `mode: 'insensitive'`, which cannot use a
      // plain index. This is why emails are citext throughout M5.
      const found = await prisma.conventionsReference.findFirst({ where: { label: 'ward-a' } });
      expect(found).not.toBeNull();
    });

    it('stores timestamps with a zone', async () => {
      const row = await prisma.conventionsReference.create({ data: { label: 'ward-b' } });

      expect(row.createdAt).toBeInstanceOf(Date);
      const [column] = await prisma.$queryRaw<Array<{ data_type: string }>>`
        SELECT data_type FROM information_schema.columns
        WHERE table_name = '_conventions_reference' AND column_name = 'created_at'
      `;
      // A `timestamp` without a zone silently means "whatever the server
      // was set to" — for an appointment time that is a safety problem.
      expect(column?.data_type).toBe('timestamp with time zone');
    });

    it('has the trigram index pg_trgm was installed for', async () => {
      const rows = await prisma.$queryRaw<Array<{ indexdef: string }>>`
        SELECT indexdef FROM pg_indexes
        WHERE tablename = '_conventions_reference'
          AND indexname = 'conventions_reference_label_trgm_idx'
      `;

      expect(rows[0]?.indexdef).toContain('gin_trgm_ops');
    });

    it('names every column in snake_case', async () => {
      const rows = await prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = '_conventions_reference'
      `;

      // A camelCase column has to be double-quoted in every hand-written
      // query and migration forever after.
      for (const { column_name: name } of rows) {
        expect(name).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    });
  });

  describe('M4.2 — soft delete', () => {
    it('hides a soft-deleted row from default queries', async () => {
      const row = await prisma.db.conventionsReference.create({
        data: { label: 'ward-c', ...auditCreate(actor) },
      });

      await prisma.db.conventionsReference.update({
        where: { id: row.id },
        data: auditSoftDelete(actor),
      });

      expect(await prisma.db.conventionsReference.findMany()).toEqual([]);
      expect(await prisma.db.conventionsReference.count()).toBe(0);
      expect(
        await prisma.db.conventionsReference.findFirst({ where: { label: 'ward-c' } }),
      ).toBeNull();
    });

    it('shows it again with the explicit flag', async () => {
      const row = await prisma.db.conventionsReference.create({ data: { label: 'ward-d' } });
      await prisma.db.conventionsReference.update({
        where: { id: row.id },
        data: auditSoftDelete(actor),
      });

      // The unextended client is the escape hatch: it sees everything.
      const all = await prisma.conventionsReference.findMany();

      expect(all).toHaveLength(1);
      expect(all[0]?.deletedAt).toBeInstanceOf(Date);
      // The row is still there — ADR-007 retention depends on it, and a
      // hard delete would destroy what the audit trail points at.
      expect(all[0]?.updatedBy).toBe(actor);
    });

    it('leaves live rows visible alongside deleted ones', async () => {
      const doomed = await prisma.db.conventionsReference.create({ data: { label: 'ward-e' } });
      await prisma.db.conventionsReference.create({ data: { label: 'ward-f' } });
      await prisma.db.conventionsReference.update({
        where: { id: doomed.id },
        data: auditSoftDelete(actor),
      });

      const live = await prisma.db.conventionsReference.findMany();
      expect(live.map((entry) => entry.label)).toEqual(['ward-f']);
      expect(await prisma.conventionsReference.findMany()).toHaveLength(2);
    });

    it('can query for only the deleted rows', async () => {
      const doomed = await prisma.db.conventionsReference.create({ data: { label: 'ward-g' } });
      await prisma.db.conventionsReference.create({ data: { label: 'ward-h' } });
      await prisma.db.conventionsReference.update({
        where: { id: doomed.id },
        data: auditSoftDelete(actor),
      });

      const deleted = await prisma.db.conventionsReference.findMany({ where: ONLY_DELETED });

      expect(deleted.map((entry) => entry.label)).toEqual(['ward-g']);
    });

    it('does not filter the unextended client', async () => {
      // `prisma` is the raw client; `prisma.db` is the filtered one. The
      // distinction is what lets audit and retention jobs see everything.
      const row = await prisma.conventionsReference.create({ data: { label: 'ward-i' } });
      await prisma.conventionsReference.update({
        where: { id: row.id },
        data: auditSoftDelete(actor),
      });

      expect(await prisma.conventionsReference.findMany()).toHaveLength(1);
      expect(await prisma.db.conventionsReference.findMany()).toHaveLength(0);
    });
  });

  describe('M4.2 — audit columns', () => {
    it('records the actor on create and clears nothing on update', async () => {
      const created = await prisma.db.conventionsReference.create({
        data: { label: 'ward-j', ...auditCreate(actor) },
      });
      expect(created.createdBy).toBe(actor);
      expect(created.updatedBy).toBe(actor);

      const other = '22222222-2222-4222-8222-222222222222';
      const updated = await prisma.db.conventionsReference.update({
        where: { id: created.id },
        data: { label: 'ward-j2', updatedBy: other },
      });

      expect(updated.createdBy).toBe(actor);
      expect(updated.updatedBy).toBe(other);
    });

    it('moves updatedAt forward on update', async () => {
      const created = await prisma.db.conventionsReference.create({ data: { label: 'ward-k' } });
      const updated = await prisma.db.conventionsReference.update({
        where: { id: created.id },
        data: { label: 'ward-k2' },
      });

      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());
      expect(updated.createdAt.getTime()).toBe(created.createdAt.getTime());
    });
  });

  /**
   * Which models the soft-delete filter applies to (RM M4.2, corrected
   * at M6.2).
   *
   * The extension originally filtered `$allModels` unconditionally, which
   * reads as the safe choice and is not: only 43 of the 107 models carry
   * `deletedAt`, and adding `deletedAt: null` to a `where` for one of the
   * other 64 is an invalid query rather than a stricter one. Nothing
   * caught it until M6 became the first milestone to read a `sessions`
   * row through `db`.
   *
   * These cases pin both halves — that the set is derived at all, and
   * that it splits where the schema splits.
   */
  describe('the soft-delete model set', () => {
    it('is derived from the client rather than maintained by hand', () => {
      const models = softDeletableModelsOf(prisma);

      // `undefined` means Prisma renamed the metadata this reads, and the
      // extension has silently fallen back to filtering everything.
      expect(models).toBeDefined();
      expect(models!.size).toBeGreaterThan(30);
    });

    it('includes the clinical models and excludes the history ones', () => {
      const models = softDeletableModelsOf(prisma)!;

      // Retained for years under ADR-007, so never hard-deleted.
      expect(models.has('User')).toBe(true);
      expect(models.has('Patient')).toBe(true);
      expect(models.has('MedicalRecord')).toBe(true);

      // Deliberately not soft-deletable (`03-identity.prisma`): a revoked
      // session is revoked, and a login attempt is history.
      expect(models.has('Session')).toBe(false);
      expect(models.has('LoginEvent')).toBe(false);
      expect(models.has('VerificationToken')).toBe(false);
      expect(models.has('RolePermission')).toBe(false);
    });

    it('reads a model without the column instead of rejecting the query', async () => {
      // The regression itself: this threw `PrismaClientValidationError`
      // before the extension narrowed, and every login 500ed.
      await expect(prisma.db.session.findFirst({ where: { revokedAt: null } })).resolves.not.toThrow();
      await expect(prisma.db.loginEvent.count()).resolves.toBeGreaterThanOrEqual(0);
    });
  });
});