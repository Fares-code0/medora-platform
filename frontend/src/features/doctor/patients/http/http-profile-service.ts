import { apiClient } from '@/api/client';
import {
  asRecord,
  fetchAllPages,
  malformedResponse,
  readArray,
  readBoolean,
  readData,
  readDay,
  readEnum,
  readNumber,
  readOptionalNumber,
  readOptionalDay,
  readOptionalString,
  readString,
} from '@/api/http';
import { toPatient } from '@/features/shared-domain/patient-identity';
import { isApiError } from '@/types/api';

import {
  PATIENT_NOT_FOUND,
  type EmergencyContactInput,
  type PatientProfileService,
} from '../model/profile-service';
import type {
  AllergyRecord,
  AllergySeverity,
  AppointmentRecord,
  ClinicalAlert,
  ClinicalNote,
  DocumentCategory,
  EmergencyContact,
  HistoryEventKind,
  MedicalHistoryEvent,
  MedicationRecord,
  MedicationStatus,
  PatientDocument,
  PatientProfileBundle,
  ProfileAppointmentStatus,
  ProfileTab,
  ProfileTabData,
  StudyCategory,
  StudyStatus,
  VitalSigns,
} from '../model/profile-types';

/**
 * The patient profile over HTTP (FE-10.2) — `backend/src/modules/patients`.
 *
 * `getProfile` reads API §4.4's bundle (`GET /patients/{id}/profile`:
 * header, allergies, latest vitals, current medications, chronic
 * conditions, emergency contacts, active alerts) and the appointments tab,
 * which the summary column always shows. Every other tab is read by
 * `getTab` from its own §4.5–4.6 endpoint only when it is opened, because
 * the server records each tab read as its own audited view
 * (`patient.tab_view`). The server care-scopes every route and answers 404
 * for a chart outside the doctor's scope, which maps to `PATIENT_NOT_FOUND`.
 *
 * ## What the API does not carry, and what is shown instead
 *
 * Nothing below is invented to fill a gap:
 *
 * - **`summary`** — no written summary exists server-side → `''`, and the
 *   Overview omits the card.
 * - **`insurance`** — the schema has no insurance record → `null`, shown as
 *   "No insurance details on file".
 * - **Appointment `department`** — the patient's appointment tab carries the
 *   doctor and visit type but no department → `null`, shown as "—".
 * - **Note authors and uploaders** — the API sends the author's `usr_…`
 *   handle, never a name (backend `patient-tabs.dto.ts`), and a doctor has
 *   no route that resolves one. The handle is shown as-is.
 * - **Medication prescriber** — the API links an Rx-originated entry to its
 *   `RX-…` id and marks the rest as patient-reported; that provenance is
 *   what the column shows.
 */

const ALLERGY_SEVERITIES: readonly AllergySeverity[] = ['mild', 'moderate', 'severe'];
const MEDICATION_STATUSES: readonly MedicationStatus[] = ['active', 'completed', 'discontinued'];
const HISTORY_KINDS: readonly HistoryEventKind[] = [
  'diagnosis',
  'surgery',
  'procedure',
  'hospitalization',
  'vaccination',
];
const DOCUMENT_CATEGORIES: readonly DocumentCategory[] = [
  'referral',
  'consent',
  'external-record',
  'insurance',
  'report',
];
const STUDY_STATUSES: readonly StudyStatus[] = ['completed', 'pending', 'critical'];
const APPOINTMENT_STATUSES: readonly ProfileAppointmentStatus[] = [
  'scheduled',
  'confirmed',
  'pending',
  'rescheduled',
  'awaiting-patient',
  'completed',
  'cancelled',
  'no-show',
];
const ALERT_SEVERITIES: readonly ClinicalAlert['severity'][] = ['critical', 'warning'];

// ── Mappers ────────────────────────────────────────────────────────────────

function toAllergy(value: unknown): AllergyRecord {
  const what = 'allergy';
  const dto = asRecord(value, what);
  return {
    id: readString(dto, 'id', what),
    allergen: readString(dto, 'allergen', what),
    severity: readEnum(dto, 'severity', ALLERGY_SEVERITIES, what),
    reaction: readString(dto, 'reaction', what),
    notes: readOptionalString(dto, 'notes', what),
    recordedAt: readString(dto, 'recordedAt', what),
  };
}

function toVitals(value: unknown): VitalSigns | null {
  if (value === null || value === undefined) return null;
  const what = 'latestVitals';
  const dto = asRecord(value, what);
  return {
    recordedAt: readString(dto, 'recordedAt', what),
    // API §4.6 keeps the two halves apart; this screen shows the reading.
    bloodPressure: `${String(readNumber(dto, 'systolic', what))}/${String(readNumber(dto, 'diastolic', what))}`,
    heartRateBpm: readNumber(dto, 'heartRate', what),
    temperatureC: readNumber(dto, 'temperatureC', what),
    respiratoryRate: readNumber(dto, 'respiratoryRate', what),
    oxygenSaturation: readNumber(dto, 'oxygenSaturation', what),
    weightKg: readNumber(dto, 'weightKg', what),
    heightCm: readNumber(dto, 'heightCm', what),
    bmi: readOptionalNumber(dto, 'bmi', what),
  };
}

function toMedication(value: unknown): MedicationRecord {
  const what = 'medication';
  const dto = asRecord(value, what);
  const prescriptionId = readOptionalString(dto, 'prescriptionId', what);
  return {
    id: readString(dto, 'id', what),
    name: readString(dto, 'name', what),
    dosage: readString(dto, 'dosage', what),
    frequency: readString(dto, 'frequency', what),
    startDate: readDay(dto, 'startDate', what),
    endDate: readOptionalDay(dto, 'endDate', what),
    prescribedBy: prescriptionId === null ? 'Patient-reported' : `Prescription ${prescriptionId}`,
    status: readEnum(dto, 'status', MEDICATION_STATUSES, what),
  };
}

function toHistoryEvent(value: unknown): MedicalHistoryEvent {
  const what = 'history';
  const dto = asRecord(value, what);
  return {
    id: readString(dto, 'id', what),
    kind: readEnum(dto, 'kind', HISTORY_KINDS, what),
    title: readString(dto, 'title', what),
    date: readString(dto, 'occurredOn', what),
    detail: readOptionalString(dto, 'detail', what) ?? '',
    facility: readOptionalString(dto, 'facility', what),
  };
}

function toNote(value: unknown): ClinicalNote {
  const what = 'note';
  const dto = asRecord(value, what);
  const author = readString(dto, 'author', what);
  return {
    id: readString(dto, 'id', what),
    authorId: author,
    author,
    authoredAt: readString(dto, 'authoredAt', what),
    title: readString(dto, 'title', what),
    body: readString(dto, 'body', what),
    signed: readBoolean(dto, 'signed', what),
  };
}

/** Exported for the documents adapter, which reads the same view back from the link route. */
export function toDocument(value: unknown): PatientDocument {
  const what = 'document';
  const dto = asRecord(value, what);
  return {
    id: readString(dto, 'id', what),
    name: readString(dto, 'name', what),
    category: readEnum(dto, 'category', DOCUMENT_CATEGORIES, what),
    uploadedAt: readString(dto, 'uploadedAt', what),
    uploadedBy: readOptionalString(dto, 'uploadedBy', what) ?? 'Unknown',
    sizeKb: readNumber(dto, 'sizeKb', what),
  };
}

function toAppointment(value: unknown): AppointmentRecord {
  const what = 'appointment';
  const dto = asRecord(value, what);
  return {
    id: readString(dto, 'id', what),
    dateTime: readString(dto, 'scheduledAt', what),
    type: readString(dto, 'visitType', what),
    doctor: readString(asRecord(dto.doctor, `${what}.doctor`), 'fullName', what),
    department: null,
    status: readEnum(dto, 'status', APPOINTMENT_STATUSES, what),
  };
}

function toEmergencyContact(value: unknown): EmergencyContact {
  const what = 'emergencyContact';
  const dto = asRecord(value, what);
  return {
    id: readString(dto, 'id', what),
    name: readString(dto, 'name', what),
    relationship: readString(dto, 'relationship', what),
    phone: readString(dto, 'phone', what),
    isPrimary: readBoolean(dto, 'isPrimary', what),
  };
}

function toAlert(value: unknown): ClinicalAlert {
  const what = 'clinicalAlert';
  const dto = asRecord(value, what);
  return {
    id: readString(dto, 'id', what),
    severity: readEnum(dto, 'severity', ALERT_SEVERITIES, what),
    message: readString(dto, 'message', what),
  };
}

/**
 * `GET …/studies` answers category groups whose studies each carry their
 * modality; the profile shows lab and imaging on separate tabs, so each
 * group is split by modality and empty halves are dropped.
 */
function toStudyCategories(groups: readonly unknown[]): {
  readonly lab: readonly StudyCategory[];
  readonly imaging: readonly StudyCategory[];
} {
  const lab: StudyCategory[] = [];
  const imaging: StudyCategory[] = [];
  for (const groupValue of groups) {
    const group = asRecord(groupValue, 'studies');
    const category = readString(group, 'category', 'studies');
    const studies = readArray(group, 'studies', 'studies').map((value) => {
      const what = 'study';
      const dto = asRecord(value, what);
      return {
        modality: readString(dto, 'modality', what),
        label: readString(dto, 'categoryLabel', what),
        record: {
          id: readString(dto, 'id', what),
          name: readString(dto, 'name', what),
          date: readString(dto, 'performedOn', what),
          status: readEnum(dto, 'status', STUDY_STATUSES, what),
        },
      };
    });
    for (const [modality, target] of [
      ['lab', lab],
      ['imaging', imaging],
    ] as const) {
      const ofModality = studies.filter((study) => study.modality === modality);
      const first = ofModality[0];
      if (first !== undefined) {
        target.push({
          id: `${category}-${modality}`,
          label: first.label,
          studies: ofModality.map((study) => study.record),
        });
      }
    }
  }
  return { lab, imaging };
}

// ── The service ────────────────────────────────────────────────────────────

function contactBody(input: EmergencyContactInput) {
  return {
    name: input.name.trim(),
    relationship: input.relationship.trim(),
    phone: input.phone.trim(),
    isPrimary: input.isPrimary,
  };
}

function pages(patientId: string, name: string) {
  return fetchAllPages(
    (page, pageSize) => apiClient.get(`/patients/${patientId}/${name}`, { page, pageSize }),
    `patient ${name}`,
  );
}

/** A 404 anywhere on a chart means the chart is not reachable by this doctor. */
async function scoped<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (isApiError(error) && error.kind === 'not_found') throw new Error(PATIENT_NOT_FOUND);
    throw error;
  }
}

async function readProfile(patientId: string): Promise<PatientProfileBundle> {
  const id = encodeURIComponent(patientId);
  const [bundleBody, appointments] = await Promise.all([
    apiClient.get(`/patients/${id}/profile`),
    pages(id, 'appointments'),
  ]);

  const bundle = asRecord(readData(bundleBody, 'profile'), 'profile');
  const conditions = readArray(bundle, 'chronicConditions', 'profile').map((condition) => {
    if (typeof condition !== 'string') throw malformedResponse('profile.chronicConditions');
    return condition;
  });
  const patientDto = asRecord(bundle.patient, 'profile.patient');

  return {
    patient: toPatient(patientDto, conditions),
    profile: {
      summary: '',
      vitals: toVitals(bundle.latestVitals),
      allergies: readArray(patientDto, 'allergies', 'profile.patient').map(toAllergy),
      // The bundle's current medications — active only, capped for the
      // summary card. The full history is the Medications tab.
      medications: readArray(bundle, 'medications', 'profile').map(toMedication),
      appointments: appointments.map(toAppointment),
      emergencyContacts: readArray(bundle, 'emergencyContacts', 'profile').map(toEmergencyContact),
      insurance: null,
      alerts: readArray(bundle, 'clinicalAlerts', 'profile').map(toAlert),
    },
  };
}

async function readImaging(patientId: string): Promise<ProfileTabData['imaging']> {
  const data = readData(await apiClient.get(`/patients/${patientId}/studies`), 'studies');
  if (!Array.isArray(data)) throw malformedResponse('studies');
  return toStudyCategories(data as readonly unknown[]).imaging;
}

/** Each tab, read from its own endpoint — and so audited as its own view. */
const TAB_READERS: { readonly [T in ProfileTab]: (id: string) => Promise<ProfileTabData[T]> } = {
  history: async (id) => (await pages(id, 'history')).map(toHistoryEvent),
  medications: async (id) => (await pages(id, 'medications')).map(toMedication),
  notes: async (id) => (await pages(id, 'notes')).map(toNote),
  documents: async (id) => (await pages(id, 'documents')).map(toDocument),
  imaging: readImaging,
};

export const httpProfileService: PatientProfileService = {
  getProfile(patientId) {
    return scoped(() => readProfile(patientId));
  },

  getTab(patientId, tab) {
    const reader = TAB_READERS[tab];
    return scoped(() => reader(encodeURIComponent(patientId)));
  },

  recordVitals(patientId, input) {
    return scoped(async () => {
      const vitals = toVitals(
        readData(
          await apiClient.post(`/patients/${encodeURIComponent(patientId)}/vitals`, input),
          'vitals',
        ),
      );
      if (vitals === null) throw malformedResponse('vitals');
      return vitals;
    });
  },

  addAlert(patientId, input) {
    return scoped(async () =>
      toAlert(
        readData(
          await apiClient.post(`/patients/${encodeURIComponent(patientId)}/alerts`, {
            severity: input.severity,
            message: input.message.trim(),
          }),
          'alert',
        ),
      ),
    );
  },

  addEmergencyContact(patientId, input) {
    return scoped(async () =>
      toEmergencyContact(
        readData(
          await apiClient.post(
            `/patients/${encodeURIComponent(patientId)}/emergency-contacts`,
            contactBody(input),
          ),
          'emergency contact',
        ),
      ),
    );
  },

  addNote(patientId, input) {
    return scoped(async () =>
      toNote(
        readData(
          await apiClient.post(`/patients/${encodeURIComponent(patientId)}/notes`, {
            title: input.title.trim(),
            body: input.body.trim(),
          }),
          'note',
        ),
      ),
    );
  },

  updateNote(patientId, noteId, input) {
    return scoped(async () =>
      toNote(
        readData(
          await apiClient.patch(
            `/patients/${encodeURIComponent(patientId)}/notes/${encodeURIComponent(noteId)}`,
            { title: input.title.trim(), body: input.body.trim() },
          ),
          'note',
        ),
      ),
    );
  },

  signNote(patientId, noteId) {
    return scoped(async () =>
      toNote(
        readData(
          await apiClient.post(
            `/patients/${encodeURIComponent(patientId)}/notes/${encodeURIComponent(noteId)}/sign`,
          ),
          'note',
        ),
      ),
    );
  },

  removeEmergencyContact(patientId, contactId, reason) {
    const trimmed = reason.trim();
    return scoped(async () => {
      // The reason rides in the DELETE body and is kept on the removed row
      // (BR-DEC-003). The server accepts no body; the chart never sends none.
      await apiClient.delete(
        `/patients/${encodeURIComponent(patientId)}/emergency-contacts/${encodeURIComponent(contactId)}`,
        trimmed === '' ? undefined : { reason: trimmed },
      );
    });
  },

  resolveAlert(patientId, alertId, reason) {
    const trimmed = reason.trim();
    return scoped(async () => {
      // Resolving is `active: false`; the row is kept and stays listable with
      // `?includeResolved=true`, its reason with it (`resolutionReason`). The
      // answer is the alert, which nothing reads: the chart refetches its
      // active banners.
      await apiClient.patch(
        `/patients/${encodeURIComponent(patientId)}/alerts/${encodeURIComponent(alertId)}`,
        trimmed === '' ? { active: false } : { active: false, reason: trimmed },
      );
    });
  },

  removeHistoryEvent(patientId, eventId, reason) {
    return scoped(async () => {
      // Mandatory server-side (422 without it); sent as typed, trimmed.
      await apiClient.delete(
        `/patients/${encodeURIComponent(patientId)}/history/${encodeURIComponent(eventId)}`,
        { reason: reason.trim() },
      );
    });
  },

  updateEmergencyContact(patientId, contactId, input) {
    return scoped(async () =>
      toEmergencyContact(
        readData(
          await apiClient.patch(
            `/patients/${encodeURIComponent(patientId)}/emergency-contacts/${encodeURIComponent(contactId)}`,
            contactBody(input),
          ),
          'emergency contact',
        ),
      ),
    );
  },

  addHistoryEvent(patientId, input) {
    const detail = input.detail.trim();
    const facility = input.facility.trim();
    return scoped(async () =>
      toHistoryEvent(
        readData(
          await apiClient.post(`/patients/${encodeURIComponent(patientId)}/history`, {
            kind: input.kind,
            title: input.title.trim(),
            occurredOn: input.occurredOn,
            ...(detail === '' ? {} : { detail }),
            ...(facility === '' ? {} : { facility }),
          }),
          'history event',
        ),
      ),
    );
  },

  addAllergy(patientId, input) {
    const notes = input.notes.trim();
    return scoped(async () =>
      toAllergy(
        readData(
          await apiClient.post(`/patients/${encodeURIComponent(patientId)}/allergies`, {
            allergen: input.allergen.trim(),
            severity: input.severity,
            reaction: input.reaction.trim(),
            ...(notes === '' ? {} : { notes }),
          }),
          'allergy',
        ),
      ),
    );
  },
};
