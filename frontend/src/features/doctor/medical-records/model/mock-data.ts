import {
  DOCTORS,
  MOCK_PATIENTS,
  isoDaysFromNow,
  mulberry32,
  pick,
  weighted,
} from '@/features/shared-domain/patient-identity';

import {
  DIAGNOSES,
  RECORD_DEPARTMENTS,
  RECORD_VISIT_TYPES,
  type MedicalRecord,
  type MedicalRecordPriority,
  type MedicalRecordStatus,
  type RecordAllergy,
  type RecordAllergySeverity,
  type RecordAttachment,
  type RecordAttachmentKind,
  type RecordClinicalNote,
  type RecordDiagnosis,
  type RecordMedication,
  type RecordMedicationStatus,
  type RecordTimelineEvent,
  type RecordVitalSigns,
} from './types';

/**
 * PHASE 12 MOCK DATA — five representative medical records, one per
 * canonical roster patient (names/MRNs/ids stay coherent with the other
 * modules). Status/recency per record comes from SEED_PLAN so the tiny
 * dataset still demonstrates draft, active, completed, and critical
 * states. Replaced by the records endpoints in a later phase.
 */

const MINUTE_MS = 60_000;

interface SeedPlan {
  readonly status: MedicalRecordStatus;
  readonly priority: MedicalRecordPriority;
  readonly dayOffset: number;
}

/** index ↔ MOCK_PATIENTS index: Khaled · Mona · Amira · Omar · Layla. */
const SEED_PLAN: readonly SeedPlan[] = [
  { status: 'completed', dayOffset: -30, priority: 'normal' },
  { status: 'draft', dayOffset: 0, priority: 'low' },
  { status: 'active', dayOffset: -14, priority: 'normal' },
  { status: 'active', dayOffset: -2, priority: 'critical' },
  { status: 'archived', dayOffset: -180, priority: 'low' },
];

function minutesAfter(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * MINUTE_MS).toISOString();
}

/* ── Narrative pools (keyed by diagnosis code where it matters) ──── */

const CHIEF_COMPLAINTS: Record<string, string> = {
  'E11.9': 'Polyuria, increased thirst, and fatigue over the past month.',
  I10: 'Elevated home blood-pressure readings and occasional morning headaches.',
  'J45.909': 'Wheezing and shortness of breath, worse at night.',
  'N18.3': 'Ankle swelling and reduced urine output for two weeks.',
  'I25.10': 'Chest tightness on exertion, relieved by rest.',
  'E03.9': 'Fatigue, weight gain, and cold intolerance.',
  'J44.9': 'Chronic cough with increased sputum production.',
  'I48.91': 'Palpitations and lightheadedness, intermittent for a week.',
  'K21.9': 'Burning retrosternal pain after meals.',
  'M54.5': 'Lower back pain radiating to the left leg.',
  'J06.9': 'Sore throat, nasal congestion, and low-grade fever for three days.',
  'D64.9': 'Persistent tiredness and pallor noticed by family.',
  'R51.9': 'Recurring frontal headaches over the past two weeks.',
  'M17.9': 'Right knee pain and stiffness, worse on stairs.',
};

const FALLBACK_COMPLAINT = 'General malaise and reduced exercise tolerance.';

const HPI_TEMPLATES: readonly string[] = [
  'Symptoms began gradually and have progressed over the reported period. The patient denies fever, night sweats, or unintentional weight loss. No recent travel or sick contacts. Symptoms partially respond to rest; over-the-counter measures gave limited relief.',
  'Onset was sudden while at home. The patient reports similar but milder episodes in the past year that resolved spontaneously. No associated nausea, vomiting, or visual changes. Daily activities are moderately limited.',
  'The complaint has been intermittent for several weeks, with a clear aggravation after physical activity. The patient has adhered to previously prescribed therapy but reports diminishing benefit. Sleep is disturbed on most nights.',
  'Symptoms were first noticed during routine daily activity and have remained stable since. Relevant family history is positive on the maternal side. The patient tracks measurements at home and brought a written log to the visit.',
];

const EXAM_TEMPLATES: readonly string[] = [
  'Alert and oriented, in no acute distress. Cardiovascular: regular rate and rhythm, no murmurs. Respiratory: clear to auscultation bilaterally. Abdomen: soft, non-tender, no organomegaly. Extremities: no edema, pulses intact.',
  'Well-appearing, cooperative. HEENT unremarkable. Mild expiratory wheeze on forced expiration; no accessory-muscle use. Heart sounds normal. Neurological screening exam grossly intact.',
  'Comfortable at rest. Blood pressure elevated on repeated measurement in both arms. Fundoscopic exam without acute changes. Trace pitting edema at both ankles. Remaining systems examination within normal limits.',
  'Mild tenderness on palpation of the affected area with reduced range of motion; no erythema or warmth. Straight-leg raise negative bilaterally. Gait steady. Skin intact without rash.',
];

const PLAN_STEPS: readonly string[] = [
  'Continue current medication regimen; reassess adherence at the next visit.',
  'Order follow-up laboratory panel (CBC, CMP, HbA1c as applicable) before the next appointment.',
  'Lifestyle counselling: dietary adjustments, daily 30-minute walking, and sleep hygiene.',
  'Begin/titrate first-line therapy per department protocol; monitor for side effects.',
  'Refer to the relevant specialty clinic for further evaluation.',
  'Provide safety-net advice; return immediately if red-flag symptoms appear.',
  'Schedule imaging of the affected region to rule out structural causes.',
  'Review home-monitoring log at the follow-up visit and adjust dosing if needed.',
];

const MEDICATION_POOL: ReadonlyArray<{
  readonly name: string;
  readonly dosage: string;
  readonly frequency: string;
  readonly instructions: string | null;
}> = [
  {
    name: 'Metformin',
    dosage: '500 mg',
    frequency: 'Twice daily',
    instructions: 'Take with meals.',
  },
  { name: 'Lisinopril', dosage: '10 mg', frequency: 'Once daily', instructions: null },
  { name: 'Atorvastatin', dosage: '20 mg', frequency: 'Once daily at night', instructions: null },
  {
    name: 'Salbutamol inhaler',
    dosage: '100 mcg',
    frequency: 'As needed',
    instructions: 'Max 8 puffs per day.',
  },
  {
    name: 'Levothyroxine',
    dosage: '50 mcg',
    frequency: 'Once daily',
    instructions: 'On an empty stomach.',
  },
  {
    name: 'Omeprazole',
    dosage: '20 mg',
    frequency: 'Once daily',
    instructions: 'Before breakfast.',
  },
  { name: 'Amlodipine', dosage: '5 mg', frequency: 'Once daily', instructions: null },
  {
    name: 'Ibuprofen',
    dosage: '400 mg',
    frequency: 'Three times daily',
    instructions: 'After food, 5 days.',
  },
  {
    name: 'Ferrous sulfate',
    dosage: '325 mg',
    frequency: 'Once daily',
    instructions: 'With vitamin C.',
  },
  { name: 'Bisoprolol', dosage: '2.5 mg', frequency: 'Once daily', instructions: null },
];

const NOTE_TITLES: readonly string[] = [
  'Progress note',
  'Nursing observation',
  'Medication counselling',
  'Telephone follow-up',
  'Care-plan review',
];

const NOTE_BODIES: readonly string[] = [
  'Patient tolerated the plan discussion well and verbalized understanding of the next steps. Questions about medication timing were answered; written instructions provided.',
  'Vitals stable throughout the visit. Patient ambulating without assistance. No new complaints voiced during observation.',
  'Reviewed adherence with the patient; missed doses reported on weekends. Agreed on a phone-reminder strategy and a pillbox.',
  'Called the patient to review symptoms after the medication change. Reports improvement, no adverse effects. Advised to continue as prescribed.',
  'Care plan reviewed with the multidisciplinary team. Goals remain appropriate; next review scheduled at the follow-up visit.',
];

const NOTE_AUTHORS: readonly string[] = [
  'Dr. Amelia Chen',
  'Dr. Omar Khalil',
  'Nurse Mariam Adel',
  'Nurse Youssef Gaber',
];

const ALLERGY_REACTIONS: readonly string[] = [
  'Urticaria and itching',
  'Facial swelling',
  'Wheezing and chest tightness',
  'Generalized rash',
  'Nausea and vomiting',
];

const ATTACHMENT_NAMES: Record<RecordAttachmentKind, readonly string[]> = {
  'lab-result': ['CBC panel.pdf', 'Metabolic panel.pdf', 'HbA1c result.pdf', 'Lipid profile.pdf'],
  imaging: ['Chest X-ray.dcm', 'Knee MRI report.pdf', 'Abdominal ultrasound.pdf'],
  referral: ['Cardiology referral.pdf', 'Physiotherapy referral.pdf'],
  consent: ['Procedure consent form.pdf', 'Data-sharing consent.pdf'],
  'external-report': ['Outside clinic summary.pdf', 'Previous hospital discharge.pdf'],
};

const ATTACHMENT_KINDS = Object.keys(ATTACHMENT_NAMES) as readonly RecordAttachmentKind[];

/* ── Weighted status by visit recency (time coherence) ──────────── */

const TODAY_STATUS: ReadonlyArray<readonly [MedicalRecordStatus, number]> = [
  ['draft', 40],
  ['active', 45],
  ['completed', 15],
];

const RECENT_STATUS: ReadonlyArray<readonly [MedicalRecordStatus, number]> = [
  ['active', 35],
  ['completed', 40],
  ['draft', 10],
  ['archived', 15],
];

const OLD_STATUS: ReadonlyArray<readonly [MedicalRecordStatus, number]> = [
  ['completed', 50],
  ['archived', 42],
  ['active', 8],
];

const PRIORITY_WEIGHTS: ReadonlyArray<readonly [MedicalRecordPriority, number]> = [
  ['low', 15],
  ['normal', 55],
  ['high', 20],
  ['critical', 10],
];

const SEVERITY_WEIGHTS: ReadonlyArray<readonly [RecordAllergySeverity, number]> = [
  ['mild', 45],
  ['moderate', 35],
  ['severe', 20],
];

/* ── Sub-document builders ──────────────────────────────────────── */

function buildVitals(recordedAt: string, age: number, random: () => number): RecordVitalSigns {
  const heightCm = 150 + Math.floor(random() * 40);
  const weightKg = 52 + Math.floor(random() * 48);
  const bmi = Math.round((weightKg / (heightCm / 100) ** 2) * 10) / 10;
  const systolic = 105 + Math.floor(random() * 55);
  const diastolic = 65 + Math.floor(random() * 30);
  return {
    recordedAt,
    bloodPressure: `${String(systolic)}/${String(diastolic)} mmHg`,
    heartRateBpm: 58 + Math.floor(random() * 50),
    temperatureC: Math.round((36.2 + random() * 1.6) * 10) / 10,
    respiratoryRate: 12 + Math.floor(random() * (age > 70 ? 10 : 8)),
    oxygenSaturation: 93 + Math.floor(random() * 7),
    weightKg,
    heightCm,
    bmi,
  };
}

function buildDiagnoses(random: () => number): readonly RecordDiagnosis[] {
  const count = weighted(
    [
      [1, 55],
      [2, 32],
      [3, 13],
    ] as const,
    random(),
  );
  const start = Math.floor(random() * DIAGNOSES.length);
  return Array.from({ length: count }, (_, i) => {
    const concept = DIAGNOSES[(start + i * 5) % DIAGNOSES.length];
    if (concept === undefined) throw new Error('diagnosis pool is empty');
    return { ...concept, isPrimary: i === 0 };
  });
}

function buildMedications(
  recordId: string,
  status: MedicalRecordStatus,
  random: () => number,
): readonly RecordMedication[] {
  const count = weighted(
    [
      [0, 20],
      [1, 35],
      [2, 30],
      [3, 15],
    ] as const,
    random(),
  );
  const start = Math.floor(random() * MEDICATION_POOL.length);
  return Array.from({ length: count }, (_, i) => {
    const base = MEDICATION_POOL[(start + i * 3) % MEDICATION_POOL.length];
    if (base === undefined) throw new Error('medication pool is empty');
    const medicationStatus: RecordMedicationStatus =
      status === 'archived' || status === 'completed'
        ? random() < 0.6
          ? 'completed'
          : 'discontinued'
        : 'active';
    return { id: `${recordId}-med-${String(i + 1)}`, ...base, status: medicationStatus };
  });
}

function buildAllergies(
  recordId: string,
  allergens: readonly string[],
  random: () => number,
): readonly RecordAllergy[] {
  return allergens.map((allergen, i) => ({
    id: `${recordId}-alg-${String(i + 1)}`,
    allergen,
    severity: weighted(SEVERITY_WEIGHTS, random()),
    reaction: pick(ALLERGY_REACTIONS, random()),
  }));
}

function buildNotes(
  recordId: string,
  createdAt: string,
  random: () => number,
): readonly RecordClinicalNote[] {
  const count = weighted(
    [
      [0, 25],
      [1, 40],
      [2, 25],
      [3, 10],
    ] as const,
    random(),
  );
  return Array.from({ length: count }, (_, i) => ({
    id: `${recordId}-note-${String(i + 1)}`,
    author: pick(NOTE_AUTHORS, random()),
    authoredAt: minutesAfter(createdAt, 40 + i * 90 + Math.floor(random() * 30)),
    title: pick(NOTE_TITLES, random()),
    body: pick(NOTE_BODIES, random()),
    signed: random() < 0.7,
  }));
}

function buildAttachments(
  recordId: string,
  createdAt: string,
  random: () => number,
): readonly RecordAttachment[] {
  const count = weighted(
    [
      [0, 30],
      [1, 35],
      [2, 25],
      [3, 10],
    ] as const,
    random(),
  );
  return Array.from({ length: count }, (_, i) => {
    const kind = pick(ATTACHMENT_KINDS, random());
    return {
      id: `${recordId}-att-${String(i + 1)}`,
      name: pick(ATTACHMENT_NAMES[kind], random()),
      kind,
      sizeKb: 90 + Math.floor(random() * 4_200),
      uploadedBy: pick(NOTE_AUTHORS, random()),
      uploadedAt: minutesAfter(createdAt, 25 + i * 60 + Math.floor(random() * 45)),
    };
  });
}

function buildTimeline(record: {
  readonly id: string;
  readonly doctor: string;
  readonly status: MedicalRecordStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly diagnoses: readonly RecordDiagnosis[];
  readonly medications: readonly RecordMedication[];
  readonly notes: readonly RecordClinicalNote[];
  readonly attachments: readonly RecordAttachment[];
}): readonly RecordTimelineEvent[] {
  const events: RecordTimelineEvent[] = [
    {
      id: `${record.id}-tl-created`,
      kind: 'created',
      at: record.createdAt,
      actor: record.doctor,
      detail: 'Encounter documented and the record was opened.',
    },
    {
      id: `${record.id}-tl-vitals`,
      kind: 'vitals-recorded',
      at: minutesAfter(record.createdAt, 10),
      actor: pick(NOTE_AUTHORS, 0.6),
      detail: 'Triage vital signs captured for the visit.',
    },
  ];

  const primary = record.diagnoses.find((diagnosis) => diagnosis.isPrimary);
  if (primary) {
    events.push({
      id: `${record.id}-tl-dx`,
      kind: 'diagnosis-added',
      at: minutesAfter(record.createdAt, 35),
      actor: record.doctor,
      detail: `${primary.label} (${primary.code}) recorded as the primary diagnosis.`,
    });
  }
  if (record.medications.length > 0) {
    events.push({
      id: `${record.id}-tl-med`,
      kind: 'medication-prescribed',
      at: minutesAfter(record.createdAt, 50),
      actor: record.doctor,
      detail: `${String(record.medications.length)} medication${
        record.medications.length === 1 ? '' : 's'
      } added to the treatment plan.`,
    });
  }
  record.notes.slice(0, 2).forEach((note, i) => {
    events.push({
      id: `${record.id}-tl-note-${String(i + 1)}`,
      kind: 'note-added',
      at: note.authoredAt,
      actor: note.author,
      detail: `"${note.title}" added to the record.`,
    });
  });
  if (record.attachments.length > 0) {
    const first = record.attachments[0];
    if (first !== undefined) {
      events.push({
        id: `${record.id}-tl-att`,
        kind: 'attachment-added',
        at: first.uploadedAt,
        actor: first.uploadedBy,
        detail: `${first.name} uploaded.`,
      });
    }
  }
  if (record.status !== 'draft') {
    events.push({
      id: `${record.id}-tl-status`,
      kind: 'status-changed',
      at: record.updatedAt,
      actor: record.doctor,
      detail: `Record moved to "${record.status}".`,
    });
  }

  return events.sort((a, b) => a.at.localeCompare(b.at));
}

/* ── Record builder ─────────────────────────────────────────────── */

function buildRecord(index: number, random: () => number): MedicalRecord {
  const plan = SEED_PLAN[index];
  const patient = MOCK_PATIENTS[index % MOCK_PATIENTS.length] ?? pick(MOCK_PATIENTS, random());
  const id = `MR-${String(10_001 + index)}`;

  const dayOffset = plan?.dayOffset ?? -(1 + Math.floor(random() * 730));
  const visitDate = isoDaysFromNow(
    dayOffset,
    8 + Math.floor(random() * 9),
    random() < 0.5 ? 0 : 30,
  );

  const status =
    plan?.status ??
    weighted(
      dayOffset === 0 ? TODAY_STATUS : dayOffset >= -30 ? RECENT_STATUS : OLD_STATUS,
      random(),
    );

  const diagnoses = buildDiagnoses(random);
  const primary = diagnoses[0];
  const createdAt = visitDate;
  // Updates happen after creation but never in the future.
  const updatedDayOffset = Math.min(dayOffset + Math.floor(random() * 10), 0);
  const updatedAt =
    status === 'draft'
      ? createdAt
      : isoDaysFromNow(updatedDayOffset, 9 + Math.floor(random() * 8), 0);

  const medications = buildMedications(id, status, random);
  const planStart = Math.floor(random() * PLAN_STEPS.length);
  const notes = buildNotes(id, createdAt, random);
  const attachments = buildAttachments(id, createdAt, random);

  const record: MedicalRecord = {
    id,
    patient: {
      id: patient.id,
      name: patient.name,
      mrn: patient.mrn,
      age: patient.age,
      gender: patient.gender,
      bloodType: patient.bloodType,
      phone: patient.phone,
    },
    visitDate,
    visitType: pick(RECORD_VISIT_TYPES, random()),
    department: pick(RECORD_DEPARTMENTS, random()),
    doctor: random() < 0.7 ? 'Dr. Amelia Chen' : pick(DOCTORS, random()),
    status,
    priority: plan?.priority ?? weighted(PRIORITY_WEIGHTS, random()),
    diagnoses,
    chiefComplaint:
      (primary !== undefined ? CHIEF_COMPLAINTS[primary.code] : undefined) ?? FALLBACK_COMPLAINT,
    historyOfPresentIllness: pick(HPI_TEMPLATES, random()),
    physicalExamination: pick(EXAM_TEMPLATES, random()),
    vitals: buildVitals(minutesAfter(visitDate, 10), patient.age, random),
    treatmentPlan: Array.from(
      { length: 3 + Math.floor(random() * 3) },
      (_, i) => PLAN_STEPS[(planStart + i * 3) % PLAN_STEPS.length],
    ).filter((step): step is string => step !== undefined),
    medications,
    allergies: buildAllergies(id, patient.allergies, random),
    notes,
    attachments,
    timeline: [],
    followUpDate:
      status === 'active' && random() < 0.55
        ? isoDaysFromNow(3 + Math.floor(random() * 45), 9 + Math.floor(random() * 8), 0)
        : null,
    createdAt,
    updatedAt,
  };

  return { ...record, timeline: buildTimeline(record) };
}

const random = mulberry32(0x6eed_ed6a);

export const MOCK_MEDICAL_RECORDS: readonly MedicalRecord[] = Array.from(
  { length: 5 },
  (_, index) => buildRecord(index, random),
);
