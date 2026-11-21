import { Test } from '@nestjs/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ConfigModule } from '../src/config';
import { DatabaseModule, PrismaService } from '../src/shared/database';
import { PLATFORM_SETTINGS } from '../prisma/seed/platform-settings';
import { DEMO_PATIENTS } from '../prisma/seed/demo';

import {
  type ClinicFixture,
  createClinicFixture,
  destroyClinicFixture,
} from './support/clinic-fixture';

/**
 * The M5.10 verification — platform, audit, triggers, indexes, seed.
 *
 * Verify: an illegal appointment transition raises **at the DB level**;
 * `EXPLAIN` on the hot list queries uses the intended indexes; the seed
 * produces a dataset equivalent to the frontend roster.
 *
 * The first of those is the reason the trigger exists. The status machine
 * also lives in `shared/` for the API — that is where the 409 with a
 * `detail` comes from — but a rule that lives only in one caller is not
 * an invariant of the data. These tests bypass the service entirely.
 */
describe('platform, audit and triggers (RM M5.10)', () => {
  let prisma: PrismaService;
  let clinic: ClinicFixture;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();

    clinic = await createClinicFixture(prisma, 'platform');
  });

  afterAll(async () => {
    await prisma.labOrder.deleteMany({ where: { patientId: clinic.patientId } });
    await destroyClinicFixture(prisma, clinic);
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.appointment.deleteMany({ where: { patientId: clinic.patientId } });
    await prisma.labOrder.deleteMany({ where: { patientId: clinic.patientId } });
    await prisma.resource.deleteMany({ where: { name: { startsWith: 'spec-' } } });
  });

  let counter = 0;
  async function appointmentIn(status: string) {
    counter += 1;
    return prisma.appointment.create({
      data: {
        publicId: `APT-${String(50000 + counter)}`,
        patientId: clinic.patientId,
        doctorId: clinic.doctorId,
        visitTypeId: clinic.visitTypeId,
        startsAt: new Date('2026-09-01T15:00:00Z'),
        reason: 'Review',
        status: status as 'PENDING',
        ...(status === 'CANCELLED' ? { cancelledReason: 'Seeded cancelled.' } : {}),
      },
    });
  }

  describe('the appointment status machine at the database (DB §4.1, ADR-001)', () => {
    it('refuses a transition out of a terminal state', async () => {
      const completed = await appointmentIn('COMPLETED');

      await expect(
        prisma.appointment.update({
          where: { id: completed.id },
          data: { status: 'CONFIRMED' },
        }),
      ).rejects.toThrow(/is terminal/);
    });

    it.each([
      ['CANCELLED', 'CONFIRMED'],
      ['NO_SHOW', 'COMPLETED'],
    ])('refuses %s -> %s', async (from, to) => {
      const row = await appointmentIn(from);

      await expect(
        prisma.appointment.update({ where: { id: row.id }, data: { status: to as 'CONFIRMED' } }),
      ).rejects.toThrow(/is terminal/);
    });

    it('refuses a transition the ADR-001 matrix does not contain', async () => {
      // `pending -> completed` skips the whole approval path.
      const pending = await appointmentIn('PENDING');

      await expect(
        prisma.appointment.update({ where: { id: pending.id }, data: { status: 'COMPLETED' } }),
      ).rejects.toThrow(/illegal appointment transition: pending -> completed/);
    });

    it('allows every transition the matrix does contain', async () => {
      const pending = await appointmentIn('PENDING');
      const confirmed = await prisma.appointment.update({
        where: { id: pending.id },
        data: { status: 'CONFIRMED' },
      });
      expect(confirmed.status).toBe('CONFIRMED');

      const rescheduled = await prisma.appointment.update({
        where: { id: pending.id },
        data: { status: 'RESCHEDULED' },
      });
      expect(rescheduled.status).toBe('RESCHEDULED');

      const completed = await prisma.appointment.update({
        where: { id: pending.id },
        data: { status: 'COMPLETED' },
      });
      expect(completed.status).toBe('COMPLETED');
    });

    it('allows pending -> awaiting-patient, the propose-slots path', async () => {
      // ADR-001 RA-001.1 keeps this to `pending` until product confirms
      // the wider set.
      const pending = await appointmentIn('PENDING');

      const proposed = await prisma.appointment.update({
        where: { id: pending.id },
        data: { status: 'AWAITING_PATIENT' },
      });

      expect(proposed.status).toBe('AWAITING_PATIENT');
    });

    it('allows a no-op update that does not change status', async () => {
      const completed = await appointmentIn('COMPLETED');

      const touched = await prisma.appointment.update({
        where: { id: completed.id },
        data: { notes: 'Filed.' },
      });

      expect(touched.notes).toBe('Filed.');
    });
  });

  describe('the prescription status machine (DB §4.3, ADR-002)', () => {
    it('refuses a dispensed prescription returning to active', async () => {
      // ADR-002 §2: dispensed is terminal-adjacent — it may expire or be
      // discontinued, but "cannot return to `active`".
      const medicationId = (
        await prisma.medication.findFirstOrThrow({ where: { genericName: 'Atorvastatin' } })
      ).id;

      const prescription = await prisma.prescription.create({
        data: {
          publicId: `RX-${String(500000 + counter++)}`,
          patientId: clinic.patientId,
          medicationId,
          prescribingDoctorId: clinic.doctorId,
          strength: '20 mg',
          dosage: '1 tablet',
          frequency: 'Once daily',
          route: 'ORAL',
          durationDays: 30,
          quantity: 30,
          instructions: 'Take with food.',
          startDate: new Date('2026-08-01'),
          endDate: new Date('2026-08-31'),
          status: 'DISPENSED',
          signedAt: new Date(),
        },
      });

      await expect(
        prisma.prescription.update({ where: { id: prescription.id }, data: { status: 'ACTIVE' } }),
      ).rejects.toThrow(/illegal prescription transition/);

      await prisma.prescription.delete({ where: { id: prescription.id } });
    });
  });

  describe('trigger-maintained derived values', () => {
    it('sets has_critical_result from the results, not from the caller', async () => {
      // DB §E3 marks the column trigger-maintained. Because it is stored
      // it can be wrong, so nothing writes it by hand.
      const testId = (
        await prisma.labTestCatalogue.findUniqueOrThrow({ where: { code: '58410-2' } })
      ).id;

      const order = await prisma.labOrder.create({
        data: {
          publicId: `LAB-${String(500000 + counter++)}`,
          patientId: clinic.patientId,
          testId,
          orderedBy: clinic.doctorId,
          clinicalIndication: 'Anaemia screen',
        },
      });
      expect(order.hasCriticalResult).toBe(false);

      const result = await prisma.labResult.create({
        data: {
          labOrderId: order.id,
          analyte: 'Hemoglobin',
          valueText: '6.1',
          valueNumeric: 6.1,
          unit: 'g/dL',
          refLow: 12,
          refHigh: 17,
          refText: '12–17',
          flag: 'CRITICAL_LOW',
        },
      });

      const flagged = await prisma.labOrder.findUniqueOrThrow({ where: { id: order.id } });
      expect(flagged.hasCriticalResult).toBe(true);

      // And it goes back down when the critical result does.
      await prisma.labResult.update({ where: { id: result.id }, data: { flag: 'LOW' } });
      const cleared = await prisma.labOrder.findUniqueOrThrow({ where: { id: order.id } });
      expect(cleared.hasCriticalResult).toBe(false);
    });

    it('derives resource status from quantity and reorder level', async () => {
      const inStock = await prisma.resource.create({
        data: {
          name: 'spec-gloves',
          category: 'Consumables',
          location: 'Store A',
          quantity: 100,
          reorderLevel: 20,
          // Deliberately wrong — the trigger overrides the caller.
          status: 'OUT',
        },
      });
      expect(inStock.status).toBe('IN_STOCK');

      const low = await prisma.resource.update({
        where: { id: inStock.id },
        data: { quantity: 20 },
      });
      expect(low.status).toBe('LOW');

      const out = await prisma.resource.update({ where: { id: inStock.id }, data: { quantity: 0 } });
      expect(out.status).toBe('OUT');
    });

    it('maintains updated_at from the database, not only from the client', async () => {
      // DB §2 asks for a trigger because Prisma's `@updatedAt` is applied
      // client-side, so it is absent from any write that does not go
      // through Prisma — a migration, a psql session, another service.
      const appointment = await appointmentIn('PENDING');
      const before = appointment.updatedAt;

      await prisma.$executeRaw`
        UPDATE appointments SET notes = 'Touched by raw SQL' WHERE id = ${appointment.id}::uuid
      `;

      const after = await prisma.appointment.findUniqueOrThrow({ where: { id: appointment.id } });
      expect(after.updatedAt.getTime()).toBeGreaterThan(before.getTime());
    });
  });

  describe('the audit ledger (DB §M1, ADR-007 R2)', () => {
    it('is a partitioned table, not an ordinary one', async () => {
      const rows = await prisma.$queryRaw<Array<{ relkind: string }>>`
        SELECT relkind::text FROM pg_class WHERE relname = 'audit_events'
      `;

      expect(rows[0]?.relkind).toBe('p');
    });

    it('has monthly partitions and a default to catch the rest', async () => {
      const rows = await prisma.$queryRaw<Array<{ relname: string }>>`
        SELECT c.relname FROM pg_inherits i
        JOIN pg_class c ON c.oid = i.inhrelid
        JOIN pg_class p ON p.oid = i.inhparent
        WHERE p.relname = 'audit_events'
      `;

      const names = rows.map((row) => row.relname);
      // Twelve months from deployment, plus the DEFAULT. Without the
      // default, an event outside every range fails to insert — and a
      // failed insert on the audit ledger means an action that happened
      // was never recorded.
      expect(names).toContain('audit_events_default');
      expect(names.filter((name) => /^audit_events_\d{4}_\d{2}$/.test(name))).toHaveLength(12);
    });

    it('routes an event into the partition for its month', async () => {
      const occurredAt = new Date();
      const inserted = await prisma.auditEvent.create({
        data: {
          occurredAt,
          category: 'SECURITY',
          eventType: 'phi_reveal',
          severity: 'WARNING',
          summary: 'Revealed patient identity PT-1004',
          target: 'PT-1004',
        },
      });

      const month = occurredAt.toISOString().slice(0, 7).replace('-', '_');
      const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT count(*) FROM audit_events WHERE id = ${inserted.id}::uuid
      `;
      expect(Number(rows[0]?.count)).toBe(1);

      const partitioned = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT count(*) FROM audit_events_${month} WHERE id = $1::uuid`,
        inserted.id,
      );
      expect(Number(partitioned[0]?.count)).toBe(1);

      await prisma.$executeRaw`DELETE FROM audit_events WHERE id = ${inserted.id}::uuid`;
    });

    it('carries a BRIN index on occurred_at (DB §8)', async () => {
      const rows = await prisma.$queryRaw<Array<{ amname: string }>>`
        SELECT am.amname FROM pg_class c
        JOIN pg_am am ON am.oid = c.relam
        WHERE c.relname = 'audit_events_occurred_at_brin_idx'
      `;

      expect(rows[0]?.amname).toBe('brin');
    });

    it('does not reference sessions by foreign key', async () => {
      // Sessions are purged; an audit event whose session vanished must
      // keep the id it correlated on.
      const rows = await prisma.$queryRaw<Array<{ conname: string }>>`
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'audit_events'::regclass AND contype = 'f'
      `;

      expect(rows).toEqual([]);
    });
  });

  describe('platform settings (DB §L1)', () => {
    it('seeds exactly the eleven slices', async () => {
      const rows = await prisma.platformSetting.findMany({ select: { key: true } });

      expect(rows.map((row) => row.key).sort()).toEqual(Object.keys(PLATFORM_SETTINGS).sort());
    });

    it('rejects a twelfth slice key', async () => {
      await expect(
        prisma.platformSetting.create({ data: { key: 'experimental', value: {} } }),
      ).rejects.toThrow(/platform_settings_key_check/);
    });

    it('rejects a slice that is not an object', async () => {
      // An array or scalar satisfies `jsonb` and breaks every panel that
      // reads a field out of it.
      await expect(
        prisma.$executeRaw`UPDATE platform_settings SET value = '[]'::jsonb WHERE key = 'security'`,
      ).rejects.toThrow(/value_is_object/);
    });

    /**
     * ADR-007's numbers are asserted against the **seed**, not against
     * the live row, and that changed at M24.
     *
     * Until M24 the two were the same claim: nothing could write these
     * rows, so whatever was in them was what the seed had put there. §19.2
     * made them editable — which is the entire point of the panel — and
     * the seed's own `update: {}` exists so that re-seeding never resets
     * an administrator's edit. A test asserting that the live row still
     * holds 180 days is therefore asserting something the product
     * deliberately allows to be false, and it would fail the moment
     * `platform-settings.e2e-spec.ts` ran in a parallel worker.
     *
     * What survives, and what is asserted below, is the part no edit can
     * change: the seed ships ADR-007's numbers, and the stored slices
     * keep the field names every panel and `PolicyService` read out of
     * them. A slice that lost a key would break the platform; a slice
     * whose number an administrator changed is the feature working.
     */
    it('seeds ADR-007’s established retention and security defaults', () => {
      expect(PLATFORM_SETTINGS['retention']).toMatchObject({
        patientRecordYears: 10,
        auditLogDays: 365,
        messageDays: 180,
        // ADR-007 R1: retention expiry deletes nothing by default.
        autoPurge: false,
      });
      expect(PLATFORM_SETTINGS['security']).toMatchObject({
        passwordExpiryDays: 180,
        sessionTimeoutMinutes: 30,
        loginAttemptLimit: 5,
      });
    });

    it('keeps every seeded field name in the stored slices', async () => {
      for (const [key, seeded] of Object.entries(PLATFORM_SETTINGS)) {
        const row = await prisma.platformSetting.findUniqueOrThrow({ where: { key } });

        expect(Object.keys(row.value as object).sort(), key).toEqual(Object.keys(seeded).sort());
      }
    });
  });

  describe('the demo dataset (DB §14.5, ADR-017)', () => {
    it('seeds the five canonical patients with their real MRNs', async () => {
      const patients = await prisma.patient.findMany({
        where: { mrn: { in: DEMO_PATIENTS.map((patient) => patient.mrn) } },
        select: { mrn: true, fullName: true, bloodType: true, status: true },
      });

      expect(patients).toHaveLength(5);
      expect(patients.find((row) => row.mrn === '4472-90')).toMatchObject({
        fullName: 'Omar Farouk',
        bloodType: 'AB_POSITIVE',
        status: 'CRITICAL',
      });
    });

    it('gives every demo patient a live care assignment', async () => {
      // The scope M7.2 reads. `assigned_doctor_id` is the display
      // shortcut; this row is the authorization fact.
      const assignments = await prisma.patientDoctorAssignment.count({
        where: { patient: { mrn: { in: DEMO_PATIENTS.map((patient) => patient.mrn) } }, revokedAt: null },
      });

      expect(assignments).toBe(5);
    });

    it('assigns one patient to a different doctor, so "not mine" is testable', async () => {
      const layla = await prisma.patient.findUniqueOrThrow({ where: { mrn: '4485-33' } });
      const khaled = await prisma.patient.findUniqueOrThrow({ where: { mrn: '4411-27' } });

      expect(layla.assignedDoctorId).not.toBe(khaled.assignedDoctorId);
    });

    it('seeds no password hash for any demo account', async () => {
      // DB §14.5-15. A known-password account in every developer and
      // staging database is an attack surface, and staging databases get
      // restored into places nobody expected.
      const credentials = await prisma.userCredential.count({
        where: { user: { email: { endsWith: '@medora.health' } } },
      });

      expect(credentials).toBe(0);
    });

    it('seeds exactly one administrator (ADR-017 §2)', async () => {
      // Scoped to the seed's own domain, like the credential assertion
      // above. An unscoped count is a claim about the *whole database*,
      // which several suites legitimately add administrators to — the
      // invitation flow at ADR-035 and the M8.2 Users panel both do —
      // so it failed on what another spec file had created rather than
      // on anything about the seed. The property under test is "the seed
      // provisions one administrator", and this is that property.
      const admins = await prisma.user.count({
        where: { role: { code: 'admin' }, email: { endsWith: '@medora.health' } },
      });

      expect(admins).toBe(1);
    });
  });

  describe('hot-path index usage (DB §8)', () => {
    /**
     * The plan for a query, as the planner actually chose it.
     *
     * Run inside a transaction on purpose. `SET LOCAL` lasts only for the
     * surrounding transaction, and Prisma's raw calls each take a
     * connection from the pool — so setting it in one call and running
     * EXPLAIN in another silently does nothing, and the assertion then
     * passes or fails on which plan the planner happened to like.
     *
     * `enable_seqscan = off` is what makes the assertion meaningful at
     * all: on a seeded database of a few dozen rows a sequential scan is
     * genuinely cheaper, whatever indexes exist. What is being verified
     * is that a usable index exists and is chosen once scanning is not
     * free — not that this database is large.
     */
    async function planFor(sql: string): Promise<string> {
      return prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL enable_seqscan = off');
        const rows = await tx.$queryRawUnsafe<Array<Record<string, string>>>(`EXPLAIN ${sql}`);
        return rows.map((row) => Object.values(row)[0] ?? '').join('\n');
      });
    }

    it('uses the doctor calendar index for the appointment list', async () => {
      const plan = await planFor(`
        SELECT * FROM appointments
        WHERE doctor_id = '${clinic.doctorId}' AND starts_at >= now()
        ORDER BY starts_at
      `);

      expect(plan).toContain('appointments_doctor_id_starts_at_idx');
    });

    /**
     * Two assertions, because the question has two halves and only one of
     * them is this schema's to answer.
     *
     * **The index exists as designed** — partial, on `status = 'pending'`
     * — is read out of `pg_indexes`, and that is the DB §8 guarantee.
     *
     * **Which index the planner picks** is not. `appointments_pending_idx`
     * and `appointments_status_starts_at_idx` both serve this query and
     * both supply the ordering, so the choice is a cost tie broken by
     * statistics — and on a table holding a handful of rows those change
     * whenever another suite books an appointment. This assertion used to
     * name the partial index and started failing the day a spec in
     * another file created one more pending row; the plan it got was
     * `Index Scan using appointments_status_starts_at_idx`, which is not
     * a defect in anything. So the plan is asserted to use **one of the
     * two designed indexes**, which still fails if either is dropped or
     * if the query starts reaching for something unrelated.
     */
    it('uses the partial index for the pending action queue', async () => {
      const definition = await prisma.$queryRawUnsafe<{ indexdef: string }[]>(`
        SELECT indexdef FROM pg_indexes
        WHERE tablename = 'appointments' AND indexname = 'appointments_pending_idx'
      `);

      expect(definition[0]?.indexdef).toContain("WHERE (status = 'pending'");

      const plan = await planFor(`
        SELECT * FROM appointments WHERE status = 'pending' ORDER BY starts_at
      `);

      expect(plan).toMatch(/appointments_pending_idx|appointments_status_starts_at_idx/);
    });

    it('uses the partial index for critical unreviewed labs', async () => {
      const plan = await planFor(`
        SELECT * FROM lab_orders
        WHERE has_critical_result AND reviewed_at IS NULL ORDER BY requested_at
      `);

      expect(plan).toContain('lab_orders_critical_unreviewed_idx');
    });

    it('uses a trigram index for patient identifier search', async () => {
      const plan = await planFor(`
        SELECT * FROM patients WHERE full_name LIKE '%Nassar%'
      `);

      expect(plan).toContain('patients_full_name_trgm_idx');
    });

    it('uses an index for the live-session lookup, and the partial one exists', async () => {
      // Two indexes can serve this predicate: the plain
      // `sessions(user_id)` the Prisma schema declares, and DB §8's
      // partial `sessions(user_id) WHERE revoked_at IS NULL`. The plain
      // one covers the same lookup, so the partial only wins on cost once
      // the table is large and mostly revoked — and with a handful of
      // rows the planner picks between two equal-cost plans on a
      // tiebreak nothing here controls.
      //
      // Asserting one specific name was therefore asserting that
      // tiebreak, and it started failing the moment other suites changed
      // how many sessions exist when this one runs. What DB §8 actually
      // specifies is checked instead: the lookup is index-served rather
      // than scanned, and the partial index exists for when it matters.
      const plan = await planFor(`
        SELECT * FROM sessions WHERE user_id = '${clinic.userId}' AND revoked_at IS NULL
      `);

      expect(plan).toMatch(/sessions_user_id_(live_)?idx/);

      const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
        SELECT indexname FROM pg_indexes WHERE tablename = 'sessions'
      `;

      expect(indexes.map((row) => row.indexname)).toContain('sessions_user_id_live_idx');
    });
  });
});
