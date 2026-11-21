/**
 * The reference vocabularies (RM M5.1).
 *
 * Every list here is the union of what the frontend already displays.
 * ADR-004 states the rule for departments and it applies to all of them:
 * "No name is dropped. Dropping one would remove values that seeded
 * frontend data already displays."
 */

/** DB §5 + ADR-004 §2 — the union of all five per-module department arrays. */
export const DEPARTMENTS: readonly string[] = [
  'General Medicine',
  'Cardiology',
  'Endocrinology',
  'Pulmonology',
  'Orthopedics',
  'Nephrology',
  'Oncology',
  'Emergency',
  'Psychiatry',
  'Internal Medicine',
  'Pediatrics',
  'Neurology',
];

/**
 * DB §5 — `VISIT_TYPES` ∪ `RECORD_VISIT_TYPES`.
 *
 * The appointments module contributes the first six; medical records adds
 * Emergency and Telemedicine. Position is the render order.
 */
export const VISIT_TYPES: readonly string[] = [
  'Consultation',
  'Follow-up',
  'Annual check-up',
  'Lab review',
  'Medication review',
  'Procedure',
  'Emergency',
  'Telemedicine',
];

/**
 * The attributes the Database branch's `database/seed.sql` gives the visit
 * types it shares with `VISIT_TYPES`, keyed by name. It seeds three of the
 * eight; the other five have no code until someone assigns one, which is
 * why `visit_types.code` is still nullable.
 */
export const VISIT_TYPE_ATTRIBUTES: Readonly<
  Record<
    string,
    { readonly code: string; readonly description: string; readonly defaultDurationMin: number }
  >
> = {
  Consultation: { code: 'CONSULT', description: 'General consultation', defaultDurationMin: 30 },
  'Follow-up': { code: 'FOLLOWUP', description: 'Routine follow-up visit', defaultDurationMin: 20 },
  Emergency: { code: 'EMERGENCY', description: 'Emergency visit', defaultDurationMin: 60 },
};

/** DB §5, §B5 — `CHRONIC_CONDITIONS`, the 10 canonical conditions. */
export const CHRONIC_CONDITIONS: readonly string[] = [
  'Type 2 diabetes',
  'Hypertension',
  'Asthma',
  'Chronic kidney disease',
  'Coronary artery disease',
  'Hypothyroidism',
  'COPD',
  'Atrial fibrillation',
  'Epilepsy',
  'Osteoarthritis',
];

/**
 * The codes `database/seed.sql` gives three of the conditions, keyed by the
 * canonical name above (it spells one "Type 2 Diabetes"; DB §5's spelling
 * is kept).
 */
export const CHRONIC_CONDITION_CODES: Readonly<Record<string, string>> = {
  'Type 2 diabetes': 'DM2',
  Hypertension: 'HTN',
  Asthma: 'ASTHMA',
};

/**
 * DB §5, §D2 — the 14 seed ICD-10 concepts from the `DIAGNOSES` vocabulary.
 *
 * DB §5 recommends a full ICD-10 import; this is the subset the frontend
 * can already produce, so a seeded record's diagnosis resolves.
 */
export const ICD_CODES: readonly { readonly code: string; readonly label: string }[] = [
  { code: 'E11.9', label: 'Type 2 diabetes mellitus' },
  { code: 'I10', label: 'Essential hypertension' },
  { code: 'J45.909', label: 'Asthma, unspecified' },
  { code: 'N18.3', label: 'Chronic kidney disease, stage 3' },
  { code: 'I25.10', label: 'Coronary artery disease' },
  { code: 'E03.9', label: 'Hypothyroidism' },
  { code: 'J44.9', label: 'COPD' },
  { code: 'I48.91', label: 'Atrial fibrillation' },
  { code: 'K21.9', label: 'GERD' },
  { code: 'M54.5', label: 'Low back pain' },
  { code: 'J06.9', label: 'Acute upper respiratory infection' },
  { code: 'D64.9', label: 'Anemia, unspecified' },
  { code: 'R51.9', label: 'Headache, unspecified' },
  { code: 'M17.9', label: 'Osteoarthritis of knee' },
];

/**
 * Specialties (ADR-010 group 4 — IN).
 *
 * DB §5 records only "Internal Medicine seeded", which is the doctor
 * profile's own value. These are every distinct `specialty` the frontend
 * fixtures actually carry — the admin doctor roster shows all nine — so
 * that a seeded doctor's specialty resolves to a row instead of dangling.
 *
 * `Paediatrics` is spelled here as the specialty fixtures spell it, while
 * the department list carries `Pediatrics`. That is a real inconsistency
 * in the frontend data, not a transcription slip. It is left visible
 * rather than silently normalized: they are different columns on
 * different tables, and picking a winner is a product call nobody has
 * made. Recorded for RM M39.
 */
export const SPECIALTIES: readonly string[] = [
  'Cardiology',
  'Dermatology',
  'Endocrinology',
  'General Medicine',
  'Internal Medicine',
  'Neurology',
  'Oncology',
  'Paediatrics',
  'Radiology',
];
