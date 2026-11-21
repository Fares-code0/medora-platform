import { MOCK_PATIENTS } from '@/features/shared-domain/patient-identity';

import { bmiFor, type CompleteRecordDraft, type MedicalRecordDraft } from '../model/authoring';
import { MOCK_MEDICAL_RECORDS } from '../model/mock-data';
import { dayKey } from '../model/record-edit';
import { assertSignableNote, canTransition } from '../model/record-lifecycle';
import {
  ILLEGAL_TRANSITION,
  RECORD_ISSUE_INVALID,
  RECORD_ISSUE_MAX,
  RECORD_NARRATIVE_MAX,
  RECORD_EDIT_REASON_MAX,
  RECORD_NO_CHANGE,
  RECORD_NOT_EDITABLE,
  RECORD_NOT_FOUND,
  RECORD_PLAN_STEP_MAX,
  RECORD_PLAN_STEPS_MAX,
  type RecordEditableFields,
  type RecordVersion,
  type AmendRecordInput,
  type RecordService,
  type ReportRecordIssueInput,
  type SetRecordStatusInput,
} from '../model/record-service';
import type {
  MedicalRecord,
  RecordAllergy,
  RecordAllergySeverity,
  RecordClinicalNote,
  RecordTimelineEvent,
  RecordVitalSigns,
} from '../model/types';

/**
 * The medical-records mock adapter — a session-lifetime store over the seeded
 * dataset, so an authored record genuinely exists for the session and every
 * consumer refreshes through query invalidation (the pharmacy and labs
 * pattern).
 *
 * **Honesty rules this adapter keeps.**
 *
 * 1. Nothing here is transmitted anywhere. A new record lands in an in-memory
 *    Map that dies with the tab, and the timeline event it writes says so in
 *    words — the UI reads that wording from the event rather than inventing a
 *    "filed to the EHR" line of its own.
 * 2. A created record's first note is **unsigned**. Creating and signing are
 *    two acts; see the port.
 * 3. Nothing here rewrites a signed note. `amendRecord` appends; there is no
 *    method that edits one.
 * 4. The store is in memory rather than `localStorage`:
 *    `services/preferences.ts` is the app's only sanctioned storage boundary
 *    and it is for UI preferences, never PHI.
 */

const MOCK_LATENCY_MS = 400;

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const records = new Map<string, MedicalRecord>(
  MOCK_MEDICAL_RECORDS.map((record) => [record.id, record]),
);

const drafts = new Map<string, MedicalRecordDraft>();

interface MockRecordIssueReport {
  readonly recordId: string;
  readonly description: string;
  readonly reportedAt: string;
}

const issueReports: MockRecordIssueReport[] = [];

/** Version rows per record, newest last — written only by `updateRecord`, as the server writes them. */
const versions = new Map<string, readonly RecordVersion[]>();

const NARRATIVE_FIELDS = [
  'chiefComplaint',
  'historyOfPresentIllness',
  'physicalExamination',
] as const;

/** A diagnosis list as the server's version row would show it: codes, primary marked. */
function diagnosisCodes(list: RecordEditableFields['diagnoses']): readonly string[] {
  return list.map((diagnosis) =>
    diagnosis.isPrimary ? `${diagnosis.code} (primary)` : diagnosis.code,
  );
}

/** A stored day (an instant or `YYYY-MM-DDT00:00:00`) as the version row shows it. */
function dayOf(value: string | null): string | null {
  return value === null ? null : dayKey(value);
}

/** A day as the record holds one — local midnight, the HTTP adapter's `readDay`. */
const storedDay = (day: string) => `${day}T00:00:00`;

/** `{ field: { before, after } }` for the fields that really differ. */
function diffOf(
  current: MedicalRecord,
  changes: Partial<RecordEditableFields>,
): Record<string, { before: unknown; after: unknown }> {
  const diff: Record<string, { before: unknown; after: unknown }> = {};
  for (const [field, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    if (field === 'diagnoses') {
      const before = diagnosisCodes(current.diagnoses);
      const after = diagnosisCodes(value as RecordEditableFields['diagnoses']);
      if (before.join('|') !== after.join('|')) diff[field] = { before, after };
      continue;
    }
    if (field === 'treatmentPlan') {
      const before = current.treatmentPlan;
      const after = (value as RecordEditableFields['treatmentPlan']).map((step) => step.trim());
      if (before.length !== after.length || before.some((step, index) => step !== after[index])) {
        diff[field] = { before, after };
      }
      continue;
    }
    if (field === 'visitDate' || field === 'followUpDate') {
      const before = dayOf(current[field]);
      const after = value as string | null;
      if (before !== after) diff[field] = { before, after };
      continue;
    }
    const before = current[field as keyof MedicalRecord];
    const after = typeof value === 'string' ? value.trim() : value;
    if (before !== after) diff[field] = { before, after };
  }
  return diff;
}

let authoredCount = 0;

/** Test-only reset so suites do not leak authored records into each other. */
export function __resetRecordsStore(): void {
  records.clear();
  for (const record of MOCK_MEDICAL_RECORDS) records.set(record.id, record);
  drafts.clear();
  issueReports.length = 0;
  versions.clear();
  authoredCount = 0;
}

function nextRecordId(): string {
  authoredCount += 1;
  return `MR-${String(90_000 + authoredCount)}`;
}

/**
 * Allergies come from the roster, never from the authoring form. A doctor
 * writing an encounter note is not the person who establishes a patient's
 * allergy list, and a form that let them retype it would be a second copy
 * that can disagree with the one the allergy banner reads.
 */
function allergiesFor(patientId: string): readonly RecordAllergy[] {
  const patient = MOCK_PATIENTS.find((candidate) => candidate.id === patientId);
  if (patient === undefined) return [];
  const severity: RecordAllergySeverity = patient.hasSevereAllergy ? 'severe' : 'moderate';
  return patient.allergies.map((allergen, index) => ({
    id: `${patientId}-alg-${String(index + 1)}`,
    allergen,
    severity,
    reaction: 'Reaction not recorded in this demo dataset.',
  }));
}

/** `null` when nothing was measured — a zeroed reading would be a falsehood. */
function vitalsFrom(draft: CompleteRecordDraft, recordedAt: string): RecordVitalSigns | null {
  const { vitals } = draft;
  const measured =
    vitals.bloodPressure.trim() !== '' ||
    Object.values(vitals).some((value) => typeof value === 'number');
  if (!measured) return null;
  return {
    recordedAt,
    bloodPressure: vitals.bloodPressure.trim(),
    heartRateBpm: vitals.heartRateBpm ?? 0,
    temperatureC: vitals.temperatureC ?? 0,
    respiratoryRate: vitals.respiratoryRate ?? 0,
    oxygenSaturation: vitals.oxygenSaturation ?? 0,
    weightKg: vitals.weightKg ?? 0,
    heightCm: vitals.heightCm ?? 0,
    // Derived here too, from the same helper the form displays — so the
    // stored BMI cannot disagree with the one the doctor saw.
    bmi: bmiFor(vitals) ?? 0,
  };
}

export const mockRecordService: RecordService = {
  capabilities: { attachesVitals: true, persistsRecords: false },

  async listRecords(filter) {
    await delay(MOCK_LATENCY_MS);
    const all = Array.from(records.values());
    const patientId = filter?.patientId;
    return patientId === undefined ? all : all.filter((record) => record.patient.id === patientId);
  },

  async getRecord(recordId) {
    await delay(MOCK_LATENCY_MS);
    const record = records.get(recordId);
    if (!record) throw new Error(RECORD_NOT_FOUND);
    return record;
  },

  async listDrafts() {
    await delay(MOCK_LATENCY_MS / 4);
    return Array.from(drafts.values());
  },

  async saveDraft(draft) {
    await delay(MOCK_LATENCY_MS);
    const saved: MedicalRecordDraft = { ...draft, updatedAt: new Date().toISOString() };
    drafts.set(saved.id, saved);
    return saved;
  },

  async discardDraft(draftId) {
    await delay(MOCK_LATENCY_MS / 4);
    drafts.delete(draftId);
  },

  async createRecord(draft, authoredBy) {
    await delay(MOCK_LATENCY_MS);

    const id = nextRecordId();
    const now = new Date().toISOString();
    const visitAt = `${draft.visit.visitDate}T09:00:00.000Z`;

    const note: RecordClinicalNote = {
      id: `${id}-note-1`,
      author: authoredBy,
      authoredAt: now,
      title: draft.note.title.trim(),
      body: draft.note.body.trim(),
      // Unsigned on purpose — see the port.
      signed: false,
    };

    const timeline: readonly RecordTimelineEvent[] = [
      {
        id: `${id}-tl-created`,
        kind: 'created',
        at: now,
        actor: authoredBy,
        detail:
          'Record created in this demo session. No records system is connected, so it was not filed anywhere.',
      },
      {
        id: `${id}-tl-note`,
        kind: 'note-added',
        at: now,
        actor: authoredBy,
        detail: `Clinical note added, unsigned: ${note.title}`,
      },
    ];

    const record: MedicalRecord = {
      id,
      patient: draft.patient,
      visitDate: visitAt,
      visitType: draft.visit.visitType,
      department: draft.visit.department,
      doctor: authoredBy,
      status: 'draft',
      priority: 'normal',
      diagnoses: draft.diagnoses,
      chiefComplaint: draft.chiefComplaint.trim(),
      historyOfPresentIllness: draft.historyOfPresentIllness.trim(),
      physicalExamination: draft.physicalExamination.trim(),
      vitals: vitalsFrom(draft, now),
      /*
       * Empty rather than invented. The authoring flow does not collect a
       * treatment plan, and filling one with plausible prose would make a
       * demo record indistinguishable from a real one.
       */
      treatmentPlan: [],
      medications: [],
      allergies: allergiesFor(draft.patient.id),
      notes: [note],
      attachments: [],
      timeline,
      followUpDate: null,
      createdAt: now,
      updatedAt: now,
    };

    records.set(id, record);
    drafts.delete(draft.id);
    return record;
  },

  async signNote(signable) {
    // Belt and braces: the type already makes an unchecked signature
    // unrepresentable, and this refuses a cast at runtime.
    assertSignableNote(signable);
    await delay(MOCK_LATENCY_MS);

    const current = records.get(signable.recordId);
    if (!current) throw new Error(RECORD_NOT_FOUND);

    const target = current.notes.find((note) => note.id === signable.noteId);
    /*
     * Re-checked here and not only in `assessNoteSignability`: the assessment
     * ran against the copy the UI held, and another tab may have signed it
     * since. A second signature would overwrite the first signer's claim.
     */
    if (target === undefined || target.signed) return current;

    const now = new Date().toISOString();
    const next: MedicalRecord = {
      ...current,
      // A signed note makes the encounter live rather than provisional.
      status: current.status === 'draft' ? 'active' : current.status,
      notes: current.notes.map((note) =>
        note.id === signable.noteId ? { ...note, signed: true } : note,
      ),
      updatedAt: now,
      timeline: [
        ...current.timeline,
        {
          id: `${current.id}-tl-signed-${now}`,
          kind: 'note-added',
          at: now,
          actor: signable.signedBy,
          detail: `Note signed: ${target.title}. Recorded in this demo session only — no records system is connected.`,
        },
      ],
    };

    records.set(next.id, next);
    return next;
  },

  async amendRecord({ recordId, title, body, author }: AmendRecordInput) {
    await delay(MOCK_LATENCY_MS);
    const current = records.get(recordId);
    if (!current) throw new Error(RECORD_NOT_FOUND);

    const now = new Date().toISOString();
    const addendum: RecordClinicalNote = {
      id: `${recordId}-note-${String(current.notes.length + 1)}`,
      author,
      authoredAt: now,
      title: title.trim(),
      body: body.trim(),
      // An addendum arrives unsigned and is signed like any other note.
      signed: false,
    };

    const next: MedicalRecord = {
      ...current,
      // Appended. The existing notes are returned untouched, by construction.
      notes: [...current.notes, addendum],
      updatedAt: now,
      timeline: [
        ...current.timeline,
        {
          id: `${recordId}-tl-amended-${now}`,
          kind: 'note-added',
          at: now,
          actor: author,
          detail: `Addendum added: ${addendum.title}`,
        },
      ],
    };

    records.set(next.id, next);
    return next;
  },

  async setStatus({ recordId, status, actor }: SetRecordStatusInput) {
    await delay(MOCK_LATENCY_MS);
    const current = records.get(recordId);
    if (!current) throw new Error(RECORD_NOT_FOUND);
    if (current.status === status) return current;
    /*
     * The map is enforced in the service, not only in the control that offers
     * the transition — a disabled button is one refactor away from enabled,
     * and this is the boundary that decides what the record actually holds.
     */
    if (!canTransition(current.status, status)) throw new Error(ILLEGAL_TRANSITION);

    const now = new Date().toISOString();
    const next: MedicalRecord = {
      ...current,
      status,
      updatedAt: now,
      timeline: [
        ...current.timeline,
        {
          id: `${recordId}-tl-status-${now}`,
          kind: 'status-changed',
          at: now,
          actor,
          detail: `Status changed from ${current.status} to ${status}.`,
        },
      ],
    };

    records.set(next.id, next);
    return next;
  },

  async updateRecord({ recordId, changes, actor, reason }) {
    await delay(MOCK_LATENCY_MS);
    const current = records.get(recordId);
    if (!current) throw new Error(RECORD_NOT_FOUND);
    // The server's author check (BR-DEC-004, 403 `not_record_author`) is not
    // mirrored: this twin knows the editor only by display name, and deciding
    // authorship by name is what DEC-001 refuses. The HTTP adapter surfaces
    // the server's refusal as `RECORD_NOT_AUTHOR`.
    //
    // The server's own rule (`assertEditable`): draft and active only. The
    // client asks for less (DEC-004); the boundary still says no to the rest.
    if (current.status !== 'draft' && current.status !== 'active') {
      throw new Error(RECORD_NOT_EDITABLE);
    }
    for (const field of NARRATIVE_FIELDS) {
      const value = changes[field];
      if (
        value !== undefined &&
        (value.trim() === '' || value.trim().length > RECORD_NARRATIVE_MAX)
      ) {
        throw Object.assign(new Error('API error: validation'), {
          kind: 'validation',
          detail: 'Clinical narrative fields cannot be empty.',
        });
      }
    }
    const plan = changes.treatmentPlan;
    if (
      plan !== undefined &&
      (plan.length > RECORD_PLAN_STEPS_MAX ||
        plan.some((step) => step.trim() === '' || step.trim().length > RECORD_PLAN_STEP_MAX))
    ) {
      throw Object.assign(new Error('API error: validation'), {
        kind: 'validation',
        detail: `A plan holds up to ${String(RECORD_PLAN_STEPS_MAX)} steps of 1–${String(RECORD_PLAN_STEP_MAX)} characters.`,
      });
    }
    const why = reason.trim();
    if (why.length > RECORD_EDIT_REASON_MAX) {
      throw Object.assign(new Error('API error: validation'), {
        kind: 'validation',
        detail: `Keep the reason to ${String(RECORD_EDIT_REASON_MAX)} characters.`,
      });
    }
    const diff = diffOf(current, changes);
    if (Object.keys(diff).length === 0) throw new Error(RECORD_NO_CHANGE);

    const now = new Date().toISOString();
    const trail = versions.get(recordId) ?? [];
    versions.set(recordId, [
      ...trail,
      {
        version: trail.length + 1,
        changedAt: now,
        actor,
        summary: `Edited ${Object.keys(diff).join(', ')}`,
        reason: why === '' ? null : why,
        changes: diff,
      },
    ]);
    const { visitDate, followUpDate, treatmentPlan, ...rest } = changes;
    const next: MedicalRecord = {
      ...current,
      ...Object.fromEntries(
        Object.entries(rest)
          .filter(([, value]) => value !== undefined)
          .map(([field, value]) => [field, typeof value === 'string' ? value.trim() : value]),
      ),
      ...(visitDate === undefined ? {} : { visitDate: storedDay(visitDate) }),
      ...(followUpDate === undefined
        ? {}
        : { followUpDate: followUpDate === null ? null : storedDay(followUpDate) }),
      ...(treatmentPlan === undefined
        ? {}
        : { treatmentPlan: treatmentPlan.map((step) => step.trim()) }),
      updatedAt: now,
    };
    records.set(recordId, next);
    return next;
  },

  async listVersions(recordId) {
    await delay(MOCK_LATENCY_MS / 2);
    if (!records.has(recordId)) throw new Error(RECORD_NOT_FOUND);
    return [...(versions.get(recordId) ?? [])].reverse();
  },

  async reportIssue({ recordId, description }: ReportRecordIssueInput) {
    await delay(MOCK_LATENCY_MS);
    if (!records.has(recordId)) throw new Error(RECORD_NOT_FOUND);
    const trimmed = description.trim();
    // The API's bounds, refused here too so the demo cannot accept what the
    // server would answer 422 to.
    if (trimmed.length === 0 || trimmed.length > RECORD_ISSUE_MAX) {
      throw new Error(RECORD_ISSUE_INVALID);
    }
    // Kept, like the server's `recordIssueReport` row, and — like it — read by
    // nothing in this client. The record itself is untouched: a report is
    // not a correction.
    issueReports.push({ recordId, description: trimmed, reportedAt: new Date().toISOString() });
  },
};

/** Test-only view of what `reportIssue` kept. */
export function __mockRecordIssueReports(): readonly MockRecordIssueReport[] {
  return issueReports;
}
