import {
  DOCTORS,
  MOCK_PATIENTS,
  isoDaysFromNow,
  mulberry32,
  pick,
  weighted,
} from '@/features/shared-domain/patient-identity';

import { MEDICATION_CATALOGUE, type MedicationSpec } from './catalogue';
import {
  type Medication,
  type MedicationHistoryEntry,
  type Prescription,
  type PrescriptionNote,
  type PrescriptionStatus,
  type PrescriptionTimelineEvent,
  type RefillStatus,
  type SafetyWarning,
  PRESCRIBER_DEPARTMENTS,
} from './types';

/**
 * PHASE 12 MOCK DATA — five representative prescriptions, one per
 * canonical roster patient (names/MRNs/ids/allergies stay coherent with
 * the other modules, so allergy warnings fire against the patient's real
 * allergy list — Mona's Amoxicillin trips her recorded Penicillin
 * allergy). Each prescription's medication/status/recency comes from
 * SEED_PLAN so the tiny dataset still demonstrates the full lifecycle:
 * active, started today, pending refill, high-risk, expired, and awaiting
 * approval (the NEW-10 fixture below).
 * Replaced by the prescription endpoints in a later phase.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

interface SeedPlan {
  readonly generic: string;
  readonly status: PrescriptionStatus;
  readonly dayOffset: number;
  readonly durationDays: number;
  readonly refillStatus?: RefillStatus;
  /** A medication that is not on the demo formulary (see the NEW-10 fixture). */
  readonly spec?: MedicationSpec;
  /** Overrides the index ↔ patient pairing below. */
  readonly patientIndex?: number;
}

/**
 * NEW-10 — the one demo prescription awaiting approval, so "Cancel
 * prescription" can be exercised in the browser (DEC-002 offers it only on
 * `pending-approval`).
 *
 * The server sets that status only when the signed medication is
 * **controlled** (`prescription-status.machine.ts`: `isControlled ?
 * 'PENDING_APPROVAL' : 'ACTIVE'`), and no demo formulary entry is, so the
 * status could not occur in the demo. A pending row for an ordinary demo
 * drug would show something the server never produces; this one carries a
 * controlled medication. It is **not** in `MEDICATION_CATALOGUE`, so the
 * authoring flow cannot offer it, and it records no interaction note or
 * allergy class — no prescribing prose is invented for it. High-alert
 * because opioids are on ISMP's high-alert list.
 */
export const PENDING_APPROVAL_FIXTURE_SPEC: MedicationSpec = {
  id: 'demo-fixture-tramadol',
  name: 'Ultram',
  genericName: 'Tramadol',
  category: 'Opioids',
  form: 'Tablet',
  route: 'Oral',
  strengths: ['50 mg'],
  manufacturer: 'Janssen',
  isControlled: true,
  isHighRisk: true,
  interactionNote: null,
  allergyClass: null,
  frequencies: ['Every 6 hours as needed'],
  durationsDays: [5],
};

/** index ↔ MOCK_PATIENTS index: Khaled · Mona · Amira · Omar · Layla. */
const SEED_PLAN: readonly SeedPlan[] = [
  { generic: 'Metformin', status: 'active', dayOffset: -90, durationDays: 180 },
  { generic: 'Amoxicillin', status: 'active', dayOffset: 0, durationDays: 7 },
  { generic: 'Levothyroxine', status: 'active', dayOffset: -30, durationDays: 90 },
  {
    generic: 'Warfarin',
    status: 'active',
    dayOffset: -14,
    durationDays: 90,
    refillStatus: 'pending',
  },
  { generic: 'Atorvastatin', status: 'expired', dayOffset: -120, durationDays: 30 },
  // Appended last: the seeded generator is consumed in index order, so the
  // five entries above come out exactly as they did before it existed.
  {
    generic: 'Tramadol',
    spec: PENDING_APPROVAL_FIXTURE_SPEC,
    status: 'pending-approval',
    dayOffset: 0,
    durationDays: 5,
    // Amira: no test treats her regimen as fixed. Not Layla — the authoring
    // tests use her as the patient with nothing running, whose screen is clear.
    patientIndex: 2,
  },
];

const TOTAL_PRESCRIPTIONS = SEED_PLAN.length;

function hoursAfter(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() + hours * HOUR_MS).toISOString();
}

function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * DAY_MS).toISOString();
}

const PHARMACISTS: readonly string[] = [
  'Pharm. Dalia Nabil',
  'Pharm. Hossam Fathy',
  'Pharm. Rania Adel',
];

const NOTE_BODIES: readonly string[] = [
  'Counselled the patient on administration and expected effects. Written information provided.',
  'Confirmed adherence to the current regimen; no adverse effects reported.',
  'Advised to complete the full course even if symptoms improve early.',
  'Reviewed potential side effects and safety-net advice for red-flag symptoms.',
  'Dose reviewed against renal function; no adjustment required at this time.',
];

const HISTORY_EVENTS: ReadonlyArray<readonly [string, string]> = [
  ['Initial prescription', 'Started on this medication.'],
  ['Dose adjusted', 'Dose changed following clinical review.'],
  ['Refill dispensed', 'A repeat supply was collected by the patient.'],
  ['Switched therapy', 'Changed from a previous agent for better control.'],
  ['Adherence review', 'Adherence discussed; regimen continued unchanged.'],
];

/* ── Status by date coherence ───────────────────────────────────── */

const TODAY_STATUS: ReadonlyArray<readonly [PrescriptionStatus, number]> = [
  ['active', 55],
  ['pending-approval', 45],
];

const ONGOING_STATUS: ReadonlyArray<readonly [PrescriptionStatus, number]> = [
  ['active', 88],
  ['discontinued', 12],
];

const ENDED_STATUS: ReadonlyArray<readonly [PrescriptionStatus, number]> = [
  ['completed', 50],
  ['expired', 28],
  ['discontinued', 22],
];

const REFILL_WEIGHTS: ReadonlyArray<readonly [RefillStatus, number]> = [
  ['available', 55],
  ['due', 25],
  ['pending', 20],
];

/* ── Helpers ────────────────────────────────────────────────────── */

function dosesPerDay(frequency: string): number {
  const f = frequency.toLowerCase();
  if (f.includes('four')) return 4;
  if (f.includes('three')) return 3;
  if (f.includes('twice') || f.includes('12 hours')) return 2;
  return 1;
}

function buildInstructions(spec: MedicationSpec, strength: string, frequency: string): string {
  const verb =
    spec.route === 'Inhalation' ? 'Inhale' : spec.route === 'Oral' ? 'Take' : 'Administer';
  const via =
    spec.route === 'Oral'
      ? ' by mouth'
      : spec.route === 'Inhalation'
        ? ''
        : ` (${spec.route.toLowerCase()})`;
  const food =
    spec.route === 'Oral' && spec.category === 'Analgesics' ? ' Take with or after food.' : '';
  return `${verb} ${strength}, ${frequency.toLowerCase()}${via}.${food}`.trim();
}

function toMedication(spec: MedicationSpec, strength: string): Medication {
  return {
    name: spec.name,
    genericName: spec.genericName,
    category: spec.category,
    strength,
    form: spec.form,
    route: spec.route,
    manufacturer: spec.manufacturer,
    isControlled: spec.isControlled,
    isHighRisk: spec.isHighRisk,
    interactionNote: spec.interactionNote,
    allergyClass: spec.allergyClass,
  };
}

function buildWarnings(
  rxId: string,
  spec: MedicationSpec,
  patient: { readonly allergies: readonly string[]; readonly hasSevereAllergy: boolean },
  random: () => number,
): readonly SafetyWarning[] {
  const warnings: SafetyWarning[] = [];

  if (spec.allergyClass !== null && patient.allergies.includes(spec.allergyClass)) {
    warnings.push({
      id: `${rxId}-w-allergy`,
      kind: 'allergy',
      severity: patient.hasSevereAllergy ? 'critical' : 'warning',
      title: `Allergy conflict: ${spec.allergyClass}`,
      detail: `Patient has a recorded ${spec.allergyClass} allergy. ${spec.genericName} may cross-react — verify before dispensing.`,
    });
  }

  if (spec.interactionNote !== null && random() < 0.35) {
    warnings.push({
      id: `${rxId}-w-interaction`,
      kind: 'interaction',
      severity: spec.isHighRisk ? 'critical' : 'warning',
      title: 'Potential drug interaction',
      detail: spec.interactionNote,
    });
  }

  if (random() < 0.08) {
    warnings.push({
      id: `${rxId}-w-duplicate`,
      kind: 'duplicate',
      severity: 'warning',
      title: 'Possible duplicate therapy',
      detail: `Another active ${spec.category} prescription may already be on file — review before dispensing.`,
    });
  }

  if (random() < (spec.isHighRisk ? 0.18 : 0.05)) {
    warnings.push({
      id: `${rxId}-w-dosage`,
      kind: 'dosage',
      severity: spec.isHighRisk ? 'critical' : 'warning',
      title: 'Dosage alert',
      detail: `The prescribed dose is near the upper limit for ${spec.genericName}; confirm renal and hepatic function.`,
    });
  }

  return warnings;
}

function buildNotes(
  rxId: string,
  prescriber: string,
  startDate: string,
  random: () => number,
): readonly PrescriptionNote[] {
  const count = weighted(
    [
      [0, 35],
      [1, 45],
      [2, 20],
    ] as const,
    random(),
  );
  return Array.from({ length: count }, (_, i) => ({
    id: `${rxId}-note-${String(i + 1)}`,
    author: random() < 0.6 ? prescriber : pick(PHARMACISTS, random()),
    authoredAt: hoursAfter(startDate, 2 + i * 20 + Math.floor(random() * 10)),
    body: pick(NOTE_BODIES, random()),
  }));
}

function buildHistory(
  rxId: string,
  startDate: string,
  random: () => number,
): readonly MedicationHistoryEntry[] {
  const count = weighted(
    [
      [1, 40],
      [2, 40],
      [3, 20],
    ] as const,
    random(),
  );
  return Array.from({ length: count }, (_, i) => {
    const entry = HISTORY_EVENTS[i % HISTORY_EVENTS.length] ?? HISTORY_EVENTS[0]!;
    return {
      id: `${rxId}-hist-${String(i + 1)}`,
      date: addDays(startDate, -(30 + i * 45 + Math.floor(random() * 20))),
      event: entry[0],
      detail: entry[1],
    };
  });
}

function buildTimeline(input: {
  readonly rxId: string;
  readonly prescriber: string;
  readonly status: PrescriptionStatus;
  readonly refillStatus: RefillStatus;
  readonly startDate: string;
  readonly endDate: string;
  readonly updatedAt: string;
  readonly random: () => number;
}): readonly PrescriptionTimelineEvent[] {
  const { rxId, prescriber, status, refillStatus, startDate, endDate, updatedAt, random } = input;
  const events: PrescriptionTimelineEvent[] = [
    {
      id: `${rxId}-tl-prescribed`,
      kind: 'prescribed',
      at: startDate,
      actor: prescriber,
      detail: 'Prescription created and sent to the pharmacy.',
    },
  ];

  if (status !== 'pending-approval') {
    events.push({
      id: `${rxId}-tl-dispensed`,
      kind: 'dispensed',
      at: hoursAfter(startDate, 3 + Math.floor(random() * 20)),
      actor: pick(PHARMACISTS, random()),
      detail: 'Medication dispensed to the patient.',
    });
  }

  if (refillStatus === 'pending') {
    events.push({
      id: `${rxId}-tl-refill-req`,
      kind: 'refill-requested',
      at: updatedAt,
      actor: 'Patient portal',
      detail: 'Refill requested — awaiting prescriber approval.',
    });
  } else if (refillStatus === 'available' && random() < 0.4) {
    events.push({
      id: `${rxId}-tl-refill-appr`,
      kind: 'refill-approved',
      at: hoursAfter(startDate, 24 * 20),
      actor: prescriber,
      detail: 'A refill was approved and dispensed.',
    });
  }

  if (status === 'discontinued') {
    events.push({
      id: `${rxId}-tl-discontinued`,
      kind: 'discontinued',
      at: updatedAt,
      actor: prescriber,
      detail: 'Medication discontinued before the end of the course.',
    });
  } else if (status === 'expired') {
    events.push({
      id: `${rxId}-tl-expired`,
      kind: 'expired',
      at: endDate,
      actor: 'System',
      detail: 'Prescription validity lapsed without renewal.',
    });
  }

  return events.sort((a, b) => a.at.localeCompare(b.at));
}

/* ── Prescription builder ───────────────────────────────────────── */

function buildPrescription(index: number, random: () => number): Prescription {
  const plan = SEED_PLAN[index];
  const patient =
    MOCK_PATIENTS[plan?.patientIndex ?? index % MOCK_PATIENTS.length] ??
    pick(MOCK_PATIENTS, random());
  const spec =
    plan?.spec ??
    MEDICATION_CATALOGUE.find((candidate) => candidate.genericName === plan?.generic) ??
    pick(MEDICATION_CATALOGUE, random());
  const id = `RX-${String(200_001 + index)}`;

  const strength = pick(spec.strengths, random());
  const frequency = pick(spec.frequencies, random());
  const durationDays = plan?.durationDays ?? pick(spec.durationsDays, random());

  const dayOffset = plan?.dayOffset ?? -(1 + Math.floor(random() * 365));
  const startDate = isoDaysFromNow(dayOffset, 9 + Math.floor(random() * 8), 0);
  const endDate = addDays(startDate, durationDays);
  const endInPast = new Date(endDate).getTime() < Date.now();

  const status: PrescriptionStatus =
    plan?.status ??
    weighted(dayOffset === 0 ? TODAY_STATUS : endInPast ? ENDED_STATUS : ONGOING_STATUS, random());

  const refillsAllowed = spec.isControlled
    ? 0
    : spec.durationsDays[0] !== undefined && spec.durationsDays[0] >= 30
      ? 1 + Math.floor(random() * 5)
      : Math.floor(random() * 2);
  const refillsRemaining =
    refillsAllowed === 0
      ? 0
      : plan?.refillStatus !== undefined && plan.refillStatus !== 'none'
        ? 1 + Math.floor(random() * refillsAllowed)
        : Math.floor(random() * (refillsAllowed + 1));

  const refillStatus: RefillStatus =
    status !== 'active' || refillsAllowed === 0 || refillsRemaining === 0
      ? 'none'
      : (plan?.refillStatus ?? weighted(REFILL_WEIGHTS, random()));

  const updatedAt =
    status === 'discontinued'
      ? addDays(startDate, Math.floor(durationDays * (0.3 + random() * 0.4)))
      : status === 'expired' || status === 'completed'
        ? endDate
        : refillStatus === 'pending'
          ? isoDaysFromNow(-Math.floor(random() * 5), 10, 0)
          : startDate;

  const dpd = dosesPerDay(frequency);
  const quantity =
    spec.form === 'Inhaler' || spec.form === 'Injection'
      ? 1 + Math.floor(random() * 3)
      : durationDays * dpd;

  const prescribingDoctor = random() < 0.7 ? 'Dr. Amelia Chen' : pick(DOCTORS, random());

  return {
    id,
    patient: {
      id: patient.id,
      name: patient.name,
      mrn: patient.mrn,
      age: patient.age,
      gender: patient.gender,
      bloodType: patient.bloodType,
      phone: patient.phone,
      allergies: patient.allergies,
      hasSevereAllergy: patient.hasSevereAllergy,
    },
    medication: toMedication(spec, strength),
    dosage: strength,
    frequency,
    route: spec.route,
    duration: `${String(durationDays)} days`,
    durationDays,
    quantity,
    instructions: buildInstructions(spec, strength, frequency),
    prescribingDoctor,
    department: pick(PRESCRIBER_DEPARTMENTS, random()),
    status,
    startDate,
    endDate,
    refillsAllowed,
    refillsRemaining,
    refillStatus,
    warnings: buildWarnings(id, spec, patient, random),
    notes: buildNotes(id, prescribingDoctor, startDate, random),
    history: buildHistory(id, startDate, random),
    timeline: buildTimeline({
      rxId: id,
      prescriber: prescribingDoctor,
      status,
      refillStatus,
      startDate,
      endDate,
      updatedAt,
      random,
    }),
    createdAt: startDate,
    updatedAt,
  };
}

const random = mulberry32(0x9c0f_fee2);

export const MOCK_PRESCRIPTIONS: readonly Prescription[] = Array.from(
  { length: TOTAL_PRESCRIPTIONS },
  (_, index) => buildPrescription(index, random),
);
