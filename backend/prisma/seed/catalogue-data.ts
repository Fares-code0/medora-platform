import type {
  AiContextMode,
  LabSpecimenType,
  LabTestCategory,
  MedicationCategory,
  MedicationForm,
  MedicationRoute,
  PrismaClient,
} from '../../src/generated/prisma/client';

import { AI_PROMPTS, DRUG_INTERACTIONS, LAB_TESTS, MEDICATIONS } from './catalogues';
import { refresh, type SeedMode } from './seed-mode';

/**
 * Seeds the M5.5 catalogues.
 *
 * Idempotent on natural keys throughout: a LOINC code, a (brand, generic)
 * pair, a slug. In `refresh` mode re-running replaces the *content* of a
 * catalogue row — a reference range that was corrected upstream should
 * propagate — but never duplicates one. In `create-only` mode (production)
 * an existing row is left as it is; see `seed-mode.ts`.
 */
export async function seedCatalogues(
  prisma: PrismaClient,
  mode: SeedMode = 'refresh',
): Promise<Record<string, number>> {
  let analyteCount = 0;

  for (const test of LAB_TESTS) {
    const row = await prisma.labTestCatalogue.upsert({
      where: { code: test.code },
      create: {
        name: test.name,
        code: test.code,
        category: test.category as LabTestCategory,
        specimenType: test.specimenType as LabSpecimenType,
        container: test.container,
      },
      update: refresh(mode, {
        name: test.name,
        category: test.category as LabTestCategory,
        specimenType: test.specimenType as LabSpecimenType,
        container: test.container,
      }),
    });

    for (const analyte of test.analytes) {
      await prisma.labAnalyteSpec.upsert({
        where: { testId_analyte: { testId: row.id, analyte: analyte.analyte } },
        create: {
          testId: row.id,
          analyte: analyte.analyte,
          unit: analyte.unit,
          refLow: analyte.refLow,
          refHigh: analyte.refHigh,
          decimals: analyte.decimals ?? 0,
          criticalLow: analyte.criticalLow ?? null,
          criticalHigh: analyte.criticalHigh ?? null,
          qualitativeOptions: [...(analyte.qualitativeOptions ?? [])],
        },
        update: refresh(mode, {
          unit: analyte.unit,
          refLow: analyte.refLow,
          refHigh: analyte.refHigh,
          decimals: analyte.decimals ?? 0,
          criticalLow: analyte.criticalLow ?? null,
          criticalHigh: analyte.criticalHigh ?? null,
        }),
      });
      analyteCount += 1;
    }
  }

  let strengthCount = 0;

  for (const medication of MEDICATIONS) {
    const row = await prisma.medication.upsert({
      where: {
        name_genericName: { name: medication.name, genericName: medication.genericName },
      },
      create: {
        name: medication.name,
        genericName: medication.genericName,
        category: medication.category as MedicationCategory,
        form: medication.form as MedicationForm,
        route: medication.route as MedicationRoute,
        manufacturer: medication.manufacturer,
        isControlled: medication.isControlled,
        isHighRisk: medication.isHighRisk,
        interactionNote: medication.interactionNote,
        allergyClass: medication.allergyClass,
        frequencies: [...medication.frequencies],
        durationsDays: [...medication.durationsDays],
      },
      update: refresh(mode, {
        category: medication.category as MedicationCategory,
        form: medication.form as MedicationForm,
        route: medication.route as MedicationRoute,
        manufacturer: medication.manufacturer,
        isControlled: medication.isControlled,
        isHighRisk: medication.isHighRisk,
        interactionNote: medication.interactionNote,
        allergyClass: medication.allergyClass,
        frequencies: [...medication.frequencies],
        durationsDays: [...medication.durationsDays],
      }),
    });

    for (const [position, strength] of medication.strengths.entries()) {
      await prisma.medicationStrength.upsert({
        where: { medicationId_strength: { medicationId: row.id, strength } },
        create: { medicationId: row.id, strength, position },
        update: refresh(mode, { position }),
      });
      strengthCount += 1;
    }
  }

  for (const interaction of DRUG_INTERACTIONS) {
    const [first, second] = await Promise.all([
      prisma.medication.findFirstOrThrow({ where: { genericName: interaction.a } }),
      prisma.medication.findFirstOrThrow({ where: { genericName: interaction.b } }),
    ]);

    // The pair is stored once, in id order. The constraint
    // `drug_interactions_pair_ordered` requires it, and normalizing here
    // is what makes an interaction lookup independent of which drug the
    // caller happens to name first.
    const [aId, bId] = first.id < second.id ? [first.id, second.id] : [second.id, first.id];

    await prisma.drugInteraction.upsert({
      where: { medicationAId_medicationBId: { medicationAId: aId, medicationBId: bId } },
      create: {
        medicationAId: aId,
        medicationBId: bId,
        severity: interaction.severity,
        title: interaction.title,
        detail: interaction.detail,
        management: interaction.management,
      },
      update: refresh(mode, {
        severity: interaction.severity,
        title: interaction.title,
        detail: interaction.detail,
        management: interaction.management,
      }),
    });
  }

  for (const [position, prompt] of AI_PROMPTS.entries()) {
    await prisma.aiPromptTemplate.upsert({
      where: { slug: prompt.slug },
      create: {
        slug: prompt.slug,
        label: prompt.label,
        description: prompt.description,
        promptText: prompt.promptText,
        contextMode: prompt.contextMode as AiContextMode,
        position,
      },
      update: refresh(mode, {
        label: prompt.label,
        description: prompt.description,
        promptText: prompt.promptText,
        contextMode: prompt.contextMode as AiContextMode,
        position,
      }),
    });
  }

  return {
    labTests: LAB_TESTS.length,
    analytes: analyteCount,
    medications: MEDICATIONS.length,
    strengths: strengthCount,
    interactions: DRUG_INTERACTIONS.length,
    aiPrompts: AI_PROMPTS.length,
  };
}
