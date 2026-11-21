import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ConfigModule } from '../src/config';
import { DatabaseModule, PrismaService } from '../src/shared/database';
import { PERMISSIONS, ROLES } from '../prisma/seed/permissions';
import {
  CHRONIC_CONDITIONS,
  DEPARTMENTS,
  ICD_CODES,
  SPECIALTIES,
  VISIT_TYPES,
} from '../prisma/seed/vocabularies';

/**
 * The M5.1 verification — enums, lookups, files (RM M5.1).
 *
 * Two things are proven here that nothing else can prove:
 *
 * **1. The enum values are the verbatim strings.** The Prisma client
 * speaks `NO_SHOW`; the database stores `no-show`. That mapping is the
 * whole reason ADR-023 exists, and a missing `@map` would silently store
 * the member name instead — a value the frontend has never heard of.
 * These tests read `pg_enum` directly, so they see what the database
 * holds rather than what the client says it holds.
 *
 * **2. The CHECK constraints actually reject.** `npm run db:check` does
 * not see CHECK constraints (probed during M5.1: a migration that adds
 * one, against a schema that cannot declare it, still reports "No
 * difference detected"). A failing-insert test is therefore the only
 * mechanism holding them.
 *
 * The vocabulary assertions need the seed to have run. CI runs
 * `db:deploy` → `db:seed` → `test` in that order for exactly this reason.
 */
describe('reference data and enums (RM M5.1)', () => {
  let prisma: PrismaService;

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

  /** The labels a Postgres enum type actually holds, in declaration order. */
  async function enumValues(typeName: string): Promise<string[]> {
    const rows = await prisma.$queryRaw<Array<{ enumlabel: string }>>`
      SELECT e.enumlabel
      FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = ${typeName}
      ORDER BY e.enumsortorder
    `;
    return rows.map((row) => row.enumlabel);
  }

  describe('native enum types', () => {
    it('declares every DB §6 vocabulary as a native enum', async () => {
      const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*) FROM pg_type WHERE typtype = 'e'
      `;

      expect(Number(rows[0]?.count)).toBe(80);
    });

    it('stores appointment_status verbatim, hyphens included (ADR-001)', async () => {
      // Eight values, and `no-show`/`awaiting-patient` spelled exactly as
      // ADR-001 fixes them. A member name leaking through instead of the
      // mapped value would show up here as `NO_SHOW`.
      expect(await enumValues('appointment_status')).toEqual([
        'scheduled',
        'confirmed',
        'pending',
        'completed',
        'cancelled',
        'rescheduled',
        'no-show',
        'awaiting-patient',
      ]);
    });

    it('stores prescription_status with draft and dispensed (ADR-002)', async () => {
      expect(await enumValues('prescription_status')).toEqual([
        'draft',
        'pending-approval',
        'active',
        'dispensed',
        'completed',
        'discontinued',
        'expired',
      ]);
    });

    it('preserves values that are not identifiers at all', async () => {
      // Blood types carry `+`/`-`; specimen types and lab categories carry
      // spaces; `inApp` is camelCase. None of these can be a Prisma member
      // name, so each is only correct because of its `@map`.
      expect(await enumValues('blood_type')).toEqual([
        'A+',
        'A-',
        'B+',
        'B-',
        'AB+',
        'AB-',
        'O+',
        'O-',
      ]);
      expect(await enumValues('lab_specimen_type')).toContain('Whole blood');
      expect(await enumValues('lab_test_category')).toContain('Blood Bank');
      expect(await enumValues('notification_channel')).toContain('inApp');
    });

    it('has no enum member spelled like a Prisma identifier by accident', async () => {
      // The failure mode a per-value `@map` audit would miss: any label
      // that is SCREAMING_SNAKE_CASE is almost certainly a member name
      // that reached the database because its `@map` was dropped.
      const rows = await prisma.$queryRaw<Array<{ typname: string; enumlabel: string }>>`
        SELECT t.typname, e.enumlabel
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE e.enumlabel ~ '^[A-Z][A-Z0-9_]*$' AND e.enumlabel <> 'CSF'
      `;

      expect(rows).toEqual([]);
    });
  });

  describe('the permission vocabulary (DB §A2)', () => {
    it('holds exactly the 22 codes of the Permission union', async () => {
      const stored = await prisma.permission.findMany({ select: { code: true } });

      expect(stored.map((row) => row.code).sort()).toEqual(
        PERMISSIONS.map((permission) => permission.code).sort(),
      );
      expect(stored).toHaveLength(22);
    });

    it('groups every permission into one of the six UX §3.9 domains', async () => {
      const domains = await prisma.permission.findMany({ select: { domain: true } });
      const distinct = [...new Set(domains.map((row) => row.domain))].sort();

      expect(distinct).toEqual([
        'AI assistant',
        'Administration',
        'Audit',
        'Clinical data',
        'Communication',
        'Scheduling',
      ]);
    });
  });

  describe('the role bundles (DB §A3)', () => {
    it.each(ROLES.map((role) => [role.code, role.permissions] as const))(
      'grants %s exactly the capabilities the seeded matrix declares',
      async (code, expected) => {
        const role = await prisma.role.findUniqueOrThrow({
          where: { code },
          include: { permissions: { include: { permission: true } } },
        });

        const granted = role.permissions.map((row) => row.permission.code).sort();

        expect(granted).toEqual([...expected].sort());
      },
    );

    it('seeds no role outside the platform and staff vocabularies', async () => {
      const stored = await prisma.role.findMany({ select: { code: true } });

      expect(stored.map((row) => row.code).sort()).toEqual(ROLES.map((role) => role.code).sort());
    });

    it('seeds a patient role, holding nothing (ADR-030 amends ADR-018 §3)', async () => {
      // This test asserted the opposite until 2026-09-02 — "has no patient
      // role — patients are records, not users (ADR-018)". ADR-030 amends
      // ADR-018 §3 by owner decision, and the inversion here is the point
      // rather than a casualty: it is the visible signal that the boundary
      // moved through a recorded decision. A reviewer who finds this
      // changed with no ADR reference should reject the change.
      const patient = await prisma.role.findUnique({
        where: { code: 'patient' },
        include: { permissions: true },
      });

      expect(patient).not.toBeNull();
      // The empty bundle is what closes every capability-gated route in
      // the platform to patients, with nothing written (ADR-030 §6).
      expect(patient?.permissions).toEqual([]);
    });

    it('marks every seeded role as a system role, so none can be deleted', async () => {
      const roles = await prisma.role.findMany();

      expect(roles.every((role) => role.isSystem)).toBe(true);
    });
  });

  describe('the vocabularies (DB §5)', () => {
    it('seeds the twelve departments ADR-004 unions together', async () => {
      const stored = await prisma.department.findMany({ select: { name: true } });

      expect(stored.map((row) => row.name).sort()).toEqual([...DEPARTMENTS].sort());
    });

    it('seeds the eight visit types, the ten conditions, the fourteen ICD codes', async () => {
      expect(await prisma.visitType.count()).toBe(VISIT_TYPES.length);
      expect(await prisma.chronicCondition.count()).toBe(CHRONIC_CONDITIONS.length);
      expect(await prisma.icdCode.count()).toBe(ICD_CODES.length);
      expect(await prisma.specialty.count()).toBe(SPECIALTIES.length);
    });

    it('leaves insurance_providers empty — DB §5 seeds none', async () => {
      // The table exists because `patient_insurance.provider_id`
      // references it; the rows arrive with real clinic data.
      expect(await prisma.insuranceProvider.count()).toBe(0);
    });
  });

  describe('CHECK constraints the drift check cannot see', () => {
    const file = {
      storageKey: 'test/objects/probe',
      originalName: 'probe.pdf',
      mimeType: 'application/pdf',
      sizeBytes: BigInt(1024),
      checksumSha256: 'a'.repeat(64),
    };

    it('rejects a files.kind outside the eight DB §11 values', async () => {
      await expect(
        prisma.file.create({ data: { ...file, kind: 'radiology_dicom' } }),
      ).rejects.toThrow(/files_kind_check/);
    });

    it('accepts a files.kind that is one of them', async () => {
      const row = await prisma.file.create({ data: { ...file, kind: 'patient_document' } });

      expect(row.kind).toBe('patient_document');
      expect(row.scannedAt).toBeNull();

      await prisma.file.delete({ where: { id: row.id } });
    });

    it('rejects a scan_result outside the closed set', async () => {
      await expect(
        prisma.file.create({ data: { ...file, kind: 'patient_document', scanResult: 'maybe' } }),
      ).rejects.toThrow(/files_scan_result_check/);
    });

    it('refuses to make a role its own template', async () => {
      const doctor = await prisma.role.findUniqueOrThrow({ where: { code: 'doctor' } });

      await expect(
        prisma.role.update({ where: { id: doctor.id }, data: { baseRoleId: doctor.id } }),
      ).rejects.toThrow(/roles_base_role_not_self/);
    });
  });
});
