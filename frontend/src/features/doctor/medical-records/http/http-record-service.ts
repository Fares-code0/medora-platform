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
  readOptionalDay,
  readOptionalString,
  readString,
} from '@/api/http';
import type { BloodType, Gender } from '@/features/shared-domain/patient-identity';
import { isApiError } from '@/types/api';

import type { MedicalRecordDraft } from '../model/authoring';
import { assertSignableNote } from '../model/record-lifecycle';
import {
  RECORD_NO_CHANGE,
  RECORD_NOT_AUTHOR,
  RECORD_NOT_EDITABLE,
  RECORD_NOT_FOUND,
  RECORD_NOTE_NOT_SAVED,
  type RecordEditableFields,
  type RecordService,
  type RecordVersion,
} from '../model/record-service';
import type {
  MedicalRecord,
  MedicalRecordPriority,
  MedicalRecordStatus,
  MedicalRecordSummary,
  RecordAllergySeverity,
  RecordAttachmentKind,
  RecordDiagnosis,
  RecordMedicationStatus,
  RecordPatientSnapshot,
  RecordTimelineKind,
  RecordVitalSigns,
} from '../model/types';

/**
 * Medical records over HTTP (FE-10.5) — API §6,
 * `backend/src/modules/medical-records`.
 *
 * | Port method    | Endpoint                                              |
 * | -------------- | ----------------------------------------------------- |
 * | `listRecords`  | `GET /medical-records` (every page, newest visit first) |
 * | `getRecord`    | `GET /medical-records/{id}`                           |
 * | `createRecord` | `POST /medical-records`, then `POST …/{id}/notes`     |
 * | `signNote`     | `POST …/{id}/notes/{noteId}/sign`                     |
 * | `amendRecord`  | `POST …/{id}/notes` — an addendum is a new note       |
 * | `setStatus`    | `POST …/{id}/status` — the server's guarded machine   |
 * | `reportIssue`  | `POST …/{id}/report-issue` — changes nothing on it    |
 * | `updateRecord` | `PATCH …/{id}` — changed fields, plus a reason (DEC-004) |
 * | `listVersions` | `GET …/{id}/versions` — the before/after trail        |
 *
 * The server scopes every read to the caller and answers 404 for a record
 * outside it, which maps to `RECORD_NOT_FOUND` exactly as an unknown id
 * does. Every refusal it makes (a transition off the map, a note already
 * signed, a signer who is not the author) reaches the page as the
 * server's own error; nothing here applies a change locally.
 *
 * ## What the wire does not carry
 *
 * - **Vitals on create.** API §6.3 has no vitals field, and nothing links
 *   a reading on the patient's chart to a record, so `capabilities`
 *   says so and the authoring form does not collect them.
 * - **Drafts.** The service's `draft` is a record that exists; in-progress
 *   authoring has no server store. It is held for this tab, as in the
 *   mock, and never in browser storage.
 * - **`department`** is optional on the server and shown as "—" when
 *   absent, rather than guessed.
 * - **`visitDate` and `followUpDate` are days**, served as UTC midnight and
 *   read as local midnight (`readDay`), so the 4th is the 4th everywhere.
 */

const STATUSES: readonly MedicalRecordStatus[] = ['draft', 'active', 'completed', 'archived'];
const PRIORITIES: readonly MedicalRecordPriority[] = ['low', 'normal', 'high', 'critical'];
const GENDERS: readonly Gender[] = ['female', 'male'];
const BLOOD_TYPES: readonly BloodType[] = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
const MEDICATION_STATUSES: readonly RecordMedicationStatus[] = [
  'active',
  'completed',
  'discontinued',
];
const ALLERGY_SEVERITIES: readonly RecordAllergySeverity[] = ['mild', 'moderate', 'severe'];
const ATTACHMENT_KINDS: readonly RecordAttachmentKind[] = [
  'lab-result',
  'imaging',
  'referral',
  'consent',
  'external-report',
];
const TIMELINE_KINDS: readonly RecordTimelineKind[] = [
  'created',
  'vitals-recorded',
  'diagnosis-added',
  'medication-prescribed',
  'note-added',
  'attachment-added',
  'status-changed',
];

function toPatientSnapshot(value: unknown): RecordPatientSnapshot {
  const what = 'record.patient';
  const dto = asRecord(value, what);
  return {
    id: readString(dto, 'id', what),
    name: readString(dto, 'name', what),
    mrn: readString(dto, 'mrn', what),
    age: readNumber(dto, 'age', what),
    gender: readEnum(dto, 'gender', GENDERS, what),
    bloodType: readEnum(dto, 'bloodType', BLOOD_TYPES, what),
    phone: readString(dto, 'phone', what),
  };
}

function toDiagnosis(value: unknown): RecordDiagnosis {
  const what = 'record.diagnoses';
  const dto = asRecord(value, what);
  return {
    code: readString(dto, 'code', what),
    label: readString(dto, 'label', what),
    isPrimary: readBoolean(dto, 'isPrimary', what),
  };
}

/** `MedicalRecordView` (API §6.1) → the list row. */
export function toRecordSummary(value: unknown): MedicalRecordSummary {
  const what = 'record';
  const dto = asRecord(value, what);
  return {
    id: readString(dto, 'id', what),
    patient: toPatientSnapshot(dto.patient),
    visitDate: readDay(dto, 'visitDate', what),
    visitType: readString(dto, 'visitType', what),
    department: readOptionalString(dto, 'department', what) ?? '—',
    doctor: readString(dto, 'doctor', what),
    status: readEnum(dto, 'status', STATUSES, what),
    priority: readEnum(dto, 'priority', PRIORITIES, what),
    diagnoses: readArray(dto, 'diagnoses', what).map(toDiagnosis),
    chiefComplaint: readString(dto, 'chiefComplaint', what),
    followUpDate: readOptionalDay(dto, 'followUpDate', what),
    createdAt: readString(dto, 'createdAt', what),
    updatedAt: readString(dto, 'updatedAt', what),
  };
}

function toVitals(value: unknown): RecordVitalSigns | null {
  if (value === null) return null;
  const what = 'record.vitals';
  const dto = asRecord(value, what);
  return {
    recordedAt: readString(dto, 'recordedAt', what),
    bloodPressure: readString(dto, 'bloodPressure', what),
    heartRateBpm: readNumber(dto, 'heartRateBpm', what),
    temperatureC: readNumber(dto, 'temperatureC', what),
    respiratoryRate: readNumber(dto, 'respiratoryRate', what),
    oxygenSaturation: readNumber(dto, 'oxygenSaturation', what),
    weightKg: readNumber(dto, 'weightKg', what),
    heightCm: readNumber(dto, 'heightCm', what),
    bmi: readNumber(dto, 'bmi', what),
  };
}

function readStrings(dto: Record<string, unknown>, key: string, what: string): readonly string[] {
  return readArray(dto, key, what).map((entry) => {
    if (typeof entry !== 'string') throw malformedResponse(`${what}.${key}`);
    return entry;
  });
}

/** `MedicalRecordDetailView` (API §6.2) → the full document. */
export function toRecord(value: unknown): MedicalRecord {
  const what = 'record';
  const dto = asRecord(value, what);
  return {
    ...toRecordSummary(dto),
    historyOfPresentIllness: readString(dto, 'historyOfPresentIllness', what),
    physicalExamination: readString(dto, 'physicalExamination', what),
    vitals: toVitals(dto.vitals),
    treatmentPlan: readStrings(dto, 'treatmentPlan', what),
    medications: readArray(dto, 'medications', what).map((entry) => {
      const item = asRecord(entry, 'record.medications');
      return {
        id: readString(item, 'id', 'record.medications'),
        name: readString(item, 'name', 'record.medications'),
        dosage: readString(item, 'dosage', 'record.medications'),
        frequency: readString(item, 'frequency', 'record.medications'),
        instructions: readOptionalString(item, 'instructions', 'record.medications'),
        status: readEnum(item, 'status', MEDICATION_STATUSES, 'record.medications'),
      };
    }),
    allergies: readArray(dto, 'allergies', what).map((entry) => {
      const item = asRecord(entry, 'record.allergies');
      return {
        id: readString(item, 'id', 'record.allergies'),
        allergen: readString(item, 'allergen', 'record.allergies'),
        severity: readEnum(item, 'severity', ALLERGY_SEVERITIES, 'record.allergies'),
        reaction: readString(item, 'reaction', 'record.allergies'),
      };
    }),
    notes: readArray(dto, 'notes', what).map((entry) => {
      const item = asRecord(entry, 'record.notes');
      return {
        id: readString(item, 'id', 'record.notes'),
        author: readString(item, 'author', 'record.notes'),
        authoredAt: readString(item, 'authoredAt', 'record.notes'),
        title: readString(item, 'title', 'record.notes'),
        body: readString(item, 'body', 'record.notes'),
        signed: readBoolean(item, 'signed', 'record.notes'),
      };
    }),
    attachments: readArray(dto, 'attachments', what).map((entry) => {
      const item = asRecord(entry, 'record.attachments');
      return {
        id: readString(item, 'id', 'record.attachments'),
        name: readString(item, 'name', 'record.attachments'),
        kind: readEnum(item, 'kind', ATTACHMENT_KINDS, 'record.attachments'),
        sizeKb: readNumber(item, 'sizeKb', 'record.attachments'),
        uploadedBy: readString(item, 'uploadedBy', 'record.attachments'),
        uploadedAt: readString(item, 'uploadedAt', 'record.attachments'),
      };
    }),
    timeline: readArray(dto, 'timeline', what).map((entry) => {
      const item = asRecord(entry, 'record.timeline');
      return {
        id: readString(item, 'id', 'record.timeline'),
        kind: readEnum(item, 'kind', TIMELINE_KINDS, 'record.timeline'),
        at: readString(item, 'at', 'record.timeline'),
        actor: readString(item, 'actor', 'record.timeline'),
        detail: readString(item, 'detail', 'record.timeline'),
      };
    }),
  };
}

const recordPath = (recordId: string) => `/medical-records/${encodeURIComponent(recordId)}`;

/** A 404 is "no such record, or not yours" — the port's one not-found contract. */
async function readRecord(request: Promise<unknown>): Promise<MedicalRecord> {
  try {
    return toRecord(readData(await request, 'medical record'));
  } catch (error) {
    if (isApiError(error) && error.kind === 'not_found') throw new Error(RECORD_NOT_FOUND);
    throw error;
  }
}

/**
 * The PATCH body: only the fields that changed, in the API's shape. Days go
 * as `YYYY-MM-DD`, which the server stores as that day; a cleared follow-up
 * goes as `null`, which the schema accepts for that field alone.
 */
function editBody(changes: Partial<RecordEditableFields>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    body[field] =
      field === 'diagnoses'
        ? (value as RecordEditableFields['diagnoses']).map(({ code, isPrimary }) => ({
            code,
            isPrimary,
          }))
        : field === 'treatmentPlan'
          ? (value as RecordEditableFields['treatmentPlan']).map((step) => step.trim())
          : typeof value === 'string'
            ? value.trim()
            : value;
  }
  return body;
}

function toVersion(value: unknown): RecordVersion {
  const what = 'record version';
  const dto = asRecord(value, what);
  const changes = dto.changes;
  return {
    version: readNumber(dto, 'version', what),
    changedAt: readString(dto, 'changedAt', what),
    actor: readString(dto, 'actor', what),
    summary: readOptionalString(dto, 'summary', what),
    // Absent on a server from before BR-DEC-004 — read as "no reason given".
    reason: readOptionalString(dto, 'reason', what),
    changes:
      typeof changes === 'object' && changes !== null && !Array.isArray(changes)
        ? (changes as Record<string, unknown>)
        : {},
  };
}

/** In-progress authoring, for this tab only (see the header). */
const drafts = new Map<string, MedicalRecordDraft>();

export function __resetHttpRecordDrafts(): void {
  drafts.clear();
}

export const httpRecordService: RecordService = {
  capabilities: { attachesVitals: false, persistsRecords: true },

  async listRecords(filter) {
    const items = await fetchAllPages(
      (page, pageSize) =>
        apiClient.get('/medical-records', {
          page,
          pageSize,
          sort: 'visitDate:desc',
          ...(filter?.patientId === undefined ? {} : { patientId: filter.patientId }),
        }),
      'medical records',
      LARGE_LIST_MAX_PAGES,
    );
    return items.map(toRecordSummary);
  },

  getRecord(recordId) {
    return readRecord(apiClient.get(recordPath(recordId)));
  },

  listDrafts() {
    return Promise.resolve(Array.from(drafts.values()));
  },

  saveDraft(draft) {
    const saved: MedicalRecordDraft = { ...draft, updatedAt: new Date().toISOString() };
    drafts.set(saved.id, saved);
    return Promise.resolve(saved);
  },

  discardDraft(draftId) {
    drafts.delete(draftId);
    return Promise.resolve();
  },

  async createRecord(draft) {
    const created = toRecordSummary(
      readData(
        await apiClient.post('/medical-records', {
          patientId: draft.patient.id,
          visitDate: draft.visit.visitDate,
          visitType: draft.visit.visitType,
          department: draft.visit.department,
          chiefComplaint: draft.chiefComplaint.trim(),
          historyOfPresentIllness: draft.historyOfPresentIllness.trim(),
          physicalExamination: draft.physicalExamination.trim(),
          diagnoses: draft.diagnoses.map(({ code, isPrimary }) => ({ code, isPrimary })),
        }),
        'medical record',
      ),
    );
    drafts.delete(draft.id);
    /*
     * The note is a second request. If it fails the record still exists —
     * saying "nothing was created" would invite a duplicate — so the failure
     * names the record that was made without it.
     */
    try {
      return await readRecord(
        apiClient.post(`${recordPath(created.id)}/notes`, {
          title: draft.note.title.trim(),
          body: draft.note.body.trim(),
        }),
      );
    } catch {
      throw Object.assign(new Error(RECORD_NOTE_NOT_SAVED), { recordId: created.id });
    }
  },

  signNote(signable) {
    // The type makes an unchecked signature unrepresentable; this refuses a cast.
    assertSignableNote(signable);
    return readRecord(
      apiClient.post(
        `${recordPath(signable.recordId)}/notes/${encodeURIComponent(signable.noteId)}/sign`,
      ),
    );
  },

  amendRecord({ recordId, title, body }) {
    return readRecord(
      apiClient.post(`${recordPath(recordId)}/notes`, { title: title.trim(), body: body.trim() }),
    );
  },

  setStatus({ recordId, status }) {
    return readRecord(apiClient.post(`${recordPath(recordId)}/status`, { status }));
  },

  async updateRecord({ recordId, changes, reason }) {
    const why = reason.trim();
    try {
      return await readRecord(
        apiClient.patch(recordPath(recordId), {
          ...editBody(changes),
          ...(why === '' ? {} : { reason: why }),
        }),
      );
    } catch (error) {
      // The server's refusals of an edit, named so the dialog can say which.
      if (isApiError(error) && error.code === 'not_record_author') {
        throw new Error(RECORD_NOT_AUTHOR);
      }
      if (isApiError(error) && error.code === 'no_effective_change') {
        throw new Error(RECORD_NO_CHANGE);
      }
      if (isApiError(error) && error.code === 'record_not_editable') {
        throw new Error(RECORD_NOT_EDITABLE);
      }
      throw error;
    }
  },

  async listVersions(recordId) {
    try {
      const data = readData(await apiClient.get(`${recordPath(recordId)}/versions`), 'versions');
      if (!Array.isArray(data)) throw malformedResponse('versions');
      return (data as readonly unknown[]).map(toVersion).sort((a, b) => b.version - a.version);
    } catch (error) {
      if (isApiError(error) && error.kind === 'not_found') throw new Error(RECORD_NOT_FOUND);
      throw error;
    }
  },

  async reportIssue({ recordId, description }) {
    try {
      // The answer is `{ id, status: 'open' }`; the id is the server's row,
      // not a reference anyone can quote back, so nothing reads it.
      await apiClient.post(`${recordPath(recordId)}/report-issue`, {
        description: description.trim(),
      });
    } catch (error) {
      if (isApiError(error) && error.kind === 'not_found') throw new Error(RECORD_NOT_FOUND);
      throw error;
    }
  },
};
