import type { LabSpecimenType, LabTestCategory } from './types';

/**
 * Lab test catalogue — five representative tests behind the mock
 * generator (Phase 12 trimmed the demo catalogue; the shape is
 * unchanged). Each test carries its LOINC-style code, specimen type, and
 * the analytes it reports with their reference ranges and critical
 * thresholds. Numeric analytes drive value/flag generation. Replaced by
 * the catalogue endpoint when the API lands.
 */

export interface AnalyteSpec {
  readonly analyte: string;
  readonly unit: string;
  /** Numeric reference bounds; null on both = qualitative analyte. */
  readonly low: number | null;
  readonly high: number | null;
  readonly decimals?: number;
  readonly criticalLow?: number;
  readonly criticalHigh?: number;
  /** Qualitative options; index 0 is the normal/expected result. */
  readonly qualitative?: readonly string[];
}

export interface TestSpec {
  readonly name: string;
  readonly code: string;
  readonly category: LabTestCategory;
  readonly specimen: LabSpecimenType;
  readonly container: string;
  readonly analytes: readonly AnalyteSpec[];
}

export const TEST_CATALOGUE: readonly TestSpec[] = [
  {
    name: 'Complete Blood Count (CBC)',
    code: '58410-2',
    category: 'Hematology',
    specimen: 'Whole blood',
    container: 'EDTA (lavender top)',
    analytes: [
      {
        analyte: 'WBC',
        unit: '10³/µL',
        low: 4,
        high: 11,
        decimals: 1,
        criticalLow: 2,
        criticalHigh: 30,
      },
      { analyte: 'RBC', unit: '10⁶/µL', low: 4.2, high: 5.9, decimals: 2 },
      {
        analyte: 'Hemoglobin',
        unit: 'g/dL',
        low: 12,
        high: 17,
        decimals: 1,
        criticalLow: 7,
        criticalHigh: 20,
      },
      { analyte: 'Hematocrit', unit: '%', low: 36, high: 50, decimals: 1 },
      {
        analyte: 'Platelets',
        unit: '10³/µL',
        low: 150,
        high: 400,
        decimals: 0,
        criticalLow: 50,
        criticalHigh: 1000,
      },
    ],
  },
  {
    name: 'Hemoglobin A1c',
    code: '4548-4',
    category: 'Hematology',
    specimen: 'Whole blood',
    container: 'EDTA (lavender top)',
    analytes: [{ analyte: 'HbA1c', unit: '%', low: 4, high: 5.6, decimals: 1, criticalHigh: 10 }],
  },
  {
    name: 'Basic Metabolic Panel',
    code: '51990-0',
    category: 'Chemistry',
    specimen: 'Serum',
    container: 'SST (gold top)',
    analytes: [
      {
        analyte: 'Sodium',
        unit: 'mmol/L',
        low: 135,
        high: 145,
        decimals: 0,
        criticalLow: 120,
        criticalHigh: 160,
      },
      {
        analyte: 'Potassium',
        unit: 'mmol/L',
        low: 3.5,
        high: 5.1,
        decimals: 1,
        criticalLow: 2.5,
        criticalHigh: 6.0,
      },
      { analyte: 'Chloride', unit: 'mmol/L', low: 98, high: 107, decimals: 0 },
      {
        analyte: 'Glucose',
        unit: 'mg/dL',
        low: 70,
        high: 99,
        decimals: 0,
        criticalLow: 40,
        criticalHigh: 500,
      },
      { analyte: 'Creatinine', unit: 'mg/dL', low: 0.6, high: 1.3, decimals: 2, criticalHigh: 7 },
      { analyte: 'BUN', unit: 'mg/dL', low: 7, high: 20, decimals: 0 },
    ],
  },
  {
    name: 'Lipid Panel',
    code: '57698-3',
    category: 'Chemistry',
    specimen: 'Serum',
    container: 'SST (gold top)',
    analytes: [
      { analyte: 'Total cholesterol', unit: 'mg/dL', low: 125, high: 200, decimals: 0 },
      { analyte: 'LDL cholesterol', unit: 'mg/dL', low: 0, high: 100, decimals: 0 },
      { analyte: 'HDL cholesterol', unit: 'mg/dL', low: 40, high: 90, decimals: 0 },
      {
        analyte: 'Triglycerides',
        unit: 'mg/dL',
        low: 0,
        high: 150,
        decimals: 0,
        criticalHigh: 1000,
      },
    ],
  },
  {
    name: 'Thyroid Panel',
    code: '55204-3',
    category: 'Hormones',
    specimen: 'Serum',
    container: 'SST (gold top)',
    analytes: [
      { analyte: 'TSH', unit: 'mIU/L', low: 0.4, high: 4, decimals: 2, criticalHigh: 50 },
      { analyte: 'Free T4', unit: 'ng/dL', low: 0.8, high: 1.8, decimals: 1 },
      { analyte: 'Free T3', unit: 'pg/mL', low: 2.3, high: 4.2, decimals: 1 },
    ],
  },
];
