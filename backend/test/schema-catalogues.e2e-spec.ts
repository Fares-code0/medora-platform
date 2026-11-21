import { Test } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ConfigModule } from '../src/config';
import { DatabaseModule, PrismaService } from '../src/shared/database';
import { DRUG_INTERACTIONS, LAB_TESTS, MEDICATIONS } from '../prisma/seed/catalogues';

/**
 * The M5.5 verification — clinical catalogues (DB §E1–E2, §F1–F2, §H4).
 *
 * The verify step is "seed loads the 5 lab tests + 5 medications from the
 * frontend catalogues", so these tests check the *content* against the
 * transcription, not merely the row counts: a reference range that seeds
 * as null is a range no result can ever be flagged against, and it would
 * pass a count.
 */
describe('clinical catalogues (RM M5.5)', () => {
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

  describe('the lab catalogue', () => {
    it('seeds the five tests with their LOINC codes', async () => {
      const tests = await prisma.labTestCatalogue.findMany({ select: { code: true } });

      expect(tests.map((test) => test.code).sort()).toEqual(
        LAB_TESTS.map((test) => test.code).sort(),
      );
    });

    it('seeds every analyte with its reference range intact', async () => {
      const cbc = await prisma.labTestCatalogue.findUniqueOrThrow({
        where: { code: '58410-2' },
        include: { analytes: true },
      });

      expect(cbc.analytes).toHaveLength(5);

      const haemoglobin = cbc.analytes.find((row) => row.analyte === 'Hemoglobin');
      expect(haemoglobin).toBeDefined();
      expect(Number(haemoglobin?.refLow)).toBe(12);
      expect(Number(haemoglobin?.refHigh)).toBe(17);
      expect(Number(haemoglobin?.criticalLow)).toBe(7);
      expect(Number(haemoglobin?.criticalHigh)).toBe(20);
      expect(haemoglobin?.unit).toBe('g/dL');
    });

    it('keeps critical thresholds outside the reference range', async () => {
      // The rule that makes a critical flag mean something. A critical_low
      // above ref_low would mark ordinary results critical and bury the
      // real ones in the "Critical unreviewed: N" chip.
      const cbc = await prisma.labTestCatalogue.findUniqueOrThrow({ where: { code: '58410-2' } });

      await expect(
        prisma.labAnalyteSpec.create({
          data: {
            testId: cbc.id,
            analyte: 'Nonsense',
            unit: 'g/dL',
            refLow: 12,
            refHigh: 17,
            criticalLow: 14,
          },
        }),
      ).rejects.toThrow(/critical_low_below_ref/);

      await expect(
        prisma.labAnalyteSpec.create({
          data: {
            testId: cbc.id,
            analyte: 'Nonsense',
            unit: 'g/dL',
            refLow: 12,
            refHigh: 17,
            criticalHigh: 15,
          },
        }),
      ).rejects.toThrow(/critical_high_above_ref/);
    });

    it('refuses an analyte that is neither numeric nor qualitative', async () => {
      // Such an analyte can never be flagged: nothing contradicts any
      // value, so every result renders as normal.
      const cbc = await prisma.labTestCatalogue.findUniqueOrThrow({ where: { code: '58410-2' } });

      await expect(
        prisma.labAnalyteSpec.create({
          data: { testId: cbc.id, analyte: 'Unflaggable', unit: 'g/dL' },
        }),
      ).rejects.toThrow(/range_or_options/);

      const qualitative = await prisma.labAnalyteSpec.create({
        data: {
          testId: cbc.id,
          analyte: 'Sickling screen',
          unit: '',
          qualitativeOptions: ['Negative', 'Positive'],
        },
      });
      expect(qualitative.qualitativeOptions[0]).toBe('Negative');

      await prisma.labAnalyteSpec.delete({ where: { id: qualitative.id } });
    });
  });

  describe('the formulary', () => {
    it('seeds the five medications with their strengths', async () => {
      const medications = await prisma.medication.findMany({ include: { strengths: true } });

      expect(medications.map((row) => row.genericName).sort()).toEqual(
        MEDICATIONS.map((row) => row.genericName).sort(),
      );

      const lipitor = medications.find((row) => row.name === 'Lipitor');
      expect(lipitor?.strengths.map((row) => row.strength).sort()).toEqual(
        ['10 mg', '20 mg', '40 mg', '80 mg'].sort(),
      );
    });

    it('carries the allergy class the safety screen matches on', async () => {
      // API §7.7 gives an allergy conflict no override path, so this
      // column decides whether a prescription can be signed at all.
      const amoxil = await prisma.medication.findFirstOrThrow({
        where: { genericName: 'Amoxicillin' },
      });

      expect(amoxil.allergyClass).toBe('Penicillin');
    });

    it('flags warfarin as high risk', async () => {
      const warfarin = await prisma.medication.findFirstOrThrow({
        where: { genericName: 'Warfarin' },
      });

      expect(warfarin.isHighRisk).toBe(true);
    });
  });

  describe('drug interactions (ADR-010 group 8)', () => {
    it('seeds each pair exactly once', async () => {
      expect(await prisma.drugInteraction.count()).toBe(DRUG_INTERACTIONS.length);
    });

    it('grades severity per pair, which one canned note per drug cannot', async () => {
      const [warfarin, amoxicillin, metformin, levothyroxine] = await Promise.all([
        prisma.medication.findFirstOrThrow({ where: { genericName: 'Warfarin' } }),
        prisma.medication.findFirstOrThrow({ where: { genericName: 'Amoxicillin' } }),
        prisma.medication.findFirstOrThrow({ where: { genericName: 'Metformin' } }),
        prisma.medication.findFirstOrThrow({ where: { genericName: 'Levothyroxine' } }),
      ]);

      const lookup = async (x: string, y: string) => {
        const [a, b] = x < y ? [x, y] : [y, x];
        return prisma.drugInteraction.findUnique({
          where: { medicationAId_medicationBId: { medicationAId: a, medicationBId: b } },
        });
      };

      // The same drug — warfarin — carries different severities depending
      // on what it is paired with. That is the whole reason the table
      // exists: `medications.interaction_note` says one thing about
      // warfarin regardless of the other drug.
      expect((await lookup(warfarin.id, amoxicillin.id))?.severity).toBe('CRITICAL');
      expect((await lookup(warfarin.id, levothyroxine.id))?.severity).toBe('WARNING');
      expect((await lookup(metformin.id, levothyroxine.id))?.severity).toBe('INFO');
    });

    it('refuses to store a pair in the wrong order', async () => {
      // Both directions would be two rows that can disagree about
      // severity, and an interaction screen whose answer depends on
      // argument order is worse than none.
      const [warfarin, metformin] = await Promise.all([
        prisma.medication.findFirstOrThrow({ where: { genericName: 'Warfarin' } }),
        prisma.medication.findFirstOrThrow({ where: { genericName: 'Metformin' } }),
      ]);

      const [low, high] =
        warfarin.id < metformin.id ? [warfarin.id, metformin.id] : [metformin.id, warfarin.id];

      await expect(
        prisma.drugInteraction.create({
          data: {
            medicationAId: high,
            medicationBId: low,
            severity: 'WARNING',
            title: 'Reversed',
            detail: 'Stored the wrong way round.',
          },
        }),
      ).rejects.toThrow(/drug_interactions_pair_ordered/);
    });
  });

  describe('monographs and prompts', () => {
    it('closes the pregnancy category to the five real values', async () => {
      const medication = await prisma.medication.findFirstOrThrow({
        where: { genericName: 'Warfarin' },
      });

      await expect(
        prisma.medicationMonograph.create({
          data: { medicationId: medication.id, pregnancyCategory: 'Z' },
        }),
      ).rejects.toThrow(/pregnancy_category_check/);

      const ok = await prisma.medicationMonograph.create({
        data: {
          medicationId: medication.id,
          pregnancyCategory: 'X',
          contraindications: 'Pregnancy — teratogenic.',
        },
      });
      expect(ok.pregnancyCategory).toBe('X');

      await prisma.medicationMonograph.delete({ where: { medicationId: medication.id } });
    });

    it('seeds the six AI prompt cards with their affinities', async () => {
      const prompts = await prisma.aiPromptTemplate.findMany({ orderBy: { position: 'asc' } });

      expect(prompts).toHaveLength(6);
      expect(prompts[0]?.slug).toBe('summarize-patient');
      expect(prompts[0]?.contextMode).toBe('PATIENT');
    });
  });
});
