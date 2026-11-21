import type { FlowStep } from '@/components/patterns';
import {
  LAB_DEPARTMENTS,
  type LabPriority,
  type LabTest,
  type TestSpec,
} from '@/features/shared-domain/lab-studies';
import type { Patient } from '@/features/shared-domain/patient-identity';


/**
 * Ordering a lab (DX-23).
 *
 * §0 named this directly — "a doctor still cannot order a lab" — and DX-23
 * was gated on D-10…D-14, which built the *review* half and left ordering
 * unbuilt. The dashboard's "Order lab" action had nothing to link to.
 *
 * Shaped like the prescription and record flows deliberately: a step id
 * union, a draft that accumulates, a single producer of the value the
 * service accepts. The fail-closed machinery here is lighter than D-17's —
 * ordering a test is reversible in a way signing a prescription is not — but
 * the shape is the same so the module reads as one idiom.
 */

export type OrderStepId = 'patient' | 'tests' | 'details';

export const ORDER_STEPS: readonly FlowStep<OrderStepId>[] = [
  { id: 'patient', label: 'Patient', caption: 'Who the work is for' },
  { id: 'tests', label: 'Tests', caption: 'What to run' },
  { id: 'details', label: 'Details', caption: 'Priority and indication' },
];

export const ORDER_STEP_IDS: readonly OrderStepId[] = ORDER_STEPS.map((step) => step.id);

export function orderStepIndex(step: OrderStepId): number {
  return ORDER_STEP_IDS.indexOf(step);
}

/** What the flow accumulates. Every field optional until it is filled. */
export interface LabOrderDraft {
  readonly patient: Patient | null;
  readonly testCodes: readonly string[];
  readonly priority: LabPriority;
  readonly department: string;
  readonly clinicalIndication: string;
}

export const EMPTY_LAB_ORDER: LabOrderDraft = {
  patient: null,
  testCodes: [],
  priority: 'routine',
  department: LAB_DEPARTMENTS[0] ?? 'General Medicine',
  clinicalIndication: '',
};

/** The specs for the chosen codes, from the catalogue the caller holds (the service's). */
export function specsFor(
  codes: readonly string[],
  catalogue: readonly TestSpec[],
): readonly TestSpec[] {
  return catalogue.filter((spec) => codes.includes(spec.code));
}

/* ── Step validity ──────────────────────────────────────────────── */

export function isOrderStepValid(draft: LabOrderDraft, step: OrderStepId): boolean {
  switch (step) {
    case 'patient':
      return draft.patient !== null;
    case 'tests':
      return draft.testCodes.length > 0;
    case 'details':
      return draft.clinicalIndication.trim().length > 0;
  }
}

/**
 * A step is reachable when every step before it validates — the same
 * "cannot skip forward past an invalid step" rule D-17 established, so a
 * doctor cannot land on Details with no patient chosen.
 */
export function isOrderStepReachable(draft: LabOrderDraft, step: OrderStepId): boolean {
  const target = orderStepIndex(step);
  return ORDER_STEP_IDS.slice(0, target).every((prior) => isOrderStepValid(draft, prior));
}

/* ── The orderable value ────────────────────────────────────────── */

const ORDERABLE = Symbol('orderable');

/** The only value `LabService.orderLabs` accepts. */
export interface OrderableLabRequest {
  readonly [ORDERABLE]: true;
  readonly patient: Patient;
  readonly specs: readonly TestSpec[];
  readonly priority: LabPriority;
  readonly department: string;
  readonly clinicalIndication: string;
  readonly orderedBy: string;
}

export type OrderBlockedReason =
  | 'no-patient'
  | 'no-tests'
  | 'no-indication'
  | 'no-orderer'
  | 'unknown-test';

export const ORDER_BLOCKED_META: Record<OrderBlockedReason, string> = {
  'no-patient': 'Choose the patient this work is for.',
  'no-tests': 'Choose at least one test to order.',
  'no-indication': 'A clinical indication is required — the lab reads it.',
  'no-orderer': 'No signed-in clinician to attribute this order to.',
  'unknown-test': 'One of the selected tests is not in the catalogue.',
};

export interface OrderAssessmentInput {
  readonly draft: LabOrderDraft;
  readonly orderedBy: string;
  /** The orderable tests — the service's catalogue, already loaded. */
  readonly catalogue: readonly TestSpec[];
}

export type OrderAssessment =
  | { readonly orderable: OrderableLabRequest; readonly blockedBy: null }
  | { readonly orderable: null; readonly blockedBy: OrderBlockedReason };

/**
 * The only producer of `OrderableLabRequest`.
 *
 * The clinical indication is required rather than optional because the
 * laboratory reads it: it decides add-on testing and reflex protocols, and
 * an order that arrives without one is a phone call back to the ward. That
 * is a rule about the order being useful, not about the form being tidy.
 */
export function assessOrder(input: OrderAssessmentInput): OrderAssessment {
  const { draft, orderedBy, catalogue } = input;

  if (draft.patient === null) return { orderable: null, blockedBy: 'no-patient' };
  if (draft.testCodes.length === 0) return { orderable: null, blockedBy: 'no-tests' };

  const specs = specsFor(draft.testCodes, catalogue);
  // A code the catalogue does not carry would produce an order naming a test
  // no lab can run; refused rather than dropped silently.
  if (specs.length !== draft.testCodes.length) {
    return { orderable: null, blockedBy: 'unknown-test' };
  }

  const indication = draft.clinicalIndication.trim();
  if (indication === '') return { orderable: null, blockedBy: 'no-indication' };
  if (orderedBy.trim() === '') return { orderable: null, blockedBy: 'no-orderer' };

  return {
    orderable: {
      [ORDERABLE]: true,
      patient: draft.patient,
      specs,
      priority: draft.priority,
      department: draft.department,
      clinicalIndication: indication,
      orderedBy,
    },
    blockedBy: null,
  };
}

export class NotOrderableError extends Error {
  constructor() {
    super('Value was not produced by assessOrder');
    this.name = 'NotOrderableError';
  }
}

export function assertOrderable(value: OrderableLabRequest): void {
  if (value[ORDERABLE] !== true) throw new NotOrderableError();
}

/**
 * Builds the orders a request becomes — **one `LabTest` per test**, not one
 * per request. That is how the rest of the module already thinks: the
 * worklist, the review loop and the patient profile are all keyed on a
 * single test, and a multi-test order collapsed into one row would be
 * reviewable only as a unit, which UX §2.6's per-result review forbids.
 */
export function toOrderedTests(request: OrderableLabRequest, now: Date): readonly LabTest[] {
  const requestedDate = now.toISOString();

  return request.specs.map((spec, index) => ({
    id: `LAB-${String(now.getTime())}-${String(index + 1)}`,
    patient: {
      id: request.patient.id,
      name: request.patient.name,
      mrn: request.patient.mrn,
      age: request.patient.age,
      gender: request.patient.gender,
      bloodType: request.patient.bloodType,
      phone: request.patient.phone,
    },
    testName: spec.name,
    testCode: spec.code,
    category: spec.category,
    department: request.department,
    orderedBy: request.orderedBy,
    clinicalIndication: request.clinicalIndication,
    status: 'ordered',
    priority: request.priority,
    requestedDate,
    collectedDate: null,
    completedDate: null,
    specimen: null,
    // Nothing is resulted at order time. An empty result list is what keeps
    // this out of the review Inbox until the lab releases something.
    results: [],
    interpretation: null,
    hasCriticalResult: false,
    review: null,
    attachments: [],
    annotations: [],
    timeline: [
      {
        id: `LAB-${String(now.getTime())}-${String(index + 1)}-tl-ordered`,
        kind: 'ordered',
        at: requestedDate,
        actor: request.orderedBy,
        detail:
          'Order placed. Recorded in this demo session only — no laboratory system is connected.',
      },
    ],
    createdAt: requestedDate,
    updatedAt: requestedDate,
  }));
}
