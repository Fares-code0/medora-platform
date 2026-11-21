import {
  prescriptionStore,
  resetPrescriptionStore,
} from '@/features/shared-domain/prescriptions';

import {
  findMedicationSpec,
  suggestedInstructions,
  type PrescriptionDraft,
} from '../model/authoring';
import { MEDICATION_CATALOGUE } from '../model/catalogue';
import {
  CURRENT_PRESCRIPTION_STATUSES,
  MEDICATION_SEARCH_PAGE_SIZE,
  PRESCRIPTION_NOTE_MAX,
  PRESCRIPTION_NOT_DRAFT,
  PRESCRIPTION_NOT_FOUND,
  type EndPrescriptionInput,
  type PrescriptionService,
} from '../model/prescription-service';
import {
  assertSignable,
  screenPrescription,
  type SafetyCheckSubject,
  type SignablePrescription,
} from '../model/safety-check';
import type {
  Medication,
  Prescription,
  PrescriptionTimelineEvent,
  SafetyWarning,
} from '../model/types';

/**
 * The pharmacy mock adapter — a session-lifetime store over the seeded
 * dataset, so writes genuinely mutate state for the session and every
 * consumer refreshes through query invalidation (the appointments module's
 * pattern).
 *
 * **Honesty rules this adapter is built to keep.**
 *
 * 1. Nothing here is transmitted anywhere. A signed prescription lands in an
 *    in-memory Map that dies with the tab. The timeline event it writes says
 *    so in words, and the UI reads that wording from the event rather than
 *    inventing a "sent to pharmacy" line of its own.
 * 2. Drafts are in memory too, deliberately **not** in `localStorage`:
 *    `services/preferences.ts` is the only sanctioned storage access in the
 *    app and it is for UI preferences, "never PHI, tokens, or clinical
 *    drafts". Drafts therefore survive navigation, which is what D-19 asks,
 *    and not a page reload, which nothing asks for.
 * 3. `checkSafety` computes from `catalogue.ts`'s canned notes. Every warning
 *    it returns carries `source: 'demo-formulary'`, which is what draws the
 *    demo marker in the UI (the DX-10 contract) — the label is data, so it
 *    cannot be deleted while the content stays fake.
 */

const MOCK_LATENCY_MS = 400;
const SAFETY_CHECK_LATENCY_MS = 900;

const delay = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });

/* ── Session stores ─────────────────────────────────────────────── */

/**
 * The shared demo store (`shared-domain/prescriptions`, NEW-05): the patient
 * chart shows these same prescriptions as the patient's medications, so a
 * course issued or stopped here is issued or stopped there.
 */
const prescriptions = prescriptionStore;

const drafts = new Map<string, PrescriptionDraft>();

/** Test-only reset so suites do not leak issued prescriptions into each other. */
export function __resetPharmacyStore(): void {
  resetPrescriptionStore();
  drafts.clear();
}

/**
 * Test hook: puts a prescription in the store as given — how a test reaches
 * a status the demo cannot produce through its own flows (no catalogue entry
 * is controlled, so nothing *signs* into `pending-approval`; the seed holds
 * one such prescription, the NEW-10 fixture, for the browser; drafts live in
 * their own store). Cleared by `__resetPharmacyStore`.
 */
export function __putMockPrescription(prescription: Prescription): void {
  prescriptions.set(prescription.id, prescription);
}

export { PRESCRIPTION_NOT_FOUND };

/* ── Helpers ────────────────────────────────────────────────────── */

const DAY_MS = 86_400_000;

function addDays(iso: string, days: number): string {
  return new Date(new Date(iso).getTime() + days * DAY_MS).toISOString();
}

function nextPrescriptionId(): string {
  const issued = Array.from(prescriptions.keys())
    .map((id) => Number.parseInt(id.replace('RX-', ''), 10))
    .filter((value) => Number.isFinite(value));
  return `RX-${String(Math.max(200_000, ...issued) + 1)}`;
}

function toMedication(genericName: string, strength: string): Medication | null {
  const spec = findMedicationSpec(genericName, MEDICATION_CATALOGUE);
  if (spec === null) return null;
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

/* ── The adapter ────────────────────────────────────────────────── */

/** The 409 the API answers when a prescription cannot be ended (API §7.9). */
function notEndable(detail: string, code: string): Error {
  return Object.assign(new Error('API error: conflict'), { kind: 'conflict', code, detail });
}

/**
 * Ends a prescription with the server's semantics (DEC-002, ADR-002 §4):
 * either act writes `discontinued` and removes the remaining refills; the
 * timeline records the act as the server does (`cancel: …`); a draft is
 * refused because nobody signed it, and an ended prescription because it
 * has ended.
 */
async function endPrescription(
  act: 'cancel' | 'discontinue',
  { prescriptionId, reason, details, actor }: EndPrescriptionInput,
): Promise<Prescription> {
  await delay(MOCK_LATENCY_MS);
  const current = prescriptions.get(prescriptionId);
  if (!current) throw new Error(PRESCRIPTION_NOT_FOUND);
  if (current.status === 'draft') {
    throw notEndable(
      'A draft cannot be discontinued: nobody signed it. An abandoned draft may simply be left.',
      'draft_not_discontinuable',
    );
  }
  if (
    current.status === 'completed' ||
    current.status === 'discontinued' ||
    current.status === 'expired'
  ) {
    throw notEndable(
      `This prescription has already ended (${current.status}).`,
      'invalid_status_transition',
    );
  }

  const now = new Date().toISOString();
  const stated = details.trim() === '' ? reason : `${reason} — ${details.trim()}`;
  const next: Prescription = {
    ...current,
    status: 'discontinued',
    refillStatus: 'none',
    refillsRemaining: 0,
    updatedAt: now,
    timeline: [
      ...current.timeline,
      {
        id: `${prescriptionId}-tl-${act}-${now}`,
        kind: 'discontinued',
        at: now,
        actor,
        detail: `${act}: ${stated}`,
      },
    ],
  };

  prescriptions.set(prescriptionId, next);
  return next;
}

export const mockPrescriptionService: PrescriptionService = {
  capabilities: { safetySource: 'demo-formulary', transmits: false, monographs: false },

  async listMedications() {
    await delay(MOCK_LATENCY_MS / 4);
    return MEDICATION_CATALOGUE;
  },

  /** The server's rule over the demo formulary: brand or generic name, any case. */
  async searchMedications(query) {
    await delay(MOCK_LATENCY_MS / 4);
    const needle = query.trim().toLowerCase();
    return MEDICATION_CATALOGUE.filter(
      (entry) =>
        entry.name.toLowerCase().includes(needle) ||
        entry.genericName.toLowerCase().includes(needle),
    ).slice(0, MEDICATION_SEARCH_PAGE_SIZE);
  },

  /** The demo formulary holds no monographs — see `capabilities.monographs`. */
  async getMonograph() {
    await delay(MOCK_LATENCY_MS / 4);
    return null;
  },

  async listPrescriptions() {
    await delay(MOCK_LATENCY_MS);
    return Array.from(prescriptions.values());
  },

  /*
   * The demo store holds every prescriber's prescriptions, so the patient's
   * running courses here are the same list the demo safety engine screens —
   * the strip cannot show a regimen the check did not see. There is no
   * patient-reported medication in the demo.
   */
  async listCurrentMedications(patientId) {
    await delay(MOCK_LATENCY_MS / 2);
    return Array.from(prescriptions.values())
      .filter(
        (prescription) =>
          prescription.patient.id === patientId &&
          CURRENT_PRESCRIPTION_STATUSES.has(prescription.status),
      )
      .map((prescription) => ({
        id: prescription.id,
        name: prescription.medication.name,
        dosage: prescription.dosage,
        frequency: prescription.frequency,
        prescriptionId: prescription.id,
        isHighRisk: prescription.medication.isHighRisk,
      }));
  },

  async getPrescription(prescriptionId) {
    await delay(MOCK_LATENCY_MS);
    const prescription = prescriptions.get(prescriptionId);
    if (!prescription) throw new Error(PRESCRIPTION_NOT_FOUND);
    return prescription;
  },

  async listDrafts() {
    await delay(MOCK_LATENCY_MS / 4);
    return Array.from(drafts.values());
  },

  async saveDraft(draft) {
    await delay(MOCK_LATENCY_MS);
    const saved: PrescriptionDraft = { ...draft, updatedAt: new Date().toISOString() };
    drafts.set(saved.id, saved);
    return saved;
  },

  async discardDraft(draftId) {
    await delay(MOCK_LATENCY_MS / 4);
    drafts.delete(draftId);
  },

  async checkSafety(subject: SafetyCheckSubject, signal: AbortSignal) {
    await delay(SAFETY_CHECK_LATENCY_MS, signal);
    return screenPrescription(subject);
  },

  async sign(signable: SignablePrescription) {
    // Belt and braces: the type already makes an unchecked signature
    // unrepresentable, and this refuses a cast at runtime.
    assertSignable(signable);
    await delay(MOCK_LATENCY_MS);

    const { draft, verdict, acknowledgment } = signable;
    const medication = toMedication(draft.spec.genericName, draft.strength);
    if (medication === null) throw new Error('Unknown medication');

    const id = nextPrescriptionId();
    const now = new Date().toISOString();
    const endDate = addDays(now, draft.durationDays);

    const warnings: readonly SafetyWarning[] = verdict.warnings.map((warning) => ({
      id: `${id}-${warning.id}`,
      kind: warning.kind,
      severity: warning.severity,
      title: warning.title,
      detail: warning.detail,
    }));

    const timeline: PrescriptionTimelineEvent[] = [
      {
        id: `${id}-tl-prescribed`,
        kind: 'prescribed',
        at: now,
        actor: draft.patient.name === '' ? 'Doctor' : 'Prescriber',
        // No claim of transmission: nothing left this browser.
        detail:
          'Prescription signed and recorded in this demo session. No pharmacy system is connected, so it was not transmitted.',
      },
    ];

    if (acknowledgment !== null && acknowledgment.warningIds.length > 0) {
      timeline.push({
        id: `${id}-tl-acknowledged`,
        kind: 'note-added',
        at: acknowledgment.acknowledgedAt,
        actor: 'Prescriber',
        detail: `Safety warnings acknowledged before signing (${String(acknowledgment.warningIds.length)}): ${acknowledgment.reason}`,
      });
    }

    const prescription: Prescription = {
      id,
      patient: draft.patient,
      medication,
      dosage: draft.strength,
      frequency: draft.frequency,
      route: draft.spec.route,
      duration: `${String(draft.durationDays)} days`,
      durationDays: draft.durationDays,
      quantity: draft.quantity,
      instructions: draft.instructions,
      prescribingDoctor: 'Dr. Amelia Chen',
      department: 'General Medicine',
      status: 'active',
      startDate: now,
      endDate,
      refillsAllowed: draft.refillsAllowed,
      refillsRemaining: draft.refillsAllowed,
      refillStatus: draft.refillsAllowed > 0 ? 'available' : 'none',
      warnings,
      notes:
        acknowledgment === null
          ? []
          : [
              {
                id: `${id}-note-ack`,
                author: 'Dr. Amelia Chen',
                authoredAt: acknowledgment.acknowledgedAt,
                body: acknowledgment.reason,
              },
            ],
      history: [],
      timeline,
      createdAt: now,
      updatedAt: now,
    };

    prescriptions.set(id, prescription);
    drafts.delete(draft.id);
    return prescription;
  },

  async renew(prescriptionId) {
    await delay(MOCK_LATENCY_MS);
    const source = prescriptions.get(prescriptionId);
    if (!source) throw new Error(PRESCRIPTION_NOT_FOUND);

    const spec =
      findMedicationSpec(source.medication.genericName, MEDICATION_CATALOGUE) ??
      MEDICATION_CATALOGUE.find((candidate) => candidate.name === source.medication.name) ??
      null;
    if (spec === null) throw new Error('Unknown medication');

    const now = new Date().toISOString();
    const strength = spec.strengths.includes(source.dosage)
      ? source.dosage
      : (spec.strengths[0] ?? source.dosage);
    const frequency = spec.frequencies.includes(source.frequency)
      ? source.frequency
      : (spec.frequencies[0] ?? null);

    const draft: PrescriptionDraft = {
      id: `draft-renew-${prescriptionId}-${Date.now().toString(36)}`,
      patient: source.patient,
      medication: { genericName: spec.genericName, strength },
      dosage: {
        frequency,
        durationDays: source.durationDays,
        quantity: source.quantity,
        refillsAllowed: source.refillsAllowed,
        instructions:
          source.instructions.trim() === '' && frequency !== null
            ? suggestedInstructions(spec, strength, frequency)
            : source.instructions,
      },
      origin: 'renewal',
      renewedFrom: prescriptionId,
      createdAt: now,
      updatedAt: now,
    };

    drafts.set(draft.id, draft);
    return draft;
  },

  cancel(input) {
    return endPrescription('cancel', input);
  },

  discontinue(input) {
    return endPrescription('discontinue', input);
  },

  async discardPrescriptionDraft(prescriptionId) {
    await delay(MOCK_LATENCY_MS);
    const current = prescriptions.get(prescriptionId);
    if (!current) throw new Error(PRESCRIPTION_NOT_FOUND);
    // The server's rule (ADR-044): only an unsigned draft, and it leaves every
    // list and read. The server keeps the row for its audit trail; this twin
    // has no audit trail to keep it for.
    if (current.status !== 'draft') throw new Error(PRESCRIPTION_NOT_DRAFT);
    prescriptions.delete(prescriptionId);
  },

  async addNote({ prescriptionId, body, author }) {
    await delay(MOCK_LATENCY_MS);
    const current = prescriptions.get(prescriptionId);
    if (!current) throw new Error(PRESCRIPTION_NOT_FOUND);
    const text = body.trim();
    // The server's rule (1–4,000 characters), so the demo cannot keep a note
    // the API would refuse.
    if (text === '' || text.length > PRESCRIPTION_NOTE_MAX) {
      throw new Error('A note must be 1 to 4,000 characters.');
    }

    const now = new Date().toISOString();
    const next: Prescription = {
      ...current,
      updatedAt: now,
      notes: [
        ...current.notes,
        { id: `${prescriptionId}-note-${now}`, author, authoredAt: now, body: text },
      ],
    };
    prescriptions.set(prescriptionId, next);
    return next;
  },
};
