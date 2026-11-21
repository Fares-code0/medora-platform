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
 * The M5.8 verification — labs and pharmacy (DB §E, §F).
 *
 * Verify: `refills_remaining BETWEEN 0 AND refills_allowed` CHECK proven.
 *
 * That constraint has the most direct clinical consequence in the file:
 * a remaining count above the allowance dispenses medication nobody
 * authorized, and a negative one compares below every threshold, so the
 * refill sweep of RM M13.5 would never see it again.
 */
describe('labs and pharmacy (RM M5.8)', () => {
  let prisma: PrismaService;
  let clinic: ClinicFixture;
  let medicationId: string;
  let testId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule, DatabaseModule],
    }).compile();

    prisma = moduleRef.get(PrismaService);
    await prisma.$connect();

    clinic = await createClinicFixture(prisma, 'labsrx');
    medicationId = (
      await prisma.medication.findFirstOrThrow({ where: { genericName: 'Atorvastatin' } })
    ).id;
    testId = (await prisma.labTestCatalogue.findUniqueOrThrow({ where: { code: '58410-2' } })).id;
  });

  afterAll(async () => {
    await prisma.prescription.deleteMany({ where: { patientId: clinic.patientId } });
    await prisma.labOrder.deleteMany({ where: { patientId: clinic.patientId } });
    await destroyClinicFixture(prisma, clinic);
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.patientMedication.deleteMany({ where: { patientId: clinic.patientId } });
    await prisma.prescription.deleteMany({ where: { patientId: clinic.patientId } });
    await prisma.labOrder.deleteMany({ where: { patientId: clinic.patientId } });
  });

  let counter = 0;
  function rx(overrides: Record<string, unknown> = {}) {
    counter += 1;
    return {
      publicId: `RX-${String(200000 + counter)}`,
      patientId: clinic.patientId,
      medicationId,
      prescribingDoctorId: clinic.doctorId,
      strength: '20 mg',
      dosage: '1 tablet',
      frequency: 'Once daily at night',
      route: 'ORAL' as const,
      durationDays: 30,
      quantity: 30,
      instructions: 'Take with food.',
      startDate: new Date('2026-08-01'),
      endDate: new Date('2026-08-31'),
      ...overrides,
    };
  }

  function labOrder(overrides: Record<string, unknown> = {}) {
    counter += 1;
    return {
      publicId: `LAB-${String(100000 + counter)}`,
      patientId: clinic.patientId,
      testId,
      orderedBy: clinic.doctorId,
      clinicalIndication: 'Monitor renal function',
      ...overrides,
    };
  }

  describe('refills (DB §9) — the constraint M5.8 verifies', () => {
    it('rejects more remaining refills than were allowed', async () => {
      // Dispensing medication nobody authorized.
      await expect(
        prisma.prescription.create({ data: rx({ refillsAllowed: 2, refillsRemaining: 3 }) }),
      ).rejects.toThrow(/refills_remaining_within_allowed/);
    });

    it('rejects a negative remaining count', async () => {
      // A negative count compares below every threshold, so the refill
      // sweep would never surface it again.
      await expect(
        prisma.prescription.create({ data: rx({ refillsAllowed: 2, refillsRemaining: -1 }) }),
      ).rejects.toThrow(/refills_remaining_within_allowed/);
    });

    it('rejects a negative allowance', async () => {
      await expect(
        prisma.prescription.create({ data: rx({ refillsAllowed: -1 }) }),
      ).rejects.toThrow(/refills_allowed_non_negative/);
    });

    it('accepts both boundaries — none left, and all of them', async () => {
      const exhausted = await prisma.prescription.create({
        data: rx({ refillsAllowed: 3, refillsRemaining: 0 }),
      });
      const untouched = await prisma.prescription.create({
        data: rx({ refillsAllowed: 3, refillsRemaining: 3 }),
      });

      expect(exhausted.refillsRemaining).toBe(0);
      expect(untouched.refillsRemaining).toBe(3);
    });

    it('stops a decrement from going below zero', async () => {
      const prescription = await prisma.prescription.create({
        data: rx({ refillsAllowed: 1, refillsRemaining: 0 }),
      });

      await expect(
        prisma.prescription.update({
          where: { id: prescription.id },
          data: { refillsRemaining: { decrement: 1 } },
        }),
      ).rejects.toThrow(/refills_remaining_within_allowed/);
    });
  });

  describe('the prescription lifecycle (ADR-002)', () => {
    it('creates a draft, not a pending approval', async () => {
      // ADR-002 §1 makes `draft` the creation state, and it is what makes
      // API §7.7's fail-closed rule expressible: a prescription whose
      // safety check could not run stays in draft.
      const prescription = await prisma.prescription.create({ data: rx() });

      expect(prescription.status).toBe('DRAFT');
      expect(prescription.signedAt).toBeNull();
      expect(prescription.refillStatus).toBe('NONE');
    });

    it('stores the seven ADR-002 values verbatim, draft and dispensed included', async () => {
      const dispensed = await prisma.prescription.create({
        data: rx({ status: 'DISPENSED', signedAt: new Date() }),
      });

      const [stored] = await prisma.$queryRaw<Array<{ status: string }>>`
        SELECT status::text FROM prescriptions WHERE id = ${dispensed.id}::uuid
      `;
      expect(stored?.status).toBe('dispensed');
    });

    it('refuses a draft that carries a signature', async () => {
      // A draft has not been prescribed by anyone.
      await expect(
        prisma.prescription.create({ data: rx({ signedAt: new Date() }) }),
      ).rejects.toThrow(/prescriptions_signed_at_matches_status/);
    });

    it('refuses an active prescription with no signature', async () => {
      // Every status past draft is reached through `POST …/sign`.
      await expect(prisma.prescription.create({ data: rx({ status: 'ACTIVE' }) })).rejects.toThrow(
        /prescriptions_signed_at_matches_status/,
      );
    });

    it('treats pending-approval as signed, per ADR-002’s lifecycle', async () => {
      // ADR-002 reaches `pending-approval` from `draft` via `/sign` when
      // the medication is controlled — so it is a signed prescription
      // awaiting a second decision, not an unsigned one.
      const controlled = await prisma.prescription.create({
        data: rx({ status: 'PENDING_APPROVAL', signedAt: new Date() }),
      });

      expect(controlled.status).toBe('PENDING_APPROVAL');
    });

    it('refuses to discontinue without a reason', async () => {
      // ADR-002 §4: `/cancel` and `/discontinue` both resolve here, and
      // the distinction survives only in the audit event and this reason.
      await expect(
        prisma.prescription.create({ data: rx({ status: 'DISCONTINUED', signedAt: new Date() }) }),
      ).rejects.toThrow(/prescriptions_discontinued_reason_required/);
    });

    it('rejects a course that ends before it starts', async () => {
      await expect(
        prisma.prescription.create({
          data: rx({ startDate: new Date('2026-08-31'), endDate: new Date('2026-08-01') }),
        }),
      ).rejects.toThrow(/prescriptions_end_after_start/);
    });

    it('rejects a zero quantity or a zero-day course', async () => {
      await expect(prisma.prescription.create({ data: rx({ quantity: 0 }) })).rejects.toThrow(
        /prescriptions_quantity_positive/,
      );
      await expect(prisma.prescription.create({ data: rx({ durationDays: 0 }) })).rejects.toThrow(
        /prescriptions_duration_positive/,
      );
    });
  });

  describe('safety warnings (DB §F4, API §7.7)', () => {
    it('refuses an acknowledgment with no reason', async () => {
      const prescription = await prisma.prescription.create({ data: rx() });

      await expect(
        prisma.prescriptionSafetyWarning.create({
          data: {
            prescriptionId: prescription.id,
            kind: 'INTERACTION',
            severity: 'CRITICAL',
            title: 'Warfarin × NSAID',
            detail: 'Bleeding risk.',
            acknowledgedBy: clinic.userId,
            acknowledgedAt: new Date(),
          },
        }),
      ).rejects.toThrow(/acknowledgment_complete/);
    });

    it('accepts an unacknowledged warning and a fully acknowledged one', async () => {
      const prescription = await prisma.prescription.create({ data: rx() });
      const base = {
        prescriptionId: prescription.id,
        kind: 'INTERACTION' as const,
        severity: 'CRITICAL' as const,
        title: 'Warfarin × NSAID',
        detail: 'Bleeding risk.',
      };

      const pending = await prisma.prescriptionSafetyWarning.create({ data: base });
      expect(pending.acknowledgedReason).toBeNull();

      const acknowledged = await prisma.prescriptionSafetyWarning.create({
        data: {
          ...base,
          acknowledgedBy: clinic.userId,
          acknowledgedReason: 'Short course, INR monitored twice weekly.',
          acknowledgedAt: new Date(),
        },
      });
      expect(acknowledged.acknowledgedReason).toContain('INR');
    });
  });

  describe('the lab workflow (DB §E)', () => {
    it('refuses an interpretation before the order is complete', async () => {
      // A draft opinion sitting in a clinical record.
      await expect(
        prisma.labOrder.create({
          data: labOrder({ status: 'PROCESSING', interpretation: 'Mild anaemia.' }),
        }),
      ).rejects.toThrow(/interpretation_requires_completion/);
    });

    it('rejects workflow timestamps out of order', async () => {
      await expect(
        prisma.labOrder.create({
          data: labOrder({
            requestedAt: new Date('2026-08-02T10:00:00Z'),
            collectedAt: new Date('2026-08-01T10:00:00Z'),
          }),
        }),
      ).rejects.toThrow(/collected_after_requested/);
    });

    it('ties a review to its reviewer, both ways', async () => {
      // UX 2.6 makes "Mark reviewed" the required workflow for critical
      // results; an unattributed review is not evidence anyone looked.
      await expect(
        prisma.labOrder.create({ data: labOrder({ reviewedAt: new Date() }) }),
      ).rejects.toThrow(/reviewed_by_iff_reviewed/);

      await expect(
        prisma.labOrder.create({ data: labOrder({ reviewedBy: clinic.userId }) }),
      ).rejects.toThrow(/reviewed_by_iff_reviewed/);
    });

    it('snapshots the reference range onto the result', async () => {
      // A range revised next year must not retroactively change whether
      // last year's result was flagged abnormal.
      const order = await prisma.labOrder.create({ data: labOrder() });
      const spec = await prisma.labAnalyteSpec.findFirstOrThrow({
        where: { test: { code: '58410-2' }, analyte: 'Hemoglobin' },
      });

      const result = await prisma.labResult.create({
        data: {
          labOrderId: order.id,
          analyteSpecId: spec.id,
          analyte: 'Hemoglobin',
          valueText: '13.2',
          valueNumeric: 13.2,
          unit: 'g/dL',
          refLow: 12,
          refHigh: 17,
          refText: '12–17',
        },
      });

      expect(Number(result.refLow)).toBe(12);
      expect(result.flag).toBe('NORMAL');
    });

    it('refuses a range-based flag with no comparable value', async () => {
      // A flag nothing computed.
      const order = await prisma.labOrder.create({ data: labOrder() });

      await expect(
        prisma.labResult.create({
          data: {
            labOrderId: order.id,
            analyte: 'Hemoglobin',
            valueText: 'Negative',
            unit: 'g/dL',
            refText: '12–17',
            flag: 'CRITICAL_LOW',
          },
        }),
      ).rejects.toThrow(/numeric_flag_needs_value/);
    });

    it('allows a qualitative result with no numeric value', async () => {
      const order = await prisma.labOrder.create({ data: labOrder() });

      const result = await prisma.labResult.create({
        data: {
          labOrderId: order.id,
          analyte: 'Sickling screen',
          valueText: 'Negative',
          unit: '',
          refText: 'Negative',
          flag: 'NORMAL',
        },
      });

      expect(result.valueNumeric).toBeNull();
    });

    it('refuses a specimen received before it was collected', async () => {
      const order = await prisma.labOrder.create({ data: labOrder() });

      await expect(
        prisma.labSpecimen.create({
          data: {
            labOrderId: order.id,
            type: 'WHOLE_BLOOD',
            container: 'EDTA (lavender top)',
            collectionSite: 'Left antecubital',
            collectedBy: 'Nurse Salma Ibrahim',
            collectedAt: new Date('2026-08-02T10:00:00Z'),
            receivedAt: new Date('2026-08-01T10:00:00Z'),
            volume: '5 mL',
          },
        }),
      ).rejects.toThrow(/received_after_collected/);
    });

    it('keeps the collector’s name when the account goes', async () => {
      // ADR-003 §4 — the chain of custody has to stay readable.
      const order = await prisma.labOrder.create({ data: labOrder() });
      const specimen = await prisma.labSpecimen.create({
        data: {
          labOrderId: order.id,
          type: 'WHOLE_BLOOD',
          container: 'EDTA (lavender top)',
          collectionSite: 'Left antecubital',
          collectedBy: 'Nurse Salma Ibrahim',
          collectedById: clinic.userId,
          collectedAt: new Date('2026-08-01T10:00:00Z'),
          volume: '5 mL',
        },
      });

      expect(specimen.collectedBy).toBe('Nurse Salma Ibrahim');
      expect(specimen.collectedById).toBe(clinic.userId);
    });
  });

  describe('the cross-domain FKs closed here', () => {
    it('keeps an externally reported medication when its Rx goes', async () => {
      // `patient_medications.prescription_id` is SET NULL: a
      // self-reported drug has no Rx at all, and losing the Rx must not
      // remove the drug from the safety screen's input.
      const prescription = await prisma.prescription.create({ data: rx() });
      const entry = await prisma.patientMedication.create({
        data: {
          patientId: clinic.patientId,
          prescriptionId: prescription.id,
          name: 'Atorvastatin',
          dosage: '20 mg',
          frequency: 'Once daily at night',
          startDate: new Date('2026-08-01'),
        },
      });

      await prisma.prescription.delete({ where: { id: prescription.id } });

      const survivor = await prisma.patientMedication.findUniqueOrThrow({ where: { id: entry.id } });
      expect(survivor.prescriptionId).toBeNull();
      expect(survivor.name).toBe('Atorvastatin');
    });

    it('refuses to delete a medication the formulary still prescribes — RESTRICT', async () => {
      await prisma.prescription.create({ data: rx() });

      await expect(prisma.medication.delete({ where: { id: medicationId } })).rejects.toThrow();
    });
  });
});
