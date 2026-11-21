import {
  DOCTORS,
  FEMALE_NAMES,
  MALE_NAMES,
  hashString,
  isoDaysFromNow,
  mulberry32,
  pick,
  weighted,
} from '@/features/shared-domain/patient-identity';
import {
  PATIENT_STATUS_META,
  RISK_LEVEL_META,
  type Patient,
} from '@/features/shared-domain/patient-identity';

import type {
  AllergyRecord,
  AllergySeverity,
  AppointmentRecord,
  ClinicalAlert,
  ClinicalNote,
  MedicalHistoryEvent,
  MedicationRecord,
  PatientDocument,
  PatientProfile,
  ProfileTabData,
  ProfileAppointmentStatus,
  StudyCategory,
  StudyRecord,
  StudyStatus,
  VitalSigns,
} from './profile-types';

/**
 * PHASE 4 MOCK DATA — deterministic per-patient profile bundle.
 * Seeded from the patient id, so revisiting a profile always shows the
 * same clinically-coherent record (medications match chronic conditions,
 * critical alerts match risk level). Replaced by the profile endpoints
 * in Phase 7+; `PatientProfile` already mirrors that DTO bundle.
 */

const REACTIONS: Record<string, string> = {
  Penicillin: 'Anaphylaxis',
  'Sulfa drugs': 'Skin rash, hives',
  Latex: 'Contact dermatitis',
  Aspirin: 'Angioedema',
  Peanuts: 'Anaphylaxis',
  'Iodine contrast': 'Urticaria, nausea',
};

/** Condition → typical regimen, keeps mock prescriptions clinically coherent. */
const CONDITION_MEDS: Record<string, ReadonlyArray<readonly [string, string, string]>> = {
  'Type 2 diabetes': [
    ['Metformin', '500 mg', 'Twice daily'],
    ['Insulin glargine', '20 units', 'Once daily at bedtime'],
  ],
  Hypertension: [
    ['Lisinopril', '10 mg', 'Once daily'],
    ['Amlodipine', '5 mg', 'Once daily'],
  ],
  Asthma: [['Salbutamol inhaler', '100 mcg', 'As needed']],
  'Chronic kidney disease': [['Sodium bicarbonate', '650 mg', 'Twice daily']],
  'Coronary artery disease': [
    ['Atorvastatin', '20 mg', 'Once daily at night'],
    ['Aspirin', '81 mg', 'Once daily'],
  ],
  Hypothyroidism: [['Levothyroxine', '50 mcg', 'Once daily before breakfast']],
  COPD: [['Tiotropium inhaler', '18 mcg', 'Once daily']],
  'Atrial fibrillation': [['Apixaban', '5 mg', 'Twice daily']],
  Epilepsy: [['Levetiracetam', '500 mg', 'Twice daily']],
  Osteoarthritis: [['Naproxen', '250 mg', 'Twice daily with food']],
};

const GENERAL_MEDS: ReadonlyArray<readonly [string, string, string]> = [
  ['Omeprazole', '20 mg', 'Once daily before breakfast'],
  ['Vitamin D3', '1000 IU', 'Once daily'],
  ['Paracetamol', '500 mg', 'As needed, max 4/day'],
];

const DEPARTMENTS: readonly string[] = [
  'General Medicine',
  'Cardiology',
  'Endocrinology',
  'Pulmonology',
  'Orthopedics',
];

const VISIT_TYPES: readonly string[] = [
  'Consultation',
  'Follow-up',
  'Lab review',
  'Medication review',
  'Annual check-up',
];

const FACILITIES: readonly string[] = [
  'Medora Central Clinic',
  'Cairo University Hospital',
  'El Salam Hospital',
  'Medora Day Surgery Unit',
];

function buildVitals(patient: Patient, random: () => number): VitalSigns {
  const riskBump = patient.riskLevel === 'critical' ? 25 : patient.riskLevel === 'high' ? 15 : 0;
  const systolic = 108 + Math.floor(random() * 20) + riskBump;
  const diastolic = 68 + Math.floor(random() * 12) + Math.floor(riskBump / 2);
  const heightCm = Math.round(
    patient.gender === 'female' ? 155 + random() * 18 : 165 + random() * 20,
  );
  const weightKg = Math.round(52 + random() * 45);
  const bmi = Math.round((weightKg / (heightCm / 100) ** 2) * 10) / 10;
  return {
    recordedAt: patient.lastVisit ?? isoDaysFromNow(-14, 10, 30),
    bloodPressure: `${String(systolic)}/${String(diastolic)} mmHg`,
    heartRateBpm: 62 + Math.floor(random() * 34),
    temperatureC: Math.round((36.4 + random() * 0.9) * 10) / 10,
    respiratoryRate: 12 + Math.floor(random() * 7),
    oxygenSaturation: 94 + Math.floor(random() * 6),
    weightKg,
    heightCm,
    bmi,
  };
}

function buildAllergies(patient: Patient, random: () => number): readonly AllergyRecord[] {
  return patient.allergies.map((allergen, index) => {
    const severity: AllergySeverity =
      index === 0 && patient.hasSevereAllergy
        ? 'severe'
        : weighted(
            [
              ['mild', 40],
              ['moderate', 60],
            ] as const,
            random(),
          );
    return {
      id: `${patient.id}-alg-${String(index)}`,
      allergen,
      severity,
      reaction: REACTIONS[allergen] ?? 'Documented hypersensitivity',
      notes: severity === 'severe' ? 'Carries epinephrine auto-injector.' : null,
      recordedAt: isoDaysFromNow(-(200 + Math.floor(random() * 1200)), 11, 0),
    };
  });
}

function buildMedications(patient: Patient, random: () => number): readonly MedicationRecord[] {
  const regimens = patient.chronicConditions.flatMap(
    (condition) => CONDITION_MEDS[condition] ?? [],
  );
  const extraCount = weighted(
    [
      [0, 45],
      [1, 40],
      [2, 15],
    ] as const,
    random(),
  );
  const all = [
    ...regimens,
    ...Array.from({ length: extraCount }, () => pick(GENERAL_MEDS, random())),
  ];

  return all.map(([name, dosage, frequency], index) => {
    const status = weighted(
      [
        ['active', 70],
        ['completed', 18],
        ['discontinued', 12],
      ] as const,
      random(),
    );
    const startDaysAgo = 30 + Math.floor(random() * 700);
    return {
      id: `${patient.id}-med-${String(index)}`,
      name,
      dosage,
      frequency,
      startDate: isoDaysFromNow(-startDaysAgo, 9, 0),
      endDate:
        status === 'active'
          ? null
          : isoDaysFromNow(-Math.floor(random() * startDaysAgo * 0.5), 9, 0),
      prescribedBy: pick(DOCTORS, random()),
      status,
    };
  });
}

function buildHistory(patient: Patient, random: () => number): readonly MedicalHistoryEvent[] {
  const events: MedicalHistoryEvent[] = [];

  patient.chronicConditions.forEach((condition, index) => {
    events.push({
      id: `${patient.id}-dx-${String(index)}`,
      kind: 'diagnosis',
      title: condition,
      date: isoDaysFromNow(-(365 + Math.floor(random() * 2500)), 10, 0),
      detail: `Diagnosed following clinical evaluation; managed per standard protocol.`,
      facility: pick(FACILITIES, random()),
    });
  });

  const surgeries = ['Appendectomy', 'Cholecystectomy', 'Knee arthroscopy', 'Cataract surgery'];
  for (
    let i = 0;
    i <
    weighted(
      [
        [0, 50],
        [1, 35],
        [2, 15],
      ] as const,
      random(),
    );
    i += 1
  ) {
    events.push({
      id: `${patient.id}-surg-${String(i)}`,
      kind: 'surgery',
      title: pick(surgeries, random()),
      date: isoDaysFromNow(-(400 + Math.floor(random() * 3000)), 8, 0),
      detail: 'Procedure completed without complications.',
      facility: pick(FACILITIES, random()),
    });
  }

  const procedures = ['Colonoscopy', 'Echocardiogram', 'Skin biopsy', 'Stress test'];
  for (
    let i = 0;
    i <
    weighted(
      [
        [0, 40],
        [1, 40],
        [2, 20],
      ] as const,
      random(),
    );
    i += 1
  ) {
    events.push({
      id: `${patient.id}-proc-${String(i)}`,
      kind: 'procedure',
      title: pick(procedures, random()),
      date: isoDaysFromNow(-(100 + Math.floor(random() * 1500)), 9, 30),
      detail: 'Findings reviewed with the patient; report attached to record.',
      facility: pick(FACILITIES, random()),
    });
  }

  if (patient.riskLevel === 'critical' || (patient.riskLevel === 'high' && random() < 0.5)) {
    events.push({
      id: `${patient.id}-hosp-0`,
      kind: 'hospitalization',
      title: 'Inpatient admission',
      date: isoDaysFromNow(-(30 + Math.floor(random() * 400)), 14, 0),
      detail: `Admitted for management of ${patient.chronicConditions[0] ?? 'acute illness'}; discharged stable.`,
      facility: pick(FACILITIES, random()),
    });
  }

  const vaccines = [
    'Influenza vaccine',
    'COVID-19 booster',
    'Tetanus booster',
    'Pneumococcal vaccine',
  ];
  for (let i = 0; i < 2 + Math.floor(random() * 2); i += 1) {
    events.push({
      id: `${patient.id}-vax-${String(i)}`,
      kind: 'vaccination',
      title: pick(vaccines, random()),
      date: isoDaysFromNow(-(20 + Math.floor(random() * 1000)), 11, 15),
      detail: 'Administered without adverse reaction.',
      facility: 'Medora Central Clinic',
    });
  }

  return events.sort((a, b) => b.date.localeCompare(a.date));
}

function buildStudies(
  patient: Patient,
  random: () => number,
  prefix: string,
  catalogue: ReadonlyArray<readonly [string, readonly string[]]>,
): readonly StudyCategory[] {
  const allowCritical = patient.riskLevel === 'high' || patient.riskLevel === 'critical';
  return catalogue.map(([label, names], categoryIndex) => {
    const count = weighted(
      [
        [0, 15],
        [1, 40],
        [2, 30],
        [3, 15],
      ] as const,
      random(),
    );
    const studies: StudyRecord[] = Array.from({ length: count }, (_, index) => {
      const status: StudyStatus = weighted(
        allowCritical
          ? ([
              ['completed', 65],
              ['pending', 22],
              ['critical', 13],
            ] as const)
          : ([
              ['completed', 75],
              ['pending', 25],
            ] as const),
        random(),
      );
      return {
        id: `${patient.id}-${prefix}-${String(categoryIndex)}-${String(index)}`,
        name: pick(names, random()),
        date: isoDaysFromNow(-Math.floor(random() * 400), 8 + Math.floor(random() * 8), 0),
        status,
      };
    });
    return {
      id: `${prefix}-${String(categoryIndex)}`,
      label,
      studies: [...studies].sort((a, b) => b.date.localeCompare(a.date)),
    };
  });
}

const LAB_CATALOGUE: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['Blood Tests', ['Complete blood count', 'HbA1c', 'Lipid panel', 'Coagulation panel']],
  ['Urine Tests', ['Urinalysis', 'Urine culture', 'Albumin-to-creatinine ratio']],
  ['Chemistry', ['Comprehensive metabolic panel', 'Electrolytes', 'Liver function tests']],
  ['Microbiology', ['Blood culture', 'Throat swab culture', 'Stool culture']],
];

const IMAGING_CATALOGUE: ReadonlyArray<readonly [string, readonly string[]]> = [
  ['X-Ray', ['Chest X-ray', 'Knee X-ray', 'Lumbar spine X-ray']],
  ['CT', ['CT abdomen & pelvis', 'CT chest', 'CT head']],
  ['MRI', ['MRI brain', 'MRI knee', 'MRI lumbar spine']],
  ['Ultrasound', ['Abdominal ultrasound', 'Echocardiogram', 'Thyroid ultrasound']],
];

function buildAppointments(patient: Patient, random: () => number): readonly AppointmentRecord[] {
  const past: AppointmentRecord[] = Array.from(
    { length: 3 + Math.floor(random() * 3) },
    (_, index) => {
      const status: ProfileAppointmentStatus = weighted(
        [
          ['completed', 75],
          ['cancelled', 15],
          ['no-show', 10],
        ] as const,
        random(),
      );
      return {
        id: `${patient.id}-appt-p${String(index)}`,
        dateTime: isoDaysFromNow(
          -(15 + index * 40 + Math.floor(random() * 30)),
          9 + Math.floor(random() * 8),
          random() < 0.5 ? 0 : 30,
        ),
        type: pick(VISIT_TYPES, random()),
        doctor: patient.assignedDoctor,
        department: pick(DEPARTMENTS, random()),
        status,
      };
    },
  );

  const upcoming: AppointmentRecord[] = [];
  if (patient.nextAppointment !== null) {
    upcoming.push({
      id: `${patient.id}-appt-next`,
      dateTime: patient.nextAppointment,
      type: pick(VISIT_TYPES, random()),
      doctor: patient.assignedDoctor,
      department: pick(DEPARTMENTS, random()),
      status: 'confirmed',
    });
    if (random() < 0.3) {
      upcoming.push({
        id: `${patient.id}-appt-req`,
        dateTime: isoDaysFromNow(20 + Math.floor(random() * 30), 10, 0),
        type: 'Follow-up',
        doctor: patient.assignedDoctor,
        department: 'General Medicine',
        status: 'pending',
      });
    }
  }

  return [...upcoming, ...past];
}

const NOTE_BODIES: readonly string[] = [
  'Patient reports steady improvement. Vitals within expected range. Continue current regimen and review at the next visit.',
  'Discussed medication adherence and lifestyle adjustments. Patient verbalizes understanding of the plan.',
  'Mild symptom recurrence reported. Adjusted dosage and requested follow-up labs before the next appointment.',
  'Reviewed recent lab results with the patient. No acute concerns; monitoring plan unchanged.',
  'Pre-visit summary prepared. Chronic conditions stable; screening reminders updated.',
];

function buildNotes(patient: Patient, random: () => number): readonly ClinicalNote[] {
  const count = 2 + Math.floor(random() * 3);
  return Array.from({ length: count }, (_, index) => ({
    id: `${patient.id}-note-${String(index)}`,
    ...((author: string) => ({
      // Seeded authors are names with no account behind them, so their notes
      // are never "yours" — the demo signs in as nobody on this list.
      authorId: `seed:${author}`,
      author,
    }))(index === 0 ? patient.assignedDoctor : pick(DOCTORS, random())),
    authoredAt: isoDaysFromNow(-(index * 45 + Math.floor(random() * 30)), 9 + index, 20),
    title: pick(
      ['Consultation note', 'Follow-up note', 'Medication review', 'Telephone encounter'],
      random(),
    ),
    body: pick(NOTE_BODIES, random()),
    signed: !(index === 0 && random() < 0.35),
  })).sort((a, b) => b.authoredAt.localeCompare(a.authoredAt));
}

function buildDocuments(patient: Patient, random: () => number): readonly PatientDocument[] {
  const catalogue = [
    ['Referral letter — cardiology.pdf', 'referral'],
    ['Signed consent form.pdf', 'consent'],
    ['External records — prior clinic.pdf', 'external-record'],
    ['Insurance card scan.pdf', 'insurance'],
    ['Discharge summary.pdf', 'report'],
    ['Radiology report.pdf', 'report'],
  ] as const;
  const count = 3 + Math.floor(random() * 3);
  return Array.from({ length: count }, (_, index) => {
    const entry = catalogue[index % catalogue.length];
    return {
      id: `${patient.id}-doc-${String(index)}`,
      name: entry?.[0] ?? 'Document.pdf',
      category: entry?.[1] ?? 'report',
      uploadedAt: isoDaysFromNow(-(10 + Math.floor(random() * 500)), 13, 45),
      uploadedBy: random() < 0.6 ? patient.assignedDoctor : 'Front desk',
      sizeKb: 120 + Math.floor(random() * 3800),
    };
  });
}

function buildAlerts(
  patient: Patient,
  labCategories: readonly StudyCategory[],
): readonly ClinicalAlert[] {
  const alerts: ClinicalAlert[] = [];
  if (patient.hasSevereAllergy) {
    alerts.push({
      id: 'alert-allergy',
      severity: 'critical',
      message: `Severe allergy on record: ${patient.allergies[0] ?? 'see allergy list'}. Verify before prescribing.`,
    });
  }
  if (patient.riskLevel === 'critical') {
    alerts.push({
      id: 'alert-risk',
      severity: 'critical',
      message: 'Patient is classified critical risk — review the care plan at every encounter.',
    });
  }
  if (labCategories.some((category) => category.studies.some((s) => s.status === 'critical'))) {
    alerts.push({
      id: 'alert-lab',
      severity: 'warning',
      message: 'A lab result is flagged critical and awaiting review.',
    });
  }
  return alerts;
}

function buildSummary(patient: Patient, medications: readonly MedicationRecord[]): string {
  const conditions =
    patient.chronicConditions.length > 0
      ? patient.chronicConditions.join(', ').toLowerCase()
      : 'no documented chronic conditions';
  const activeMeds = medications.filter((m) => m.status === 'active').length;
  return (
    `${String(patient.age)}-year-old ${patient.gender} with ${conditions}. ` +
    `Currently ${PATIENT_STATUS_META[patient.status].label.toLowerCase()} under ` +
    `${patient.assignedDoctor}; risk level ${RISK_LEVEL_META[patient.riskLevel].label.toLowerCase()}; ` +
    `${String(activeMeds)} active medication${activeMeds === 1 ? '' : 's'}.`
  );
}

function buildEmergencyContact(patient: Patient, random: () => number) {
  const familyName = patient.name.split(' ').slice(1).join(' ');
  const first = pick(patient.gender === 'female' ? MALE_NAMES : FEMALE_NAMES, random());
  return {
    name: `${first} ${familyName}`,
    relationship: pick(['Spouse', 'Parent', 'Sibling', 'Adult child'], random()),
    phone: `+20 1${String(Math.floor(random() * 3))}${String(Math.floor(random() * 10))} ${String(
      100 + Math.floor(random() * 900),
    )} ${String(1000 + Math.floor(random() * 9000))}`,
  };
}

/**
 * Deterministic chart for one patient — same output on every visit. The
 * mock adapter serves the opening bundle and each tab out of this one
 * generated record, so the two can never disagree.
 *
 * `medications`, when given, replaces the generated regimen — the demo
 * passes the patient's prescriptions from the shared store, so the chart
 * shows what the prescribing flow screens (NEW-05). The generated one is
 * still drawn, so every field after it comes out of the seeded generator
 * exactly as before.
 */
export function buildPatientProfile(
  patient: Patient,
  medicationsOnRecord?: readonly MedicationRecord[],
): PatientProfile & ProfileTabData {
  const random = mulberry32(hashString(patient.id));

  const generated = buildMedications(patient, random);
  const medications = medicationsOnRecord ?? generated;
  const labCategories = buildStudies(patient, random, 'lab', LAB_CATALOGUE);

  return {
    summary: buildSummary(patient, medications),
    vitals: buildVitals(patient, random),
    allergies: buildAllergies(patient, random),
    medications,
    history: buildHistory(patient, random),
    imaging: buildStudies(patient, random, 'img', IMAGING_CATALOGUE),
    appointments: buildAppointments(patient, random),
    notes: buildNotes(patient, random),
    documents: buildDocuments(patient, random),
    emergencyContacts: [
      { id: `${patient.id}-ec-1`, isPrimary: true, ...buildEmergencyContact(patient, random) },
    ],
    insurance: {
      provider: pick(
        ['MedCare Egypt', 'Allianz Health', 'AXA Medical', 'Misr Insurance'],
        random(),
      ),
      policyNumber: `POL-${String(100000 + Math.floor(random() * 899999))}`,
      plan: pick(['Standard', 'Comprehensive', 'Premium'], random()),
      validUntil: isoDaysFromNow(90 + Math.floor(random() * 500), 0, 0),
    },
    alerts: buildAlerts(patient, labCategories),
  };
}
