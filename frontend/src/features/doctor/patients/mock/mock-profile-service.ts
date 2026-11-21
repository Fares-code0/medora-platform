import { MOCK_PATIENTS, type Patient } from '@/features/shared-domain/patient-identity';
import {
  mockFindPatient,
  mockRecordAllergy,
  mockRecordedAllergies,
  type MockRecordedAllergy,
} from '@/features/shared-domain/patient-identity/mock-directory';
import { medicationsOnChart } from '@/features/shared-domain/prescriptions';

import { buildPatientProfile } from '../model/profile-mock-data';
import {
  ALERT_MESSAGE_MAX,
  CONTACT_NAME_MAX,
  CONTACT_PHONE_PATTERN,
  CONTACT_RELATIONSHIP_MAX,
  HISTORY_DETAIL_MAX,
  HISTORY_FACILITY_MAX,
  HISTORY_TITLE_MAX,
  NOTE_BODY_MAX,
  NOTE_TITLE_MAX,
  NOT_NOTE_AUTHOR,
  PATIENT_NOT_FOUND,
  RETRACTION_REASON_MAX,
  type ChartNoteInput,
  type EmergencyContactInput,
  type NoteAuthor,
  type PatientProfileService,
} from '../model/profile-service';
import type {
  MedicationRecord,
  AllergyRecord,
  ClinicalAlert,
  ClinicalNote,
  EmergencyContact,
  MedicalHistoryEvent,
  VitalSigns,
} from '../model/profile-types';
import { bmiOf, toVitalsInput } from '../model/vitals';

/**
 * The profile over the patient directory's session store — a deterministic
 * chart per patient, generated from their id, served as the opening bundle
 * and as separate tabs exactly as the HTTP adapter serves them.
 *
 * The patient is the directory's (`mockFindPatient`), not the static seed's,
 * so a patient registered this session has a chart and an allergy recorded
 * here is the one the prescription safety screen sees. The chart itself is
 * generated from the patient **as seeded** — the generator draws one random
 * number per allergy and marks the first one severe when the patient has a
 * severe allergy, so feeding it a recorded allergy would relabel a seeded one
 * and shift every field drawn after it. Recorded allergies are appended with
 * exactly what the clinician recorded.
 */

const MOCK_LATENCY_MS = 450;
const TAB_LATENCY_MS = 200;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function findPatient(patientId: string): Patient {
  const patient = mockFindPatient(patientId);
  if (!patient) throw new Error(PATIENT_NOT_FOUND);
  return patient;
}

/**
 * The latest reading recorded this session, per patient. Feature-local, unlike
 * allergies: no other surface screens against vital signs, so there is no
 * second reader for it to drift from.
 */
const recordedVitals = new Map<string, VitalSigns>();

/**
 * Alerts raised and history events added this session, per patient — also
 * feature-local, for the same reason: nothing outside the chart reads them.
 */
const raisedAlerts = new Map<string, readonly ClinicalAlert[]>();
/**
 * A patient's chart notes once anyone has written to them this session.
 *
 * Like the API (BR-DEC-001), an edit or a signature from anyone but the
 * note's author is refused with 403 `not_note_author`, before the signed
 * check — the order the server checks in.
 */
const editedNotes = new Map<string, readonly ClinicalNote[]>();

/** Alerts resolved this session, per patient. Kept, as the server keeps them — only hidden. */
const resolvedAlerts = new Map<string, ReadonlySet<string>>();
const addedHistory = new Map<string, readonly MedicalHistoryEvent[]>();

/**
 * Why each retraction was made, keyed `patientId/targetId` — kept as the
 * server keeps them on the soft-deleted or resolved row (BR-DEC-003). The
 * chart shows none of them: the API serves history and contact reasons on no
 * read (point 4), and an alert's only on a resolved alert, which the chart
 * does not list. Removed history events
 * leave every read: `removedHistory` holds their `patientId/eventId` keys.
 */
const removedHistory = new Set<string>();
const retractionReasons = new Map<string, string>();

/** Test-only: the reason the twin kept for a retraction, as the server's row would hold it. */
export function __mockRetractionReason(patientId: string, targetId: string): string | undefined {
  return retractionReasons.get(`${patientId}/${targetId}`);
}

/**
 * A patient's contact list once anyone has edited it this session; until
 * then the generated one stands. Replaced whole, like the server's rows.
 */
const editedContacts = new Map<string, readonly EmergencyContact[]>();

/** Test-only reset so suites do not leak chart writes into each other. */
export function __resetMockProfileWrites(): void {
  recordedVitals.clear();
  raisedAlerts.clear();
  addedHistory.clear();
  editedContacts.clear();
  resolvedAlerts.clear();
  editedNotes.clear();
  removedHistory.clear();
  retractionReasons.clear();
}

/** The server's reason rule: trimmed, at most `RETRACTION_REASON_MAX`; `''` when none is required. */
function validReason(reason: string, required: boolean): string {
  const trimmed = reason.trim();
  if (required && trimmed === '') throw invalid('A reason is required to remove a history event');
  if (trimmed.length > RETRACTION_REASON_MAX) {
    throw invalid(`Keep the reason to ${String(RETRACTION_REASON_MAX)} characters`);
  }
  return trimmed;
}

function keepReason(patientId: string, targetId: string, reason: string): void {
  if (reason !== '') retractionReasons.set(`${patientId}/${targetId}`, reason);
}

/** The server's 403 for an edit or signature by anyone but the note's author. */
function notNoteAuthor(verb: 'edit' | 'sign'): Error {
  return Object.assign(new Error('API error: forbidden'), {
    kind: 'forbidden',
    code: NOT_NOTE_AUTHOR,
    detail: `Only the note’s author may ${verb} it`,
  });
}

function assertAuthor(note: ClinicalNote, actor: NoteAuthor, verb: 'edit' | 'sign'): void {
  if (note.authorId !== actor.id) throw notNoteAuthor(verb);
}

function validNote(input: ChartNoteInput): ChartNoteInput {
  const title = input.title.trim();
  const body = input.body.trim();
  if (title === '' || title.length > NOTE_TITLE_MAX) throw invalid('Give the note a title');
  if (body === '' || body.length > NOTE_BODY_MAX) throw invalid('Write the note');
  return { title, body };
}

function noteConflict(detail: string): Error {
  return Object.assign(new Error('API error: conflict'), {
    kind: 'conflict',
    code: 'invalid_status_transition',
    detail,
  });
}

/** The API's contact schema, refused the same way. */
function validContact(input: EmergencyContactInput): EmergencyContactInput {
  const name = input.name.trim();
  const relationship = input.relationship.trim();
  const phone = input.phone.trim();
  if (name === '' || name.length > CONTACT_NAME_MAX) throw invalid('Name the contact');
  if (relationship === '' || relationship.length > CONTACT_RELATIONSHIP_MAX) {
    throw invalid('Say how they are related');
  }
  if (!CONTACT_PHONE_PATTERN.test(phone)) throw invalid('Enter a valid phone number');
  return { name, relationship, phone, isPrimary: input.isPrimary };
}

function noteNotFound(): Error {
  return Object.assign(new Error('API error: not_found'), {
    kind: 'not_found',
    detail: 'Note not found',
  });
}

function contactNotFound(): Error {
  return Object.assign(new Error('API error: not_found'), {
    kind: 'not_found',
    detail: 'Contact not found',
  });
}

/** At most one primary, kept so the way the server keeps it: setting one clears the rest. */
function withPrimary(
  contacts: readonly EmergencyContact[],
  primaryId: string | null,
): readonly EmergencyContact[] {
  if (primaryId === null) return contacts;
  return contacts.map((contact) => ({ ...contact, isPrimary: contact.id === primaryId }));
}

/** The refusal the API's schema answers with (422), so the demo keeps nothing the server would not. */
function invalid(detail: string): Error {
  return Object.assign(new Error('API error: validation'), {
    kind: 'validation',
    code: 'validation_failed',
    detail,
  });
}

function isPastOrToday(day: string): boolean {
  const parsed = new Date(`${day}T00:00:00Z`);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(day) &&
    !Number.isNaN(parsed.getTime()) &&
    parsed.getTime() <= Date.now()
  );
}

function toRecord(patientId: string, recorded: MockRecordedAllergy, index: number): AllergyRecord {
  return {
    id: `${patientId}-alg-rec-${String(index)}`,
    allergen: recorded.allergen,
    severity: recorded.severity,
    reaction: recorded.reaction,
    notes: recorded.notes,
    recordedAt: recorded.recordedAt,
  };
}

/** The chart: generated from the seeded patient, plus what was recorded. */
function chartFor(patient: Patient) {
  const recorded = mockRecordedAllergies(patient.id);
  const recordedNames = new Set(recorded.map((allergy) => allergy.allergen));
  const seeded = MOCK_PATIENTS.find((candidate) => candidate.id === patient.id);
  const basis: Patient = {
    ...patient,
    allergies: patient.allergies.filter((allergen) => !recordedNames.has(allergen)),
    hasSevereAllergy: seeded?.hasSevereAllergy ?? false,
  };
  // The patient's prescriptions from the store the pharmacy writes, as the
  // live adapter maps `GET /patients/:id/medications` (NEW-05).
  const chart = buildPatientProfile(
    basis,
    medicationsOnChart(patient.id).map((medication): MedicationRecord => ({
      id: medication.id,
      name: medication.name,
      dosage: medication.dosage,
      frequency: medication.frequency,
      startDate: medication.startDate,
      endDate: medication.endDate,
      prescribedBy: `Prescription ${medication.prescriptionId}`,
      status: medication.status,
    })),
  );

  const severeRecorded = recorded.find((allergy) => allergy.severity === 'severe');
  const alerts: readonly ClinicalAlert[] =
    severeRecorded !== undefined && !basis.hasSevereAllergy
      ? [
          {
            id: 'alert-allergy',
            severity: 'critical',
            message: `Severe allergy on record: ${severeRecorded.allergen}. Verify before prescribing.`,
          },
          ...chart.alerts,
        ]
      : chart.alerts;

  return {
    ...chart,
    history: [...(addedHistory.get(patient.id) ?? []), ...chart.history]
      .filter((event) => !removedHistory.has(`${patient.id}/${event.id}`))
      .sort((a, b) => b.date.localeCompare(a.date)),
    vitals: recordedVitals.get(patient.id) ?? chart.vitals,
    emergencyContacts: editedContacts.get(patient.id) ?? chart.emergencyContacts,
    notes: editedNotes.get(patient.id) ?? chart.notes,
    allergies: [
      ...chart.allergies,
      ...recorded.map((allergy, index) => toRecord(patient.id, allergy, index)),
    ],
    // Raised this session first: the newest banner is the one nobody has read.
    alerts: [...(raisedAlerts.get(patient.id) ?? []), ...alerts].filter(
      (alert) => !(resolvedAlerts.get(patient.id)?.has(alert.id) ?? false),
    ),
  };
}

export const mockProfileService: PatientProfileService = {
  async getProfile(patientId) {
    await delay(MOCK_LATENCY_MS);
    const patient = findPatient(patientId);
    const chart = chartFor(patient);
    return {
      patient,
      profile: {
        summary: chart.summary,
        vitals: chart.vitals,
        allergies: chart.allergies,
        medications: chart.medications,
        appointments: chart.appointments,
        emergencyContacts: chart.emergencyContacts,
        insurance: chart.insurance,
        alerts: chart.alerts,
      },
    };
  },

  async getTab(patientId, tab) {
    await delay(TAB_LATENCY_MS);
    return chartFor(findPatient(patientId))[tab];
  },

  async recordVitals(patientId, input) {
    await delay(MOCK_LATENCY_MS);
    findPatient(patientId);
    // The API's own bounds, so the demo cannot keep a reading the server refuses.
    if (toVitalsInput(input) === null) {
      throw Object.assign(new Error('API error: validation'), {
        kind: 'validation',
        code: 'validation_failed',
        detail: 'One or more readings are outside what the chart accepts.',
      });
    }
    const vitals: VitalSigns = {
      recordedAt: new Date().toISOString(),
      bloodPressure: `${String(input.systolic)}/${String(input.diastolic)} mmHg`,
      heartRateBpm: input.heartRate,
      temperatureC: input.temperatureC,
      respiratoryRate: input.respiratoryRate,
      oxygenSaturation: input.oxygenSaturation,
      weightKg: input.weightKg,
      heightCm: input.heightCm,
      bmi: bmiOf(input.weightKg, input.heightCm),
    };
    recordedVitals.set(patientId, vitals);
    return vitals;
  },

  async addAllergy(patientId, input) {
    await delay(MOCK_LATENCY_MS);
    findPatient(patientId);
    const recorded = mockRecordAllergy(patientId, {
      allergen: input.allergen,
      severity: input.severity,
      reaction: input.reaction,
      notes: input.notes,
    });
    if (recorded === undefined) throw new Error(PATIENT_NOT_FOUND);
    return toRecord(patientId, recorded, mockRecordedAllergies(patientId).length - 1);
  },

  async addAlert(patientId, input) {
    await delay(MOCK_LATENCY_MS);
    findPatient(patientId);
    const message = input.message.trim();
    if (message === '' || message.length > ALERT_MESSAGE_MAX) {
      throw invalid(`An alert is 1–${String(ALERT_MESSAGE_MAX)} characters.`);
    }
    const existing = raisedAlerts.get(patientId) ?? [];
    const alert: ClinicalAlert = {
      id: `${patientId}-alert-raised-${String(existing.length + 1)}`,
      severity: input.severity,
      message,
    };
    raisedAlerts.set(patientId, [alert, ...existing]);
    return alert;
  },

  async addEmergencyContact(patientId, input) {
    await delay(MOCK_LATENCY_MS);
    const patient = findPatient(patientId);
    const fields = validContact(input);
    const current = chartFor(patient).emergencyContacts;
    const contact: EmergencyContact = {
      id: `${patientId}-ec-added-${String(current.length + 1)}`,
      ...fields,
    };
    const next = withPrimary([...current, contact], fields.isPrimary ? contact.id : null);
    editedContacts.set(patientId, next);
    return next.find((candidate) => candidate.id === contact.id) ?? contact;
  },

  async addNote(patientId, input, author) {
    await delay(MOCK_LATENCY_MS);
    const patient = findPatient(patientId);
    const fields = validNote(input);
    const current = chartFor(patient).notes;
    const note: ClinicalNote = {
      id: `${patientId}-note-added-${String(current.length + 1)}`,
      authorId: author.id,
      author: author.name,
      authoredAt: new Date().toISOString(),
      ...fields,
      signed: false,
    };
    editedNotes.set(patientId, [note, ...current]);
    return note;
  },

  async updateNote(patientId, noteId, input, actor) {
    await delay(MOCK_LATENCY_MS);
    const patient = findPatient(patientId);
    const fields = validNote(input);
    const current = chartFor(patient).notes;
    const existing = current.find((note) => note.id === noteId);
    if (existing === undefined) throw noteNotFound();
    assertAuthor(existing, actor, 'edit');
    if (existing.signed) throw noteConflict('A signed note cannot be edited');
    const updated: ClinicalNote = { ...existing, ...fields };
    editedNotes.set(
      patientId,
      current.map((note) => (note.id === noteId ? updated : note)),
    );
    return updated;
  },

  async signNote(patientId, noteId, actor) {
    await delay(MOCK_LATENCY_MS);
    const patient = findPatient(patientId);
    const current = chartFor(patient).notes;
    const existing = current.find((note) => note.id === noteId);
    if (existing === undefined) throw noteNotFound();
    assertAuthor(existing, actor, 'sign');
    if (existing.signed) throw noteConflict('That note is already signed');
    const signed: ClinicalNote = { ...existing, signed: true };
    editedNotes.set(
      patientId,
      current.map((note) => (note.id === noteId ? signed : note)),
    );
    return signed;
  },

  async removeEmergencyContact(patientId, contactId, reason) {
    await delay(MOCK_LATENCY_MS);
    const patient = findPatient(patientId);
    // Optional server-side, as the API's schema has it; the chart requires it.
    const kept = validReason(reason, false);
    const current = chartFor(patient).emergencyContacts;
    if (!current.some((contact) => contact.id === contactId)) throw contactNotFound();
    keepReason(patientId, contactId, kept);
    // As the server does: the rest are untouched, and no one is promoted.
    editedContacts.set(
      patientId,
      current.filter((contact) => contact.id !== contactId),
    );
  },

  async resolveAlert(patientId, alertId, reason) {
    await delay(MOCK_LATENCY_MS);
    const patient = findPatient(patientId);
    const kept = validReason(reason, false);
    if (!chartFor(patient).alerts.some((alert) => alert.id === alertId)) {
      throw Object.assign(new Error('API error: not_found'), {
        kind: 'not_found',
        detail: 'Alert not found',
      });
    }
    resolvedAlerts.set(patientId, new Set([...(resolvedAlerts.get(patientId) ?? []), alertId]));
    keepReason(patientId, alertId, kept);
  },

  async removeHistoryEvent(patientId, eventId, reason) {
    await delay(MOCK_LATENCY_MS);
    const patient = findPatient(patientId);
    const kept = validReason(reason, true);
    if (!chartFor(patient).history.some((event) => event.id === eventId)) {
      throw Object.assign(new Error('API error: not_found'), {
        kind: 'not_found',
        detail: 'History event not found',
      });
    }
    removedHistory.add(`${patientId}/${eventId}`);
    keepReason(patientId, eventId, kept);
  },

  async updateEmergencyContact(patientId, contactId, input) {
    await delay(MOCK_LATENCY_MS);
    const patient = findPatient(patientId);
    const fields = validContact(input);
    const current = chartFor(patient).emergencyContacts;
    if (!current.some((contact) => contact.id === contactId)) throw contactNotFound();
    const replaced = current.map((contact) =>
      contact.id === contactId ? { id: contactId, ...fields } : contact,
    );
    const next = withPrimary(replaced, fields.isPrimary ? contactId : null);
    editedContacts.set(patientId, next);
    return next.find((contact) => contact.id === contactId) ?? { id: contactId, ...fields };
  },

  async addHistoryEvent(patientId, input) {
    await delay(MOCK_LATENCY_MS);
    findPatient(patientId);
    const title = input.title.trim();
    const detail = input.detail.trim();
    const facility = input.facility.trim();
    if (title === '' || title.length > HISTORY_TITLE_MAX) {
      throw invalid(`Name the event in 1–${String(HISTORY_TITLE_MAX)} characters.`);
    }
    if (!isPastOrToday(input.occurredOn)) {
      throw invalid('A history event cannot be in the future.');
    }
    if (detail.length > HISTORY_DETAIL_MAX || facility.length > HISTORY_FACILITY_MAX) {
      throw invalid('The detail or facility is longer than the chart accepts.');
    }
    const existing = addedHistory.get(patientId) ?? [];
    const event: MedicalHistoryEvent = {
      id: `${patientId}-hist-added-${String(existing.length + 1)}`,
      kind: input.kind,
      title,
      date: input.occurredOn,
      detail,
      facility: facility === '' ? null : facility,
    };
    addedHistory.set(patientId, [event, ...existing]);
    return event;
  },
};
