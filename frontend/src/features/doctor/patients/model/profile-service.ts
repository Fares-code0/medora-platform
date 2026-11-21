import type {
  AllergyRecord,
  AllergySeverity,
  ClinicalAlert,
  ClinicalNote,
  EmergencyContact,
  HistoryEventKind,
  MedicalHistoryEvent,
  PatientProfileBundle,
  ProfileTab,
  ProfileTabData,
  VitalSigns,
} from './profile-types';
import type { NewVitalsInput } from './vitals';

/**
 * The patient-profile port (FE-10.2).
 *
 * Two reads, matching the backend's split (API §4.4 bundle, §4.5–4.6 tabs):
 * `getProfile` for what the chart shows on opening, and `getTab` for each
 * tab's record, called only when that tab is opened — see `PatientProfile`
 * for why the split is an audit-trail property and not an optimisation.
 */

/**
 * The rejection a chart that does not exist — or is not in this doctor's
 * care scope, which the server reports the same way (404, never 403, so an
 * id cannot be probed) — arrives as. The page maps it to "Patient not found".
 */
export const PATIENT_NOT_FOUND = 'PATIENT_NOT_FOUND';

/** API §4.6's allergy body; the bounds are the server's. */
export interface NewAllergyInput {
  /** 1–120 characters. */
  readonly allergen: string;
  /** Chosen explicitly — a default severity would be a clinical claim nobody made. */
  readonly severity: AllergySeverity;
  /** 1–200 characters. */
  readonly reaction: string;
  /** Up to 1,000 characters; empty means none. */
  readonly notes: string;
}

/** API §4.5's clinical alert body (M10.5). */
export interface NewAlertInput {
  /** Chosen explicitly, like an allergy's severity. */
  readonly severity: ClinicalAlert['severity'];
  /** 1–300 characters: a banner has to be readable at a glance. */
  readonly message: string;
}

export const ALERT_MESSAGE_MAX = 300;

/** API §4.6's history event body. */
export interface NewHistoryEventInput {
  readonly kind: HistoryEventKind;
  /** 1–200 characters. */
  readonly title: string;
  /** `YYYY-MM-DD`, never in the future. */
  readonly occurredOn: string;
  /** Up to 5,000 characters; empty means none. */
  readonly detail: string;
  /** Up to 120 characters; empty means none. */
  readonly facility: string;
}

export const HISTORY_TITLE_MAX = 200;
export const HISTORY_DETAIL_MAX = 5_000;
export const HISTORY_FACILITY_MAX = 120;

/** A write the API's own schema would refuse (its 422), refused the same way by the mock. */
export const CHART_WRITE_INVALID = 'CHART_WRITE_INVALID';

/**
 * The latest day a history event may carry. The server refuses a day whose
 * UTC midnight is after "now", so near midnight the local and UTC calendars
 * disagree; the earlier of the two is the one both sides accept.
 */
export function latestHistoryDay(now: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const local = `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const utc = now.toISOString().slice(0, 10);
  return local < utc ? local : utc;
}

/** API §4.6's chart note body. */
export interface ChartNoteInput {
  /** 1–200 characters. */
  readonly title: string;
  /** 1–20,000 characters. */
  readonly body: string;
}

export const NOTE_TITLE_MAX = 200;
export const NOTE_BODY_MAX = 20_000;

/** Who is writing — the mock stamps it; the server takes it from the session. */
export interface NoteAuthor {
  readonly id: string;
  readonly name: string;
}

/**
 * Whether to **offer** Edit and Sign on a note (DEC-001): unsigned, and
 * written by the signed-in user.
 *
 * This is the display half of the rule. The server enforces the other half
 * (BR-DEC-001, `backend` 2026-10-24): an edit or signature from anyone but
 * the note's author is refused with 403 `not_note_author`, for direct API
 * calls as well as this screen. Hiding the controls keeps a doctor from
 * reaching that refusal; it is not what makes the rule hold.
 */
export function canActOnNote(note: ClinicalNote, userId: string | undefined): boolean {
  return !note.signed && userId !== undefined && userId !== '' && note.authorId === userId;
}

/** API §4.6's emergency contact body. */
export interface EmergencyContactInput {
  /** 1–120 characters. */
  readonly name: string;
  /** 1–60 characters. */
  readonly relationship: string;
  /** The server's phone rule: `CONTACT_PHONE_PATTERN`, up to 30 characters. */
  readonly phone: string;
  /** Setting one primary clears the flag on the others (server-side). */
  readonly isPrimary: boolean;
}

export const CONTACT_NAME_MAX = 120;
export const CONTACT_RELATIONSHIP_MAX = 60;
/** `backend/src/modules/patients/dto/patient-tabs.schema.ts` `phoneRegex`. */
export const CONTACT_PHONE_PATTERN = /^\+?[0-9][0-9\s-]{6,18}$/;

/**
 * The server's ceiling on every removal and resolution reason (BR-DEC-003:
 * `removeHistorySchema`, `removeContactSchema`, `updateAlertSchema`).
 */
export const RETRACTION_REASON_MAX = 300;

/** The refusal code an edit or signature by anyone but the note's author gets (BR-DEC-001). */
export const NOT_NOTE_AUTHOR = 'not_note_author';

export const ALLERGEN_MAX = 120;
export const ALLERGY_REACTION_MAX = 200;
export const ALLERGY_NOTES_MAX = 1_000;

export interface PatientProfileService {
  getProfile(patientId: string): Promise<PatientProfileBundle>;
  getTab<T extends ProfileTab>(patientId: string, tab: T): Promise<ProfileTabData[T]>;
  /**
   * Records an allergy (API §4.6) on the list the prescription safety screen
   * screens against — the server's in a live build, the directory store in
   * the mock. Rejects with a `conflict` for an allergen already on record.
   * The port has no edit or remove: correcting an allergy is a clinical act
   * with its own audit, not a form field.
   */
  addAllergy(patientId: string, input: NewAllergyInput): Promise<AllergyRecord>;
  /**
   * Records a complete set of vital signs (API §4.6), which becomes the
   * chart's latest reading. BMI is the server's (a generated column), never
   * computed by the client.
   */
  recordVitals(patientId: string, input: NewVitalsInput): Promise<VitalSigns>;
  /**
   * Raises a clinical alert (API §4.5) — the banner the chart's Overview
   * shows above everything else. `resolveAlert` takes one down.
   */
  addAlert(patientId: string, input: NewAlertInput): Promise<ClinicalAlert>;
  /** Adds an event to the medical-history timeline (API §4.6). */
  addHistoryEvent(patientId: string, input: NewHistoryEventInput): Promise<MedicalHistoryEvent>;
  /** Adds an emergency contact (API §4.6). */
  addEmergencyContact(patientId: string, input: EmergencyContactInput): Promise<EmergencyContact>;
  /** Writes an unsigned chart note (API §4.6). The server stamps the author from the session. */
  addNote(patientId: string, input: ChartNoteInput, author: NoteAuthor): Promise<ClinicalNote>;
  /**
   * Replaces an unsigned note's title and body. The server answers 403
   * `not_note_author` to anyone but its author (BR-DEC-001) and 409 once it is
   * signed. `actor` is who is asking — the mock checks it; the server takes it
   * from the session, as with `addNote`'s author.
   */
  updateNote(
    patientId: string,
    noteId: string,
    input: ChartNoteInput,
    actor: NoteAuthor,
  ): Promise<ClinicalNote>;
  /** Signs a note; its content is frozen from then on. 403 for a non-author, 409 if signed. */
  signNote(patientId: string, noteId: string, actor: NoteAuthor): Promise<ClinicalNote>;
  /**
   * Removes a contact (API §4.6) — a soft delete server-side, audited with
   * actor and time. The reason is persisted on the removed row (BR-DEC-003);
   * the server accepts its absence, the chart does not send one without it
   * (DEC-003: required once the backend can record it). Removing the primary
   * leaves no contact primary; the server does not promote another.
   */
  removeEmergencyContact(patientId: string, contactId: string, reason: string): Promise<void>;
  /**
   * Resolves an alert (API §4.5): it leaves the active banners and its row is
   * kept — `active: false`, never a delete (DEC-003). A non-empty `reason` is
   * persisted with it (BR-DEC-003); an empty one sends none, which the server
   * accepts — DEC-003 does not make it mandatory for an alert.
   */
  resolveAlert(patientId: string, alertId: string, reason: string): Promise<void>;
  /**
   * Removes a history event added in error (DEC-003) — a soft delete; the
   * server keeps the row and the **mandatory** reason on it (BR-DEC-003) and
   * answers 422 without one. Removed events are hidden from every read: the
   * API cannot yet return them marked as removed (BR-DEC-003 point 4).
   * Correcting an event is not on the port — no route exists (point 1).
   */
  removeHistoryEvent(patientId: string, eventId: string, reason: string): Promise<void>;
  /** Replaces a contact's details; the server keeps at most one primary. */
  updateEmergencyContact(
    patientId: string,
    contactId: string,
    input: EmergencyContactInput,
  ): Promise<EmergencyContact>;
}
