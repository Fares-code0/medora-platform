import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ConfigModule } from '../src/config';
import { DatabaseModule, PrismaService } from '../src/shared/database';

import {
  type ClinicFixture,
  createClinicFixture,
  destroyClinicFixture,
} from './support/clinic-fixture';

/**
 * The M5.11 verification — the ADR-010 scope decision (RM M5.11).
 *
 * The verify step is checkable **in both directions**: "every table the
 * M0.5 ADR marked *in* exists in the schema; every table marked *out* is
 * absent." The second half is the one worth writing down, because an
 * absent table is not something anyone notices going wrong: ADR-010's
 * whole argument is that tables without consumers "become schema debt
 * that constrains migrations without ever being read".
 *
 * ⚠ `saved_views` is the case where the roadmap and the ADR disagree.
 * M5.11's item text lists it; ADR-010 group 13 scoped it **out** as a
 * documented contract gap (a UX pattern with no endpoint). This verify
 * line resolves it in the ADR's favour, and the test below pins that.
 */
describe('the ADR-010 scope decision (RM M5.11)', () => {
  let prisma: PrismaService;
  let clinic: ClinicFixture;

  /** ADR-010's nine IN groups, as physical tables. */
  const IN_TABLES = [
    'patient_doctor_assignments', // group 1  — M5.6
    'patient_access_grants', //      group 2  — here
    'specialties', //                group 4  — M5.1
    'doctor_specialties', //         group 4  — M5.3
    'insurance_providers', //        group 5  — M5.1
    'notification_deliveries', //    group 7  — here
    'drug_interactions', //          group 8  — M5.5
    'medication_monographs', //      group 9  — M5.5
    'incident_bookmarks', //         group 14 — here
    'report_exports', //             group 15 — here
  ];

  /** ADR-010's eight OUT groups. Absence is the assertion. */
  const OUT_TABLES = [
    'countries', //         group 3  — no contract endpoint
    'cities', //            group 3
    'invoices', //          group 6  — billing off (ADR-018 §2)
    'invoice_lines', //     group 6
    'payments', //          group 6
    'radiology_orders', //  group 10 — imaging is future scope
    'radiology_reports', // group 10
    'dicom_studies', //     group 10
    'immunizations', //     group 11 — already a HistoryEventKind
    'consents', //          group 12 — consent timestamps + files
    'saved_views', //       group 13 — documented contract gap
    'clinics', //           group 16 — ADR-018 §1, single clinic
    'facilities', //        group 16
    'message_templates', // group 17 — no contract endpoint
    'snippets', //          group 17
  ];

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();

    clinic = await createClinicFixture(prisma, 'adr010');
  });

  afterAll(async () => {
    await prisma.patientAccessGrant.deleteMany({ where: { patientId: clinic.patientId } });
    await destroyClinicFixture(prisma, clinic);
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.patientAccessGrant.deleteMany({ where: { patientId: clinic.patientId } });
    await prisma.incidentBookmark.deleteMany({ where: { ownerId: clinic.userId } });
    await prisma.reportExport.deleteMany({ where: { requestedBy: clinic.userId } });
  });

  async function tablesPresent(names: readonly string[]): Promise<string[]> {
    const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY(${[...names]})
    `;
    return rows.map((row) => row.table_name).sort();
  }

  describe('both directions of the decision', () => {
    it('has every table ADR-010 marked IN', async () => {
      expect(await tablesPresent(IN_TABLES)).toEqual([...IN_TABLES].sort());
    });

    it('has none of the tables ADR-010 marked OUT', async () => {
      // "Out" means not in v1, never rejected forever — each carries the
      // trigger that would bring it back. What this asserts is that their
      // absence is intentional rather than forgotten.
      expect(await tablesPresent(OUT_TABLES)).toEqual([]);
    });

    it('does not create saved_views, where the roadmap and the ADR disagree', async () => {
      // RM M5.11's item text lists it; ADR-010 group 13 scoped it out
      // because MG §5.4 describes the P7 pattern and no contract endpoint
      // exists to read or write one. The verify line — "every table
      // marked out is absent" — settles it in the ADR's favour, and
      // RA-010.1 carries the gap to RM M33.2.
      expect(await tablesPresent(['saved_views'])).toEqual([]);
    });

    it('has no clinic_id anywhere (ADR-018 §1)', async () => {
      // MG §17-10: "keep clinic FK out of v1". An unused column on ~100
      // tables plus scoping code with one tenant that cannot be
      // meaningfully tested.
      const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
        SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name IN ('clinic_id', 'tenant_id')
      `;

      expect(rows).toEqual([]);
    });
  });

  describe('patient access grants (group 2)', () => {
    it('names a user or a role, never both and never neither', async () => {
      const base = {
        patientId: clinic.patientId,
        scope: 'view',
        reason: 'Complaint investigation.',
        grantedBy: clinic.userId,
      };
      const role = await prisma.role.findUniqueOrThrow({ where: { code: 'admin' } });

      await expect(prisma.patientAccessGrant.create({ data: base })).rejects.toThrow(
        /one_grantee/,
      );

      await expect(
        prisma.patientAccessGrant.create({
          data: { ...base, granteeUserId: clinic.userId, granteeRoleId: role.id },
        }),
      ).rejects.toThrow(/one_grantee/);

      const granted = await prisma.patientAccessGrant.create({
        data: { ...base, granteeUserId: clinic.userId },
      });
      expect(granted.granteeRoleId).toBeNull();
    });

    it('ties a revocation to its revoker', async () => {
      const grant = await prisma.patientAccessGrant.create({
        data: {
          patientId: clinic.patientId,
          granteeUserId: clinic.userId,
          scope: 'reveal_identity',
          reason: 'Subpoena.',
          grantedBy: clinic.userId,
        },
      });

      await expect(
        prisma.patientAccessGrant.update({
          where: { id: grant.id },
          data: { revokedAt: new Date() },
        }),
      ).rejects.toThrow(/revoked_by_iff_revoked/);
    });

    it('keeps a revoked grant, because a past access needs explaining', async () => {
      const grant = await prisma.patientAccessGrant.create({
        data: {
          patientId: clinic.patientId,
          granteeUserId: clinic.userId,
          scope: 'view',
          reason: 'Quality audit.',
          grantedBy: clinic.userId,
        },
      });

      const revoked = await prisma.patientAccessGrant.update({
        where: { id: grant.id },
        data: { revokedAt: new Date(), revokedBy: clinic.userId },
      });

      expect(revoked.revokedAt).not.toBeNull();
      expect(revoked.reason).toBe('Quality audit.');
    });

    it('closes the scope vocabulary', async () => {
      await expect(
        prisma.patientAccessGrant.create({
          data: {
            patientId: clinic.patientId,
            granteeUserId: clinic.userId,
            scope: 'everything',
            reason: 'No.',
            grantedBy: clinic.userId,
          },
        }),
      ).rejects.toThrow(/scope_check/);
    });
  });

  describe('incident bookmarks (group 14)', () => {
    it('holds audit event ids as an array, not a foreign key', async () => {
      // `audit_events` is partitioned with a composite PK `(id,
      // occurred_at)`, so an FK would have to carry both columns — and
      // the ledger is append-only, so referential integrity buys nothing
      // an array does not (ADR-024).
      const bookmark = await prisma.incidentBookmark.create({
        data: {
          ownerId: clinic.userId,
          name: 'INC-2026-014',
          eventIds: ['11111111-1111-4111-8111-111111111111'],
          incidentRef: 'INC-2026-014',
        },
      });

      expect(bookmark.eventIds).toHaveLength(1);

      const fks = await prisma.$queryRaw<Array<{ conname: string }>>`
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'incident_bookmarks'::regclass AND contype = 'f'
          AND confrelid = 'audit_events'::regclass
      `;
      expect(fks).toEqual([]);
    });

    it('rejects two bookmarks with one name for one owner', async () => {
      const data = { ownerId: clinic.userId, name: 'INC-2026-014' };
      await prisma.incidentBookmark.create({ data });

      await expect(prisma.incidentBookmark.create({ data })).rejects.toThrow();
    });
  });

  describe('report exports (group 15)', () => {
    it('refuses a ready export with no artefact', async () => {
      // The download endpoint would answer a 500 rather than a useful
      // state.
      await expect(
        prisma.reportExport.create({
          data: {
            requestedBy: clinic.userId,
            category: 'PATIENTS',
            format: 'CSV',
            status: 'ready',
          },
        }),
      ).rejects.toThrow(/ready_has_file/);
    });

    it('refuses a failed export with no error', async () => {
      await expect(
        prisma.reportExport.create({
          data: {
            requestedBy: clinic.userId,
            category: 'PATIENTS',
            format: 'CSV',
            status: 'failed',
          },
        }),
      ).rejects.toThrow(/failed_has_error/);
    });

    it('carries a watermark reference for traceable content exports', async () => {
      const row = await prisma.reportExport.create({
        data: {
          requestedBy: clinic.userId,
          category: 'RECORDS',
          format: 'PDF',
          watermarkRef: 'EXP-2026-0042',
        },
      });

      // UX §3.6 watermarks disclosed content; an export leaving the
      // building without a reference cannot be tied to its request.
      expect(row.watermarkRef).toBe('EXP-2026-0042');
      expect(row.status).toBe('queued');
    });
  });

  describe('notification deliveries (group 7)', () => {
    it('records one row per channel, so partial delivery is expressible', async () => {
      // "Emailed but the SMS bounced" is the state the UX §3.5 receipts
      // drawer shows, and one status column on `notifications` cannot
      // express it.
      const notification = await prisma.notification.create({
        data: {
          recipientId: clinic.userId,
          title: 'Critical lab result',
          body: 'Hemoglobin 6.1 g/dL',
          category: 'LABORATORY',
          kind: 'ALERT',
          priority: 'CRITICAL',
          sender: 'Lab System',
        },
      });

      await prisma.notificationDelivery.create({
        data: {
          notificationId: notification.id,
          channel: 'EMAIL',
          status: 'delivered',
          deliveredAt: new Date(),
        },
      });
      await prisma.notificationDelivery.create({
        data: {
          notificationId: notification.id,
          channel: 'SMS',
          status: 'failed',
          error: 'Carrier rejected the number.',
        },
      });
      // `skipped` is a real outcome, not an absence: quiet hours suppress
      // a channel deliberately, and no row would read as "never tried".
      await prisma.notificationDelivery.create({
        data: { notificationId: notification.id, channel: 'PUSH', status: 'skipped' },
      });

      const deliveries = await prisma.notificationDelivery.findMany({
        where: { notificationId: notification.id },
      });
      expect(deliveries).toHaveLength(3);

      await expect(
        prisma.notificationDelivery.create({
          data: { notificationId: notification.id, channel: 'EMAIL' },
        }),
      ).rejects.toThrow();

      await prisma.notification.delete({ where: { id: notification.id } });
    });

    it('ties delivered_at to the delivered status', async () => {
      const notification = await prisma.notification.create({
        data: {
          recipientId: clinic.userId,
          title: 'Reminder',
          body: 'Appointment tomorrow.',
          category: 'APPOINTMENTS',
          kind: 'REMINDER',
          sender: 'Scheduler',
        },
      });

      await expect(
        prisma.notificationDelivery.create({
          data: { notificationId: notification.id, channel: 'EMAIL', status: 'delivered' },
        }),
      ).rejects.toThrow(/delivered_at_iff_delivered/);

      await prisma.notification.delete({ where: { id: notification.id } });
    });
  });
});
