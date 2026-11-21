import {
  DOCTORS,
  MOCK_PATIENTS,
  isoDaysFromNow,
  mulberry32,
  pick,
  weighted,
} from '@/features/shared-domain/patient-identity';

import { TEST_CATALOGUE, type AnalyteSpec, type TestSpec } from './catalogue';
import {
  LAB_DEPARTMENTS,
  isCriticalFlag,
  type LabAttachment,
  type LabResultFlag,
  type LabResultItem,
  type LabSpecimen,
  type LabSpecimenCondition,
  type LabSpecimenType,
  type LabReview,
  type LabTest,
  type LabTestStatus,
  type LabPriority,
  type LabTimelineEvent,
} from './types';

/**
 * PHASE 12 MOCK DATA — five representative laboratory tests, one per
 * canonical roster patient (names/MRNs/ids stay coherent with Patients,
 * Appointments, and Medical Records, so "View patient" lands on the
 * matching profile). Each test's spec/status/recency comes from SEED_PLAN
 * so the tiny dataset still demonstrates the full lifecycle — ordered,
 * collected, processing, completed, and a critical potassium on Omar
 * Farouk that matches the dashboard alert. Replaced by the lab endpoints
 * in a later phase — `LabTest` already mirrors the list DTO.
 *
 * **D-13 added a history.** A trend needs more than one point, and five
 * orders across five patients gave every analyte exactly one — so the same
 * panel is seeded four more times per patient at monthly intervals, already
 * reviewed, which is also what makes the Inbox mean something: the five live
 * orders are the ones awaiting the doctor, the twenty behind them are not.
 * Omar Farouk's potassium is the one series that is not random — 4.4 → 4.9 →
 * 5.3 → 5.6 and then the critical 6.1 the dashboard alert names — because a
 * trend view whose only story is noise demonstrates nothing.
 */

const MINUTE_MS = 60_000;
const TOTAL_TESTS = 5;

interface SeedPlan {
  readonly testCode: string;
  readonly status: LabTestStatus;
  readonly dayOffset: number;
  readonly priority: LabPriority;
  readonly forceCriticalPotassium?: boolean;
}

/** How the prior generations of the same panel are laid out (D-13). */
const HISTORY_DAY_OFFSETS: readonly number[] = [-35, -72, -110, -149];

/**
 * Omar Farouk's potassium, oldest generation first, ending at the critical
 * 6.1 the live order carries. Indexed by generation, so the story reads the
 * same way every run.
 */
const POTASSIUM_SERIES: readonly number[] = [4.4, 4.7, 5, 5.6];

/** index ↔ MOCK_PATIENTS index: Khaled · Mona · Amira · Omar · Layla. */
const SEED_PLAN: readonly SeedPlan[] = [
  { testCode: '4548-4', status: 'completed', dayOffset: -6, priority: 'routine' },
  { testCode: '58410-2', status: 'ordered', dayOffset: 0, priority: 'routine' },
  { testCode: '55204-3', status: 'processing', dayOffset: -1, priority: 'urgent' },
  {
    testCode: '51990-0',
    status: 'completed',
    dayOffset: -1,
    priority: 'stat',
    forceCriticalPotassium: true,
  },
  { testCode: '57698-3', status: 'collected', dayOffset: 0, priority: 'routine' },
];

function minutesAfter(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * MINUTE_MS).toISOString();
}

const CLINICAL_INDICATIONS: readonly string[] = [
  'Routine health screening',
  'Follow-up of chronic condition',
  'Pre-operative workup',
  'Evaluation of abnormal prior result',
  'New symptom investigation',
  'Medication monitoring',
  'Suspected infection',
  'Annual diabetic review',
];

const COLLECTORS: readonly string[] = [
  'Nurse Mariam Adel',
  'Nurse Youssef Gaber',
  'Phleb. Hana Saleh',
  'Phleb. Sami Fouad',
];

const LAB_STAFF: readonly string[] = [
  'Lab Tech. Nadia Selim',
  'Lab Tech. Karim Zaki',
  'Dr. Farida Ashour',
];

const SPECIMEN_CONDITIONS: ReadonlyArray<readonly [LabSpecimenCondition, number]> = [
  ['Acceptable', 88],
  ['Hemolyzed', 6],
  ['Clotted', 3],
  ['Insufficient volume', 3],
];

function collectionSiteFor(specimen: LabSpecimenType, random: () => number): string {
  switch (specimen) {
    case 'Whole blood':
    case 'Serum':
    case 'Plasma':
      return pick(
        ['Left antecubital vein', 'Right antecubital vein', 'Dorsal hand vein'],
        random(),
      );
    case 'Urine':
      return 'Midstream clean-catch';
    case 'Swab':
      return 'Posterior pharynx';
    case 'Tissue biopsy':
      return 'Operative specimen';
    case 'Stool':
      return 'Patient-collected';
    case 'Sputum':
      return 'Deep-cough expectorate';
    case 'CSF':
      return 'Lumbar puncture, L3–L4';
    default:
      return 'Not specified';
  }
}

function volumeFor(specimen: LabSpecimenType): string {
  switch (specimen) {
    case 'Whole blood':
    case 'Serum':
    case 'Plasma':
      return '5 mL';
    case 'Urine':
      return '20 mL';
    case 'CSF':
      return '2 mL';
    case 'Swab':
      return '1 swab';
    case 'Tissue biopsy':
      return '1 specimen';
    default:
      return '1 sample';
  }
}

const NUMERIC_OUTCOME: ReadonlyArray<readonly ['normal' | 'low' | 'high' | 'critical', number]> = [
  ['normal', 72],
  ['low', 9],
  ['high', 13],
  ['critical', 6],
];

/* ── Result generation ──────────────────────────────────────────── */

function formatNumber(value: number, decimals: number): string {
  return value.toFixed(decimals);
}

function qualitativeFlag(value: string, index: number): LabResultFlag {
  if (index === 0) return 'normal';
  return /malignant|isolated|cfu|incompatible|high-grade|lesion/i.test(value)
    ? 'critical-high'
    : 'abnormal';
}

function buildNumericResult(
  analyte: AnalyteSpec,
  random: () => number,
): { readonly value: string; readonly numericValue: number; readonly flag: LabResultFlag } {
  const low = analyte.low ?? 0;
  const high = analyte.high ?? low + 1;
  const span = high - low || 1;
  const decimals = analyte.decimals ?? 1;
  const outcome = weighted(NUMERIC_OUTCOME, random());

  let raw: number;
  let flag: LabResultFlag;

  if (
    outcome === 'critical' &&
    analyte.criticalHigh !== undefined &&
    (analyte.criticalLow === undefined || random() < 0.6)
  ) {
    raw = analyte.criticalHigh + span * (0.2 + random() * 0.5);
    flag = 'critical-high';
  } else if (outcome === 'critical' && analyte.criticalLow !== undefined) {
    raw = Math.max(0, analyte.criticalLow - span * (0.1 + random() * 0.3));
    flag = 'critical-low';
  } else if (outcome === 'high' || (outcome === 'critical' && low === 0)) {
    raw = high + span * (0.03 + random() * 0.25);
    flag = 'high';
  } else if (outcome === 'low' && low > 0) {
    raw = Math.max(0, low - span * (0.05 + random() * 0.25));
    flag = 'low';
  } else {
    raw = low + random() * span;
    flag = 'normal';
  }

  const rounded = Number(formatNumber(raw, decimals));
  return { value: formatNumber(rounded, decimals), numericValue: rounded, flag };
}

/** Flag for a pinned value — used by the seeded potassium series (D-13). */
function flagForValue(value: number, low: number | null, high: number | null): LabResultFlag {
  if (low !== null && value < low) return 'low';
  if (high !== null && value > high) return 'high';
  return 'normal';
}

function referenceText(analyte: AnalyteSpec): string {
  if (analyte.low !== null && analyte.high !== null) {
    const decimals = analyte.decimals ?? 1;
    return `${formatNumber(analyte.low, decimals)}–${formatNumber(analyte.high, decimals)}`;
  }
  return analyte.qualitative?.[0] ?? 'See report';
}

function buildResult(
  testId: string,
  analyte: AnalyteSpec,
  i: number,
  random: () => number,
): LabResultItem {
  const id = `${testId}-r${String(i + 1)}`;
  const referenceRange = {
    low: analyte.low,
    high: analyte.high,
    text: referenceText(analyte),
  };

  if (analyte.qualitative !== undefined) {
    // Qualitative: mostly the normal (index 0) option.
    const abnormal = random() < 0.22;
    const index = abnormal ? 1 + Math.floor(random() * (analyte.qualitative.length - 1)) : 0;
    const value = analyte.qualitative[index] ?? analyte.qualitative[0] ?? 'Not reported';
    return {
      id,
      analyte: analyte.analyte,
      value,
      numericValue: null,
      unit: analyte.unit,
      referenceRange,
      flag: qualitativeFlag(value, index),
    };
  }

  const numeric = buildNumericResult(analyte, random);
  return {
    id,
    analyte: analyte.analyte,
    value: numeric.value,
    numericValue: numeric.numericValue,
    unit: analyte.unit,
    referenceRange,
    flag: numeric.flag,
  };
}

/* ── Interpretation ─────────────────────────────────────────────── */

function buildInterpretation(results: readonly LabResultItem[]): string {
  const hasCritical = results.some((result) => isCriticalFlag(result.flag));
  const hasAbnormal = results.some((result) => result.flag !== 'normal');
  if (hasCritical) {
    return 'Critical value(s) identified and flagged to the ordering team. Immediate clinical correlation and repeat verification are advised before acting on the result.';
  }
  if (hasAbnormal) {
    return 'One or more analytes fall outside the reference range. Correlate with the clinical picture; a repeat or confirmatory test may be warranted.';
  }
  return 'All measured analytes are within their reference ranges. No action is indicated based on this result alone.';
}

/* ── Specimen & attachments ─────────────────────────────────────── */

function buildSpecimen(
  spec: TestSpec,
  collectedAt: string,
  received: boolean,
  random: () => number,
): LabSpecimen {
  return {
    type: spec.specimen,
    container: spec.container,
    collectionSite: collectionSiteFor(spec.specimen, random),
    collectedBy: pick(COLLECTORS, random()),
    collectedAt,
    receivedAt: received ? minutesAfter(collectedAt, 20 + Math.floor(random() * 90)) : null,
    condition: weighted(SPECIMEN_CONDITIONS, random()),
    volume: volumeFor(spec.specimen),
  };
}

function buildAttachments(
  testId: string,
  completedAt: string,
  random: () => number,
): readonly LabAttachment[] {
  const attachments: LabAttachment[] = [
    {
      id: `${testId}-att-report`,
      name: 'Laboratory report.pdf',
      kind: 'report',
      sizeKb: 120 + Math.floor(random() * 480),
      uploadedBy: pick(LAB_STAFF, random()),
      uploadedAt: completedAt,
    },
  ];
  if (random() < 0.25) {
    attachments.push({
      id: `${testId}-att-addendum`,
      name: 'Addendum note.pdf',
      kind: 'addendum',
      sizeKb: 40 + Math.floor(random() * 120),
      uploadedBy: pick(LAB_STAFF, random()),
      uploadedAt: minutesAfter(completedAt, 60 + Math.floor(random() * 240)),
    });
  }
  return attachments;
}

/* ── Timeline ───────────────────────────────────────────────────── */

function buildTimeline(test: {
  readonly id: string;
  readonly orderedBy: string;
  readonly status: LabTestStatus;
  readonly requestedDate: string;
  readonly collectedDate: string | null;
  readonly completedDate: string | null;
  readonly specimen: LabSpecimen | null;
  readonly updatedAt: string;
  readonly resultActor: string;
}): readonly LabTimelineEvent[] {
  const events: LabTimelineEvent[] = [
    {
      id: `${test.id}-tl-ordered`,
      kind: 'ordered',
      at: test.requestedDate,
      actor: test.orderedBy,
      detail: 'Laboratory order placed and routed to the lab.',
    },
  ];

  if (test.status === 'cancelled') {
    events.push({
      id: `${test.id}-tl-cancelled`,
      kind: 'cancelled',
      at: test.updatedAt,
      actor: test.orderedBy,
      detail: 'Order cancelled before completion.',
    });
    return events.sort((a, b) => a.at.localeCompare(b.at));
  }

  if (test.collectedDate && test.specimen) {
    events.push({
      id: `${test.id}-tl-collected`,
      kind: 'collected',
      at: test.collectedDate,
      actor: test.specimen.collectedBy,
      detail: `${test.specimen.type} specimen collected (${test.specimen.volume}).`,
    });
    if (test.specimen.receivedAt) {
      events.push({
        id: `${test.id}-tl-received`,
        kind: 'received',
        at: test.specimen.receivedAt,
        actor: 'Lab reception',
        detail: `Specimen received — condition: ${test.specimen.condition.toLowerCase()}.`,
      });
    }
  }

  if (test.status === 'processing' && test.specimen?.receivedAt) {
    events.push({
      id: `${test.id}-tl-processing`,
      kind: 'processing',
      at: minutesAfter(test.specimen.receivedAt, 15),
      actor: test.resultActor,
      detail: 'Analysis in progress on the automated line.',
    });
  }

  if (test.status === 'completed' && test.completedDate) {
    events.push({
      id: `${test.id}-tl-resulted`,
      kind: 'resulted',
      at: minutesAfter(test.completedDate, -30),
      actor: test.resultActor,
      detail: 'Results entered into the laboratory system.',
    });
    events.push({
      id: `${test.id}-tl-verified`,
      kind: 'verified',
      at: test.completedDate,
      actor: test.resultActor,
      detail: 'Results verified and released to the ordering team.',
    });
  }

  return events.sort((a, b) => a.at.localeCompare(b.at));
}

/* ── Test builder ───────────────────────────────────────────────── */

interface BuildOptions {
  readonly id: string;
  /** Index into the roster; the same patient across every generation. */
  readonly patientIndex: number;
  readonly plan: SeedPlan;
  /** Prior generations arrive already reviewed (D-13's history). */
  readonly reviewed: boolean;
  /** Pins one analyte's value, for the seeded potassium story. */
  readonly forcePotassium?: number;
}

function buildTest(options: BuildOptions, random: () => number): LabTest {
  const { id, patientIndex, plan, reviewed } = options;
  const patient = MOCK_PATIENTS[patientIndex % MOCK_PATIENTS.length] ?? pick(MOCK_PATIENTS, random());
  const spec =
    TEST_CATALOGUE.find((candidate) => candidate.code === plan.testCode) ??
    pick(TEST_CATALOGUE, random());

  const dayOffset = plan.dayOffset;
  const requestedDate = isoDaysFromNow(
    dayOffset,
    7 + Math.floor(random() * 3),
    Math.floor(random() * 59),
  );

  const status = plan.status;

  const collected = status === 'collected' || status === 'processing' || status === 'completed';
  const completed = status === 'completed';
  const resultActor = pick(LAB_STAFF, random());

  const collectedDate = collected
    ? minutesAfter(requestedDate, 60 + Math.floor(random() * 600))
    : null;
  const specimen =
    collectedDate !== null
      ? buildSpecimen(spec, collectedDate, status !== 'collected' || random() < 0.5, random)
      : null;
  const completedDate =
    completed && collectedDate !== null
      ? minutesAfter(collectedDate, 120 + Math.floor(random() * 1_440))
      : null;

  let results = completed
    ? spec.analytes.map((analyte, i) => buildResult(id, analyte, i, random))
    : [];
  if (plan.forceCriticalPotassium === true) {
    // The canonical critical result — matches the dashboard alert
    // ("Potassium 6.1 mmol/L — Omar Farouk, awaiting review").
    results = results.map((result) =>
      result.analyte === 'Potassium'
        ? { ...result, value: '6.1', numericValue: 6.1, flag: 'critical-high' }
        : result,
    );
  } else if (options.forcePotassium !== undefined) {
    const forced = options.forcePotassium;
    results = results.map((result) =>
      result.analyte === 'Potassium'
        ? {
            ...result,
            value: forced.toFixed(1),
            numericValue: forced,
            flag: flagForValue(forced, result.referenceRange.low, result.referenceRange.high),
          }
        : result,
    );
  }
  const hasCriticalResult = results.some((result) => isCriticalFlag(result.flag));
  const interpretation = completed ? buildInterpretation(results) : null;

  const updatedAt = completedDate ?? collectedDate ?? requestedDate;

  const base = {
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
    testName: spec.name,
    testCode: spec.code,
    category: spec.category,
    department: pick(LAB_DEPARTMENTS, random()),
    orderedBy: random() < 0.7 ? 'Dr. Amelia Chen' : pick(DOCTORS, random()),
    clinicalIndication: pick(CLINICAL_INDICATIONS, random()),
    status,
    priority: plan.priority,
    requestedDate,
    collectedDate,
    completedDate,
    specimen,
    results,
    interpretation,
    hasCriticalResult,
    attachments: completedDate !== null ? buildAttachments(id, completedDate, random) : [],
    // D-15: seeded empty. A demo annotation would be invented clinical
    // opinion attributed to a named doctor, which DX-10 forbids.
    annotations: [],
    createdAt: requestedDate,
    updatedAt,
  };

  const timeline = buildTimeline({ ...base, resultActor });

  /*
   * A seeded review is held to the same rule the live one is
   * (`model/review.ts`): every critical value on the result is acknowledged
   * and a note says what was done. Seeding a review that the model would
   * refuse to produce would make the dataset the one place the invariant
   * does not hold.
   */
  const criticalIds = results.filter((result) => isCriticalFlag(result.flag)).map((r) => r.id);
  const reviewedAt =
    completedDate !== null ? minutesAfter(completedDate, 90 + Math.floor(random() * 240)) : null;
  const review: LabReview | null =
    reviewed && completed && reviewedAt !== null
      ? {
          reviewedAt,
          reviewedBy: base.orderedBy,
          acknowledgedCriticalIds: criticalIds,
          note:
            criticalIds.length > 0
              ? 'Patient contacted, value repeated and treatment adjusted at the time.'
              : '',
        }
      : null;

  return {
    ...base,
    review,
    timeline:
      review === null
        ? timeline
        : [
            ...timeline,
            {
              id: `${id}-tl-reviewed`,
              kind: 'verified' as const,
              at: review.reviewedAt,
              actor: review.reviewedBy,
              detail: 'Result reviewed by the ordering clinician.',
            },
          ],
  };
}

const random = mulberry32(0x7ab5_ee7c);

/** The five live orders — one per roster patient, none of them reviewed yet. */
const CURRENT_TESTS: readonly LabTest[] = Array.from({ length: TOTAL_TESTS }, (_, index) => {
  const plan = SEED_PLAN[index];
  if (plan === undefined) throw new Error(`Missing lab seed plan at ${String(index)}`);
  return buildTest(
    { id: `LAB-${String(100_001 + index)}`, patientIndex: index, plan, reviewed: false },
    random,
  );
});

/**
 * Four prior generations of the same panel per patient, all completed. The
 * three older ones are already reviewed; the most recent (about five weeks
 * back) is not, which is what a doctor returning from leave actually finds —
 * and what gives the Inbox a mix of normal and abnormal results to exercise
 * both review paths, rather than a queue of one.
 *
 * Together they are also what gives D-13's trend view something to plot.
 */
const HISTORICAL_TESTS: readonly LabTest[] = SEED_PLAN.flatMap((plan, index) =>
  HISTORY_DAY_OFFSETS.map((dayOffset, generation) => {
    const potassium =
      plan.forceCriticalPotassium === true
        ? POTASSIUM_SERIES[POTASSIUM_SERIES.length - 1 - generation]
        : undefined;
    return buildTest(
      {
        id: `LAB-${String(100_001 + index)}-H${String(generation + 1)}`,
        patientIndex: index,
        plan: {
          testCode: plan.testCode,
          // A prior generation has necessarily finished, whatever the live
          // order's own state is.
          status: 'completed',
          dayOffset,
          priority: 'routine',
        },
        reviewed: generation > 0,
        ...(potassium === undefined ? {} : { forcePotassium: potassium }),
      },
      random,
    );
  }),
);

export const MOCK_LAB_TESTS: readonly LabTest[] = [...CURRENT_TESTS, ...HISTORICAL_TESTS];
