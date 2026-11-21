/**
 * Row → DTO for the test catalogue (API §8.1).
 *
 * Pure, with no Prisma import beyond the row types, so the shape a
 * client receives can be asserted without a database — the same split
 * `medication-projection.ts` and `record-projection.ts` use.
 *
 * ## `Decimal` does not cross this boundary
 *
 * `ref_low`, `critical_high` and their siblings are `DECIMAL(10,3)`, and
 * Prisma hands them over as `Decimal` objects. Serialising one straight
 * to JSON produces `{"s":1,"e":0,"d":[4]}` rather than `4`, which no
 * client can chart. `toNumber` here is the single place that conversion
 * happens, and `AnalyteBounds` — the type the grading module takes — is
 * plain numbers for the same reason: a clinical comparison should not
 * depend on which arbitrary-precision library the ORM shipped this week.
 *
 * The precision loss is nil in practice and worth naming anyway: these
 * are 10-digit values with 3 decimal places, well inside a double's
 * exact-integer range once scaled, so no analyte bound is representable
 * in the column and not in a `number`.
 */

import { labCategoryToWire, labSpecimenTypeToWire } from '../dto/labs-enums';
import type { LabAnalyteSpecView, LabTestCatalogueView } from '../dto/lab-test.dto';
import type { LabAnalyteRow, LabTestRow } from '../repositories/lab-test.repository';

import { referenceTextFor, type AnalyteBounds } from './result-grading';

/**
 * The decimal columns, typed from the row rather than from Prisma's
 * internal namespace — the generated `Decimal` lives behind a path the
 * module-boundary lint has no business teaching every module about, and
 * the row type already names it exactly.
 */
type DecimalColumn = LabAnalyteRow['refLow'];

/** `Decimal | null` → `number | null`, the one place it happens. */
export function toNumber(value: DecimalColumn): number | null {
  return value === null ? null : value.toNumber();
}

/** The bounds the grading module judges a value against. */
export function boundsOf(row: LabAnalyteRow): AnalyteBounds {
  return {
    refLow: toNumber(row.refLow),
    refHigh: toNumber(row.refHigh),
    criticalLow: toNumber(row.criticalLow),
    criticalHigh: toNumber(row.criticalHigh),
    // `decimals` is nullable in the schema with a default of 0; a null
    // one means "no fractional digits", not "unknown precision".
    decimals: row.decimals ?? 0,
    qualitativeOptions: row.qualitativeOptions,
  };
}

export function toAnalyteSpecView(row: LabAnalyteRow): LabAnalyteSpecView {
  const bounds = boundsOf(row);

  return {
    id: row.id,
    analyte: row.analyte,
    unit: row.unit,
    refLow: bounds.refLow,
    refHigh: bounds.refHigh,
    decimals: bounds.decimals,
    criticalLow: bounds.criticalLow,
    criticalHigh: bounds.criticalHigh,
    qualitativeOptions: bounds.qualitativeOptions,
    // Worded by the same function the released result uses, so the
    // preview and the printed range cannot disagree.
    referenceText: referenceTextFor(bounds),
  };
}

export function toLabTestCatalogueView(row: LabTestRow): LabTestCatalogueView {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    category: labCategoryToWire(row.category),
    specimenType: labSpecimenTypeToWire(row.specimenType),
    container: row.container,
    active: row.active,
    analytes: row.analytes.map(toAnalyteSpecView),
  };
}
