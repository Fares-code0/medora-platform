/**
 * Row → DTO for the formulary (API §7.1, §7.2).
 *
 * A pure function with no Prisma import beyond its row types, so the
 * shape the client receives can be asserted without a database — the
 * same split `record-projection.ts` uses.
 */

import {
  medicationCategoryToWire,
  medicationFormToWire,
  medicationRouteToWire,
} from '../dto/pharmacy-enums';
import type { MedicationMonographView, MedicationView } from '../dto/medication.dto';
import type { MedicationRow, MonographRow } from '../repositories/medication.repository';

export function toMedicationView(row: MedicationRow): MedicationView {
  return {
    id: row.id,
    name: row.name,
    genericName: row.genericName,
    category: medicationCategoryToWire(row.category),
    // `medication_strengths.position` orders these in the repository;
    // the projection preserves that order rather than sorting the
    // strings, because "1 g" sorts before "500 mg" alphabetically and
    // the catalogue's own ordering is the clinically sensible one.
    strengths: row.strengths.map((entry) => entry.strength),
    form: medicationFormToWire(row.form),
    route: medicationRouteToWire(row.route),
    manufacturer: row.manufacturer,
    isControlled: row.isControlled,
    isHighRisk: row.isHighRisk,
    interactionNote: row.interactionNote,
    allergyClass: row.allergyClass,
    frequencies: row.frequencies,
    durationsDays: row.durationsDays,
  };
}

export function toMonographView(row: MonographRow): MedicationMonographView {
  return {
    medicationId: row.medicationId,
    name: row.name,
    genericName: row.genericName,
    indications: row.indications,
    contraindications: row.contraindications,
    standardDosing: row.standardDosing,
    pregnancyCategory: row.pregnancyCategory,
    warnings: row.warnings,
    sideEffects: row.sideEffects,
  };
}
