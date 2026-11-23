import { apiClient } from '@/api/client';
import {
  asRecord,
  fetchAllPages,
  LARGE_LIST_MAX_PAGES,
  malformedResponse,
  readArray,
  readBoolean,
  readData,
  readDay,
  readEnum,
  readNumber,
  readOptionalString,
  readPage,
  readString,
} from '@/api/http';
import { registerSessionMemoryReset } from '@/api/session-memory';
import { readPatientBloodType, type Gender } from '@/features/shared-domain/patient-identity';
import { isApiError } from '@/types/api';

import {
  EMPTY_DOSAGE,
  emptyDraft,
  findMedicationSpec,
  type CompleteDraft,
  type PrescriptionDraft,
} from '../model/authoring';
import type { Formulary, MedicationMonograph, MedicationSpec } from '../model/catalogue';
import {
  MEDICATION_SEARCH_PAGE_SIZE,
  PRESCRIPTION_NOT_DRAFT,
  PRESCRIPTION_NOT_FOUND,
  type EndPrescriptionInput,
  type PrescriptionService,
} from '../model/prescription-service';
import {
  assertSignable,
  type AuthoringSafetyWarning,
  type SafetyCheckSubject,
} from '../model/safety-check';
import {
  MEDICATION_CATEGORIES,
  PRESCRIPTION_STATUSES,
  REFILL_STATUSES,
  type Medication,
  type MedicationForm,
  type MedicationRoute,
  type Prescription,
  type PrescriptionPatientSnapshot,
  type PrescriptionSummary,
  type PrescriptionTimelineKind,
  type SafetyWarning,
  type SafetyWarningKind,
  type SafetyWarningSeverity,
} from '../model/types';

/**
 * Prescribing over HTTP (FE-10.6) — API §7, `backend/src/modules/pharmacy`.
 *
 * | Port method         | Endpoint                                            |
 * | ------------------- | --------------------------------------------------- |
 * | `listMedications`   | `GET /medications` (every page)                     |
 * | `searchMedications` | `GET /medications?q=` (the first page)              |
 * | `getMonograph`      | `GET /medications/{id}/monograph` (404 → `null`)    |
 * | `listPrescriptions` | `GET /prescriptions` (every page, newest first)     |
 * | `getPrescription`   | `GET /prescriptions/{id}`                           |
 * | `listCurrentMedications` | `GET /patients/{id}/medications`, `active` only |
 * | `checkSafety`       | `POST /prescriptions/safety-check`                  |
 * | `sign`              | `POST /prescriptions` (or `…/{from}/renew`), then `…/{id}/sign` |
 * | `renew`             | `GET /prescriptions/{id}` → a pre-filled local draft |
 * | `cancel`            | `POST /prescriptions/{id}/cancel`                   |
 * | `discontinue`       | `POST /prescriptions/{id}/discontinue`              |
 * | `discardPrescriptionDraft` | `DELETE /prescriptions/{id}` — an unsigned draft only |
 * | `addNote`           | `POST /prescriptions/{id}/notes`                    |
 *
 * ## The safety screen is the server's
 *
 * `checkSafety` posts the patient and the medication and returns the
 * server's warnings as they are, stamped `clinical-service`. Nothing here
 * screens anything: there is no second engine to disagree with the one the
 * signature is checked against. A body that cannot be read as a warning
 * list is returned as `null`, which `runSafetyCheck` treats as an
 * unreadable result — a failed verdict, never a clear one.
 *
 * And at signing the server **re-runs** the screen inside the transaction
 * (API §7.7) and refuses — `allergy_conflict`, `acknowledgment_required`,
 * `safety_check_unavailable` — whatever the client believed. Those
 * refusals reach the page as the server's errors.
 *
 * ## A refused signature leaves a draft, and a retry reuses it
 *
 * Signing is two requests: create the draft, then sign it. A refusal
 * leaves the draft on the server — by design, a state the list can show —
 * so the adapter remembers it against the exact body it was created from
 * and signs the same draft again on a retry, rather than leaving one
 * orphan per attempt. A changed prescription is a different body and gets
 * a new draft.
 *
 * ## Renewals keep their lineage when the therapy is unchanged
 *
 * `renew` pre-fills a local draft from the source prescription (the
 * stepper has to run the screen before anything is created). At signing,
 * if the medication, strength and schedule are still the source's, the
 * draft is created through `POST …/{from}/renew` with the course
 * overrides, so the server records it as a renewal; a changed therapy is a
 * new prescription and is created as one.
 *
 * Saved drafts are held for this tab only — never in browser storage.
 */

const GENDERS: readonly Gender[] = ['female', 'male'];
const FORMS: readonly MedicationForm[] = [
  'Tablet',
  'Capsule',
  'Syrup',
  'Injection',
  'Inhaler',
  'Cream',
  'Drops',
  'Patch',
];
const ROUTES: readonly MedicationRoute[] = [
  'Oral',
  'Intravenous',
  'Intramuscular',
  'Subcutaneous',
  'Topical',
  'Inhalation',
  'Ophthalmic',
  'Transdermal',
];
const WARNING_KINDS: readonly SafetyWarningKind[] = [
  'interaction',
  'allergy',
  'duplicate',
  'dosage',
];
const SEVERITIES: readonly SafetyWarningSeverity[] = ['info', 'warning', 'critical'];
const TIMELINE_KINDS: readonly PrescriptionTimelineKind[] = [
  'prescribed',
  'dispensed',
  'refill-requested',
  'refill-approved',
  'renewed',
  'note-added',
  'discontinued',
  'expired',
];

function readStrings(dto: Record<string, unknown>, key: string, what: string): readonly string[] {
  return readArray(dto, key, what).map((entry) => {
    if (typeof entry !== 'string') throw malformedResponse(`${what}.${key}`);
    return entry;
  });
}

/** `MedicationView` (API §7.1) → a formulary entry. */
export function toMedicationSpec(value: unknown): MedicationSpec {
  const what = 'medication';
  const dto = asRecord(value, what);
  return {
    id: readString(dto, 'id', what),
    name: readString(dto, 'name', what),
    genericName: readString(dto, 'genericName', what),
    category: readEnum(dto, 'category', MEDICATION_CATEGORIES, what),
    form: readEnum(dto, 'form', FORMS, what),
    route: readEnum(dto, 'route', ROUTES, what),
    strengths: readStrings(dto, 'strengths', what),
    manufacturer: readString(dto, 'manufacturer', what),
    isControlled: readBoolean(dto, 'isControlled', what),
    isHighRisk: readBoolean(dto, 'isHighRisk', what),
    interactionNote: readOptionalString(dto, 'interactionNote', what),
    allergyClass: readOptionalString(dto, 'allergyClass', what),
    frequencies: readStrings(dto, 'frequencies', what),
    durationsDays: readArray(dto, 'durationsDays', what).map((entry) => {
      if (typeof entry !== 'number') throw malformedResponse(`${what}.durationsDays`);
      return entry;
    }),
  };
}

function toPatient(value: unknown): PrescriptionPatientSnapshot {
  const what = 'prescription.patient';
  const dto = asRecord(value, what);
  return {
    id: readString(dto, 'id', what),
    name: readString(dto, 'name', what),
    mrn: readString(dto, 'mrn', what),
    age: readNumber(dto, 'age', what),
    gender: readEnum(dto, 'gender', GENDERS, what),
    bloodType: readPatientBloodType(dto, what),
    phone: readString(dto, 'phone', what),
    allergies: readStrings(dto, 'allergies', what),
    hasSevereAllergy: readBoolean(dto, 'hasSevereAllergy', what),
  };
}

function toMedication(value: unknown): Medication {
  const what = 'prescription.medication';
  const dto = asRecord(value, what);
  return {
    name: readString(dto, 'name', what),
    genericName: readString(dto, 'genericName', what),
    category: readEnum(dto, 'category', MEDICATION_CATEGORIES, what),
    strength: readString(dto, 'strength', what),
    form: readEnum(dto, 'form', FORMS, what),
    route: readEnum(dto, 'route', ROUTES, what),
    manufacturer: readString(dto, 'manufacturer', what),
    isControlled: readBoolean(dto, 'isControlled', what),
    isHighRisk: readBoolean(dto, 'isHighRisk', what),
    interactionNote: readOptionalString(dto, 'interactionNote', what),
    allergyClass: readOptionalString(dto, 'allergyClass', what),
  };
}

function toWarning(value: unknown): SafetyWarning {
  const what = 'prescription.warnings';
  const dto = asRecord(value, what);
  return {
    id: readString(dto, 'id', what),
    kind: readEnum(dto, 'kind', WARNING_KINDS, what),
    severity: readEnum(dto, 'severity', SEVERITIES, what),
    title: readString(dto, 'title', what),
    detail: readString(dto, 'detail', what),
  };
}

/** `PrescriptionView` (API §7.3) → the list row. */
export function toPrescriptionSummary(value: unknown): PrescriptionSummary {
  const what = 'prescription';
  const dto = asRecord(value, what);
  return {
    id: readString(dto, 'id', what),
    patient: toPatient(dto.patient),
    medication: toMedication(dto.medication),
    dosage: readString(dto, 'dosage', what),
    frequency: readString(dto, 'frequency', what),
    route: readEnum(dto, 'route', ROUTES, what),
    duration: readString(dto, 'duration', what),
    durationDays: readNumber(dto, 'durationDays', what),
    quantity: readNumber(dto, 'quantity', what),
    instructions: readString(dto, 'instructions', what),
    prescribingDoctor: readString(dto, 'prescribingDoctor', what),
    department: readOptionalString(dto, 'department', what) ?? '—',
    status: readEnum(dto, 'status', PRESCRIPTION_STATUSES, what),
    // Days (`@db.Date`), read as local midnight so they are the same day everywhere.
    startDate: readDay(dto, 'startDate', what),
    endDate: readDay(dto, 'endDate', what),
    refillsAllowed: readNumber(dto, 'refillsAllowed', what),
    refillsRemaining: readNumber(dto, 'refillsRemaining', what),
    refillStatus: readEnum(dto, 'refillStatus', REFILL_STATUSES, what),
    warnings: readArray(dto, 'warnings', what).map(toWarning),
    createdAt: readString(dto, 'createdAt', what),
    updatedAt: readString(dto, 'updatedAt', what),
  };
}

/** `PrescriptionDetailView` (API §7.4) → the full document. */
export function toPrescription(value: unknown): Prescription {
  const what = 'prescription';
  const dto = asRecord(value, what);
  return {
    ...toPrescriptionSummary(dto),
    notes: readArray(dto, 'notes', what).map((entry) => {
      const note = asRecord(entry, 'prescription.notes');
      return {
        id: readString(note, 'id', 'prescription.notes'),
        author: readString(note, 'author', 'prescription.notes'),
        authoredAt: readString(note, 'authoredAt', 'prescription.notes'),
        body: readString(note, 'body', 'prescription.notes'),
      };
    }),
    history: readArray(dto, 'history', what).map((entry) => {
      const item = asRecord(entry, 'prescription.history');
      return {
        id: readString(item, 'id', 'prescription.history'),
        date: readString(item, 'date', 'prescription.history'),
        event: readString(item, 'event', 'prescription.history'),
        detail: readString(item, 'detail', 'prescription.history'),
      };
    }),
    timeline: readArray(dto, 'timeline', what).map((entry) => {
      const item = asRecord(entry, 'prescription.timeline');
      return {
        id: readString(item, 'id', 'prescription.timeline'),
        kind: readEnum(item, 'kind', TIMELINE_KINDS, 'prescription.timeline'),
        at: readString(item, 'at', 'prescription.timeline'),
        actor: readString(item, 'actor', 'prescription.timeline'),
        detail: readString(item, 'detail', 'prescription.timeline'),
      };
    }),
  };
}

/**
 * `SafetyCheckView` (API §7.5) → the warnings, stamped as the clinical
 * service's — or `null` when the body is not readable as one, which the
 * verdict logic treats as a failed check.
 */
export function toSafetyWarnings(body: unknown): readonly AuthoringSafetyWarning[] | null {
  try {
    const dto = asRecord(readData(body, 'safety check'), 'safety check');
    return readArray(dto, 'warnings', 'safety check').map((entry) => {
      const what = 'safety check.warnings';
      const warning = asRecord(entry, what);
      return {
        id: readString(warning, 'id', what),
        kind: readEnum(warning, 'kind', WARNING_KINDS, what),
        severity: readEnum(warning, 'severity', SEVERITIES, what),
        title: readString(warning, 'title', what),
        detail: readString(warning, 'detail', what),
        against: readStrings(warning, 'against', what),
        blocking: readBoolean(warning, 'blocking', what),
        source: 'clinical-service',
      };
    });
  } catch {
    return null;
  }
}

const prescriptionPath = (id: string) => `/prescriptions/${encodeURIComponent(id)}`;

async function readPrescription(request: Promise<unknown>): Promise<Prescription> {
  try {
    return toPrescription(readData(await request, 'prescription'));
  } catch (error) {
    if (isApiError(error) && error.kind === 'not_found') throw new Error(PRESCRIPTION_NOT_FOUND);
    throw error;
  }
}

/** The therapy a renewal copies — what must be unchanged for it to stay one. */
interface RenewalSource {
  readonly genericName: string;
  readonly strength: string;
  readonly frequency: string;
}

const drafts = new Map<string, PrescriptionDraft>();
/** Create-body fingerprint → the server draft it produced (see the header). */
const serverDrafts = new Map<string, string>();
const renewalSources = new Map<string, RenewalSource>();
let formularyCache: Promise<Formulary> | null = null;

export function __resetHttpPharmacyState(): void {
  drafts.clear();
  serverDrafts.clear();
  renewalSources.clear();
  formularyCache = null;
}

export function toMonograph(value: unknown): MedicationMonograph {
  const what = 'monograph';
  const dto = asRecord(value, what);
  return {
    medicationId: readString(dto, 'medicationId', what),
    name: readString(dto, 'name', what),
    genericName: readString(dto, 'genericName', what),
    indications: readOptionalString(dto, 'indications', what),
    contraindications: readOptionalString(dto, 'contraindications', what),
    standardDosing: readOptionalString(dto, 'standardDosing', what),
    pregnancyCategory: readOptionalString(dto, 'pregnancyCategory', what),
    warnings: readOptionalString(dto, 'warnings', what),
    sideEffects: readOptionalString(dto, 'sideEffects', what),
  };
}

async function loadFormulary(): Promise<Formulary> {
  const items = await fetchAllPages(
    (page, pageSize) => apiClient.get('/medications', { page, pageSize }),
    'medications',
  );
  return items.map(toMedicationSpec);
}

/** The draft as a server prescription body (API §7.6). */
function createBody(draft: CompleteDraft) {
  return {
    patientId: draft.patient.id,
    medicationId: draft.spec.id,
    strength: draft.strength,
    // The frontend's dose *is* the strength chosen (`Prescription.dosage`).
    dosage: draft.strength,
    frequency: draft.frequency,
    durationDays: draft.durationDays,
    quantity: draft.quantity,
    refillsAllowed: draft.refillsAllowed,
    instructions: draft.instructions,
  };
}

/**
 * One `Idempotency-Key` per prescribing *intent* (ADR-014, RM M39.3), held
 * as long as `serverDrafts` holds the draft it guards.
 *
 * Signing is two POSTs — create the server draft (or renew), then sign it —
 * and either response can be lost after the server acted. `serverDrafts`
 * already stops a retry creating a second draft once the create answered;
 * these keys cover the case where it did not answer. A retry of the same
 * draft sends the same key, so an API built from `backend` replays the
 * stored result: the draft it already created, the prescription it already
 * signed. A different body is a different intent and gets a new key — the
 * server refuses a key reused for a different request. An API without the
 * interceptor ignores the header.
 */
const intentKeys = new Map<string, string>();

// Drafts name their patient: all of it ends with the session that wrote it,
// and the keys with the server drafts they guard.
registerSessionMemoryReset(() => {
  __resetHttpPharmacyState();
  intentKeys.clear();
});

function intentKey(intent: string): string {
  let key = intentKeys.get(intent);
  if (key === undefined) {
    key = crypto.randomUUID();
    intentKeys.set(intent, key);
  }
  return key;
}

async function createServerDraft(draft: CompleteDraft, idempotencyKey: string): Promise<string> {
  const body = createBody(draft);
  const source = draft.renewedFrom === null ? undefined : renewalSources.get(draft.renewedFrom);
  const asRenewal =
    draft.renewedFrom !== null &&
    source !== undefined &&
    source.genericName === draft.spec.genericName &&
    source.strength === draft.strength &&
    source.frequency === draft.frequency;

  const created = asRenewal
    ? await apiClient.post(
        `${prescriptionPath(draft.renewedFrom ?? '')}/renew`,
        {
          durationDays: draft.durationDays,
          quantity: draft.quantity,
          refillsAllowed: draft.refillsAllowed,
          instructions: draft.instructions,
        },
        // The renew and create bodies differ, so they are different intents.
        { idempotencyKey: intentKey(`renew ${idempotencyKey}`) },
      )
    : await apiClient.post('/prescriptions', body, { idempotencyKey });
  return toPrescriptionSummary(readData(created, 'prescription')).id;
}

/**
 * `POST …/cancel` or `…/discontinue` (API §7.9, DEC-002) — same body, same
 * resulting status; the route is the act the audit trail records.
 */
function endPrescription(
  act: 'cancel' | 'discontinue',
  { prescriptionId, reason, details }: EndPrescriptionInput,
): Promise<Prescription> {
  const stated = details.trim() === '' ? reason : `${reason} — ${details.trim()}`;
  return readPrescription(
    apiClient.post(`${prescriptionPath(prescriptionId)}/${act}`, { reason: stated }),
  );
}

export const httpPrescriptionService: PrescriptionService = {
  capabilities: { safetySource: 'clinical-service', transmits: true, monographs: true },

  listMedications() {
    formularyCache ??= loadFormulary().catch((error: unknown) => {
      formularyCache = null;
      throw error;
    });
    return formularyCache;
  },

  async searchMedications(query) {
    const page = readPage(
      await apiClient.get('/medications', {
        q: query.trim(),
        page: 1,
        pageSize: MEDICATION_SEARCH_PAGE_SIZE,
      }),
      'medication search',
    );
    return page.items.map(toMedicationSpec);
  },

  async getMonograph(medicationId) {
    try {
      const body = await apiClient.get(
        `/medications/${encodeURIComponent(medicationId)}/monograph`,
      );
      return toMonograph(readData(body, 'monograph'));
    } catch (error) {
      // The server's "no monograph for this medication" — an answer.
      if (isApiError(error) && error.kind === 'not_found') return null;
      throw error;
    }
  },

  async listPrescriptions() {
    const items = await fetchAllPages(
      (page, pageSize) =>
        apiClient.get('/prescriptions', { page, pageSize, sort: 'createdAt:desc' }),
      'prescriptions',
      LARGE_LIST_MAX_PAGES,
    );
    return items.map(toPrescriptionSummary);
  },

  /*
   * The patient's medication tab (API §4.5), not `/prescriptions`: that is
   * the caller's own list, and this strip must show what other clinicians
   * prescribed and what the patient reported too. Only `active` entries are
   * current; the tab also holds completed and discontinued courses. The
   * server records the read as a medication-tab view, which is what it is.
   * The tab carries no high-alert flag, so `isHighRisk` is unknown rather
   * than `false`.
   */
  async listCurrentMedications(patientId) {
    const items = await fetchAllPages(
      (page, pageSize) =>
        apiClient.get(`/patients/${encodeURIComponent(patientId)}/medications`, {
          page,
          pageSize,
        }),
      'patient medications',
    );
    return items.flatMap((value) => {
      const what = 'patient medication';
      const dto = asRecord(value, what);
      if (readString(dto, 'status', what) !== 'active') return [];
      return [
        {
          id: readString(dto, 'id', what),
          name: readString(dto, 'name', what),
          dosage: readString(dto, 'dosage', what),
          frequency: readString(dto, 'frequency', what),
          prescriptionId: readOptionalString(dto, 'prescriptionId', what),
          isHighRisk: null,
        },
      ];
    });
  },

  getPrescription(prescriptionId) {
    return readPrescription(apiClient.get(prescriptionPath(prescriptionId)));
  },

  listDrafts() {
    return Promise.resolve(Array.from(drafts.values()));
  },

  saveDraft(draft) {
    const saved: PrescriptionDraft = { ...draft, updatedAt: new Date().toISOString() };
    drafts.set(saved.id, saved);
    return Promise.resolve(saved);
  },

  discardDraft(draftId) {
    drafts.delete(draftId);
    return Promise.resolve();
  },

  async checkSafety(subject: SafetyCheckSubject, signal: AbortSignal) {
    const body = await apiClient.post(
      '/prescriptions/safety-check',
      { patientId: subject.patientId, medicationId: subject.medicationId },
      { signal },
    );
    return toSafetyWarnings(body);
  },

  async sign(signable) {
    // The type makes an unchecked signature unrepresentable; this refuses a cast.
    assertSignable(signable);
    const { draft, acknowledgment } = signable;

    const key = JSON.stringify([draft.id, draft.renewedFrom, createBody(draft)]);
    const createIntent = `create ${key}`;
    const draftId =
      serverDrafts.get(key) ?? (await createServerDraft(draft, intentKey(createIntent)));
    serverDrafts.set(key, draftId);

    const reason = acknowledgment?.reason.trim() ?? '';
    const signBody = {
      acknowledgedWarningIds: acknowledgment?.warningIds ?? [],
      ...(reason === '' ? {} : { reason }),
    };
    const signIntent = `sign ${draftId} ${JSON.stringify(signBody)}`;
    const signed = await readPrescription(
      apiClient.post(`${prescriptionPath(draftId)}/sign`, signBody, {
        idempotencyKey: intentKey(signIntent),
      }),
    );

    serverDrafts.delete(key);
    for (const intent of [
      createIntent,
      `renew ${intentKeys.get(createIntent) ?? ''}`,
      signIntent,
    ]) {
      intentKeys.delete(intent);
    }
    drafts.delete(draft.id);
    return signed;
  },

  async renew(prescriptionId) {
    const [source, formulary] = await Promise.all([
      readPrescription(apiClient.get(prescriptionPath(prescriptionId))),
      httpPrescriptionService.listMedications(),
    ]);
    const spec = findMedicationSpec(source.medication.genericName, formulary);
    if (spec === null) throw new Error('That medication is no longer in the formulary.');

    const now = new Date().toISOString();
    const strength = spec.strengths.includes(source.dosage) ? source.dosage : null;
    const frequency = spec.frequencies.includes(source.frequency) ? source.frequency : null;
    const base = emptyDraft(`draft-renew-${prescriptionId}-${Date.now().toString(36)}`, now);
    const draft: PrescriptionDraft = {
      ...base,
      patient: source.patient,
      medication: { genericName: spec.genericName, strength: strength ?? spec.strengths[0] ?? '' },
      dosage: {
        ...EMPTY_DOSAGE,
        frequency,
        durationDays: source.durationDays,
        quantity: source.quantity,
        refillsAllowed: source.refillsAllowed,
        instructions: source.instructions,
      },
      origin: 'renewal',
      renewedFrom: prescriptionId,
    };

    renewalSources.set(prescriptionId, {
      genericName: spec.genericName,
      strength: source.dosage,
      frequency: source.frequency,
    });
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
    try {
      await apiClient.delete(prescriptionPath(prescriptionId));
    } catch (error) {
      if (isApiError(error) && error.kind === 'not_found') throw new Error(PRESCRIPTION_NOT_FOUND);
      if (isApiError(error) && error.code === 'prescription_not_draft') {
        throw new Error(PRESCRIPTION_NOT_DRAFT);
      }
      throw error;
    }
    // A refused signature remembered this draft for its retry (see the
    // header); a retry must create a new one, not sign a discarded row.
    for (const [key, draftId] of serverDrafts) {
      if (draftId === prescriptionId) serverDrafts.delete(key);
    }
  },

  addNote({ prescriptionId, body }) {
    return readPrescription(
      apiClient.post(`${prescriptionPath(prescriptionId)}/notes`, { body: body.trim() }),
    );
  },
};
