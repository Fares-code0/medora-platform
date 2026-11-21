/**
 * Recording a set of vital signs on the chart (API §4.6, `POST /patients/{id}/vitals`).
 *
 * The limits are the server's `createVitalsSchema`, copied as data rather
 * than re-derived: the form refusing what the server would accept, or
 * accepting what it would refuse, is a form that disagrees with its store.
 * They are wide on purpose — they reject a typo (720 bpm, a temperature in
 * Fahrenheit) and let a genuinely alarming reading through, because reading
 * it is the clinician's job, not the form's. Every field is required: the
 * API stores a complete set or nothing.
 */

export interface NewVitalsInput {
  readonly systolic: number;
  readonly diastolic: number;
  readonly heartRate: number;
  readonly temperatureC: number;
  readonly respiratoryRate: number;
  readonly oxygenSaturation: number;
  readonly weightKg: number;
  readonly heightCm: number;
}

export type VitalsField = keyof NewVitalsInput;

export interface VitalsLimit {
  readonly label: string;
  readonly unit: string;
  readonly min: number;
  readonly max: number;
  /** Whole numbers only, as the API's `int()` requires. */
  readonly integer: boolean;
}

export const VITALS_LIMITS: Readonly<Record<VitalsField, VitalsLimit>> = {
  systolic: { label: 'Systolic', unit: 'mmHg', min: 40, max: 300, integer: true },
  diastolic: { label: 'Diastolic', unit: 'mmHg', min: 20, max: 200, integer: true },
  heartRate: { label: 'Heart rate', unit: 'bpm', min: 20, max: 300, integer: true },
  temperatureC: { label: 'Temperature', unit: '°C', min: 25, max: 45, integer: false },
  respiratoryRate: { label: 'Respiratory rate', unit: '/min', min: 4, max: 80, integer: true },
  oxygenSaturation: { label: 'SpO₂', unit: '%', min: 50, max: 100, integer: true },
  weightKg: { label: 'Weight', unit: 'kg', min: 0.5, max: 500, integer: false },
  heightCm: { label: 'Height', unit: 'cm', min: 20, max: 260, integer: false },
};

export const VITALS_FIELDS = Object.keys(VITALS_LIMITS) as readonly VitalsField[];

export type VitalsDraft = Readonly<Record<VitalsField, number | null>>;

export const EMPTY_VITALS: VitalsDraft = {
  systolic: null,
  diastolic: null,
  heartRate: null,
  temperatureC: null,
  respiratoryRate: null,
  oxygenSaturation: null,
  weightKg: null,
  heightCm: null,
};

/** One message per field that cannot be sent, so the form can name it. */
export function vitalsIssues(draft: VitalsDraft): Partial<Record<VitalsField, string>> {
  const issues: Partial<Record<VitalsField, string>> = {};
  for (const field of VITALS_FIELDS) {
    const value = draft[field];
    const limit = VITALS_LIMITS[field];
    if (value === null || Number.isNaN(value)) issues[field] = 'Required';
    else if (limit.integer && !Number.isInteger(value)) issues[field] = 'Use a whole number';
    else if (value < limit.min || value > limit.max) {
      issues[field] = `Between ${String(limit.min)} and ${String(limit.max)} ${limit.unit}`;
    }
  }
  const { systolic, diastolic } = draft;
  if (issues.systolic === undefined && issues.diastolic === undefined) {
    if (systolic !== null && diastolic !== null && systolic <= diastolic) {
      issues.systolic = 'Systolic must exceed diastolic';
    }
  }
  return issues;
}

/** The draft as the API body, or null while any field cannot be sent. */
export function toVitalsInput(draft: VitalsDraft): NewVitalsInput | null {
  if (Object.keys(vitalsIssues(draft)).length > 0) return null;
  return draft as NewVitalsInput;
}

/** BMI to one decimal — the mock's stand-in for the database's generated column. */
export function bmiOf(weightKg: number, heightCm: number): number {
  return Math.round((weightKg / (heightCm / 100) ** 2) * 10) / 10;
}
