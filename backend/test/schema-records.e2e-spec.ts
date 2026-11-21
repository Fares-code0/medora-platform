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
 * The M5.7 verification — medical records (DB §D, §S6).
 *
 * Verify: partial unique index — a second `isPrimary` diagnosis on one
 * record fails.
 *
 * Two structural properties are tested beside it, because both are
 * claims the schema *shape* makes and neither is obvious from a model:
 *
 *   · a record documents what was known **then** — `record_allergies`
 *     snapshots rather than joining the live list (DB §D6)
 *   · a vital sign belongs to the patient, not the encounter, so losing
 *     the record must not lose the reading
 */
describe('medical records (RM M5.7)', () => {
  let prisma: PrismaService;
  let clinic: ClinicFixture;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();

    clinic = await createClinicFixture(prisma, 'records');
  });

  afterAll(async () => {
    await prisma.patientVitalSign.deleteMany({ where: { patientId: clinic.patientId } });
    await prisma.medicalRecord.deleteMany({ where: { patientId: clinic.patientId } });
    await destroyClinicFixture(prisma, clinic);
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.patientVitalSign.deleteMany({ where: { patientId: clinic.patientId } });
    await prisma.medicalRecord.deleteMany({ where: { patientId: clinic.patientId } });
  });

  let counter = 0;
  async function createRecord(overrides: Record<string, unknown> = {}) {
    counter += 1;
    return prisma.medicalRecord.create({
      data: {
        publicId: `MR-${String(10000 + counter)}`,
        patientId: clinic.patientId,
        doctorId: clinic.doctorId,
        departmentId: clinic.departmentId,
        visitDate: new Date('2026-08-01T10:00:00Z'),
        visitType: 'Consultation',
        chiefComplaint: 'Chest tightness on exertion',
        historyOfPresentIllness: 'Three weeks of exertional discomfort.',
        physicalExamination: 'Unremarkable at rest.',
        ...overrides,
      },
    });
  }

  describe('one primary diagnosis per record (DB §8)', () => {
    it('rejects a second primary diagnosis on one record', async () => {
      const record = await createRecord();
      const [diabetes, hypertension] = await Promise.all([
        prisma.icdCode.findUniqueOrThrow({ where: { code: 'E11.9' } }),
        prisma.icdCode.findUniqueOrThrow({ where: { code: 'I10' } }),
      ]);

      await prisma.recordDiagnosis.create({
        data: { recordId: record.id, icdCodeId: diabetes.id, isPrimary: true },
      });

      // A record with two primaries has no answer to "what was this visit
      // for" — the question every summary line and rollup asks of it.
      await expect(
        prisma.recordDiagnosis.create({
          data: { recordId: record.id, icdCodeId: hypertension.id, isPrimary: true },
        }),
      ).rejects.toThrow();
    });

    it('allows any number of secondary diagnoses alongside it', async () => {
      const record = await createRecord();
      const codes = await prisma.icdCode.findMany({
        where: { code: { in: ['E11.9', 'I10', 'J45.909', 'N18.3'] } },
      });

      await prisma.recordDiagnosis.create({
        data: { recordId: record.id, icdCodeId: codes[0]?.id ?? '', isPrimary: true },
      });
      for (const code of codes.slice(1)) {
        await prisma.recordDiagnosis.create({
          data: { recordId: record.id, icdCodeId: code.id },
        });
      }

      expect(await prisma.recordDiagnosis.count({ where: { recordId: record.id } })).toBe(4);
    });

    it('lets a different record have its own primary', async () => {
      // The constraint is per record, not global.
      const [first, second] = [await createRecord(), await createRecord()];
      const diabetes = await prisma.icdCode.findUniqueOrThrow({ where: { code: 'E11.9' } });

      await prisma.recordDiagnosis.create({
        data: { recordId: first.id, icdCodeId: diabetes.id, isPrimary: true },
      });
      const other = await prisma.recordDiagnosis.create({
        data: { recordId: second.id, icdCodeId: diabetes.id, isPrimary: true },
      });

      expect(other.isPrimary).toBe(true);
    });

    it('rejects the same ICD code twice on one record', async () => {
      const record = await createRecord();
      const diabetes = await prisma.icdCode.findUniqueOrThrow({ where: { code: 'E11.9' } });

      await prisma.recordDiagnosis.create({
        data: { recordId: record.id, icdCodeId: diabetes.id, isPrimary: true },
      });

      await expect(
        prisma.recordDiagnosis.create({ data: { recordId: record.id, icdCodeId: diabetes.id } }),
      ).rejects.toThrow();
    });

    it('refuses to drop an ICD code that a record still cites', async () => {
      // RESTRICT: a diagnosis whose concept vanished is unreadable.
      const record = await createRecord();
      const diabetes = await prisma.icdCode.findUniqueOrThrow({ where: { code: 'E11.9' } });
      await prisma.recordDiagnosis.create({
        data: { recordId: record.id, icdCodeId: diabetes.id, isPrimary: true },
      });

      await expect(prisma.icdCode.delete({ where: { id: diabetes.id } })).rejects.toThrow();
    });
  });

  describe('the record as an immutable document (DB §D6)', () => {
    it('snapshots allergies rather than joining the live list', async () => {
      // If the record pointed at `patient_allergies`, correcting a
      // severity next year would silently rewrite last year's note.
      const record = await createRecord();

      await prisma.recordAllergy.create({
        data: {
          recordId: record.id,
          allergen: 'Penicillin',
          severity: 'SEVERE',
          reaction: 'Anaphylaxis',
        },
      });

      const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
        SELECT column_name FROM information_schema.columns
        WHERE table_name = 'record_allergies' AND column_name = 'patient_allergy_id'
      `;

      expect(columns).toEqual([]);

      const stored = await prisma.recordAllergy.findFirstOrThrow({
        where: { recordId: record.id },
      });
      expect(stored.severity).toBe('SEVERE');
    });

    it('keeps the plan ordered explicitly, not by insertion', async () => {
      const record = await createRecord();

      await prisma.recordTreatmentPlanItem.create({
        data: { recordId: record.id, position: 1, text: 'Start atorvastatin 20 mg nightly.' },
      });
      await prisma.recordTreatmentPlanItem.create({
        data: { recordId: record.id, position: 0, text: 'Order a lipid panel.' },
      });

      const plan = await prisma.recordTreatmentPlanItem.findMany({
        where: { recordId: record.id },
        orderBy: { position: 'asc' },
      });

      expect(plan.map((item) => item.text)).toEqual([
        'Order a lipid panel.',
        'Start atorvastatin 20 mg nightly.',
      ]);
    });

    it('rejects two plan items claiming the same position', async () => {
      const record = await createRecord();
      await prisma.recordTreatmentPlanItem.create({
        data: { recordId: record.id, position: 0, text: 'First' },
      });

      await expect(
        prisma.recordTreatmentPlanItem.create({
          data: { recordId: record.id, position: 0, text: 'Also first' },
        }),
      ).rejects.toThrow();
    });
  });

  describe('signature and lifecycle constraints', () => {
    it('ties a note’s signature flag to its timestamp, both ways', async () => {
      // `signed` gates a record from draft to final. A note claiming to
      // be signed with no timestamp has no attribution in time; one with
      // a timestamp but flagged unsigned sits in the action queue forever.
      const record = await createRecord();
      const base = {
        recordId: record.id,
        authorId: clinic.userId,
        title: 'Follow-up plan',
        body: 'Reviewed and discussed.',
      };

      await expect(
        prisma.recordNote.create({ data: { ...base, signed: true } }),
      ).rejects.toThrow(/record_notes_signed_at_iff_signed/);

      await expect(
        prisma.recordNote.create({ data: { ...base, signedAt: new Date() } }),
      ).rejects.toThrow(/record_notes_signed_at_iff_signed/);

      const ok = await prisma.recordNote.create({
        data: { ...base, signed: true, signedAt: new Date() },
      });
      expect(ok.signed).toBe(true);
    });

    it('refuses a follow-up scheduled before the visit', async () => {
      await expect(
        createRecord({ followUpDate: new Date('2026-07-01') }),
      ).rejects.toThrow(/medical_records_follow_up_after_visit/);
    });

    it('requires the MR- prefix', async () => {
      await expect(createRecord({ publicId: '10001' })).rejects.toThrow(
        /medical_records_public_id_prefix/,
      );
    });

    it('ties an issue report’s resolution to its timestamp', async () => {
      const record = await createRecord();

      await expect(
        prisma.recordIssueReport.create({
          data: { recordId: record.id, description: 'Wrong patient.', status: 'resolved' },
        }),
      ).rejects.toThrow(/resolved_at_iff_resolved/);

      const open = await prisma.recordIssueReport.create({
        data: { recordId: record.id, description: 'Wrong patient.' },
      });
      expect(open.status).toBe('open');
      expect(open.resolvedAt).toBeNull();
    });
  });

  describe('deletion policy (DB §7, §9)', () => {
    it('never hard-deletes — every record table carries deleted_at', async () => {
      // UX §1.5.3 and DB §7 both make soft delete mandatory here.
      const tables = [
        'medical_records',
        'record_treatment_plan_items',
        'record_medications',
        'record_allergies',
        'record_notes',
        'record_attachments',
      ];

      const rows = await prisma.$queryRaw<Array<{ table_name: string }>>`
        SELECT table_name FROM information_schema.columns
        WHERE column_name = 'deleted_at' AND table_name = ANY(${tables})
      `;

      expect(rows.map((row) => row.table_name).sort()).toEqual([...tables].sort());
    });

    it('hides a soft-deleted record from ordinary reads', async () => {
      const record = await createRecord();
      await prisma.medicalRecord.update({
        where: { id: record.id },
        data: { deletedAt: new Date() },
      });

      expect(await prisma.db.medicalRecord.findFirst({ where: { id: record.id } })).toBeNull();
      expect(await prisma.medicalRecord.findFirst({ where: { id: record.id } })).not.toBeNull();
    });

    it('refuses to delete a patient who has records — RESTRICT', async () => {
      await createRecord();

      await expect(prisma.patient.delete({ where: { id: clinic.patientId } })).rejects.toThrow();
    });

    it('keeps a vital sign when its encounter goes — SET NULL', async () => {
      // The reading belongs to the patient, not the encounter. DB §D3
      // makes `record_id` an optional link on the shared B11 table, so
      // losing the record must not lose the observation.
      const record = await createRecord();
      const vital = await prisma.patientVitalSign.create({
        data: {
          patientId: clinic.patientId,
          recordId: record.id,
          bloodPressureSystolic: 128,
          bloodPressureDiastolic: 82,
          heartRateBpm: 76,
          temperatureC: 36.8,
          respiratoryRate: 16,
          oxygenSaturation: 98,
          weightKg: 84,
          heightCm: 178,
        },
      });

      await prisma.medicalRecord.delete({ where: { id: record.id } });

      const survivor = await prisma.patientVitalSign.findUniqueOrThrow({ where: { id: vital.id } });
      expect(survivor.recordId).toBeNull();
      expect(survivor.bloodPressureSystolic).toBe(128);
    });

    it('takes the record’s own children with it — CASCADE', async () => {
      const record = await createRecord();
      await prisma.recordTimelineEvent.create({
        data: { recordId: record.id, kind: 'CREATED', actorName: 'Dr. Amelia Chen' },
      });

      await prisma.medicalRecord.delete({ where: { id: record.id } });

      expect(await prisma.recordTimelineEvent.count({ where: { recordId: record.id } })).toBe(0);
    });
  });
});
