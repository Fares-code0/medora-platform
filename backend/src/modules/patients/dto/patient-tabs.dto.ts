/**
 * The per-tab projections (API §4.5, §4.6 — M10.3).
 *
 * ## Why these are separate endpoints rather than a fatter bundle
 *
 * API §4.5 calls them "lazy per-tab fetch (P2 pattern)", and the reason
 * is PHI rather than payload size. A clinician who opens a chart's
 * header has not read the notes; a bundle that shipped every tab would
 * make *every* chart open an access to every clinical note on it, and
 * the audit trail could no longer distinguish "looked at the summary"
 * from "read the psychiatric history". Separate reads keep the audit
 * events separate too.
 *
 * ## Every shape here carries attribution
 *
 * `recordedBy` / `authorId` on the wire is the `usr_…` handle, never the
 * uuid and never a name. API §4.6 requires the writes to be "attributed
 * (`recordedBy`), audited", and a handle is what a client resolves to a
 * person through a route that enforces its own authorization.
 */

export interface HistoryEventView {
  readonly id: string;
  /** `diagnosis | surgery | procedure | hospitalization | vaccination`. */
  readonly kind: string;
  readonly title: string;
  /** ISO date, no time — the column is `date`. */
  readonly occurredOn: string;
  readonly detail: string | null;
  readonly facility: string | null;
  readonly recordedBy: string | null;
}

export interface PatientNoteView {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly authoredAt: string;
  /** `users.public_id` of the author. RESTRICT in the schema — a note is attributable or it is not a note. */
  readonly author: string;
  readonly signed: boolean;
  readonly signedAt: string | null;
  /** "AI-assisted, reviewed by …" provenance (UX 2.5). */
  readonly aiAssisted: boolean;
}

export interface VitalSignView {
  readonly id: string;
  readonly recordedAt: string;
  readonly systolic: number;
  readonly diastolic: number;
  readonly heartRate: number;
  readonly temperatureC: number;
  readonly respiratoryRate: number;
  readonly oxygenSaturation: number;
  readonly weightKg: number;
  readonly heightCm: number;
  /** The database's generated column, never recomputed here. */
  readonly bmi: number | null;
  readonly recordedBy: string | null;
}

export interface PatientDocumentView {
  readonly id: string;
  readonly name: string;
  /** `referral | consent | external-record | insurance | report`. */
  readonly category: string;
  readonly sizeKb: number;
  readonly uploadedAt: string;
  readonly uploadedBy: string | null;
}

export interface PatientStudyView {
  readonly id: string;
  readonly modality: string;
  readonly categoryLabel: string;
  readonly name: string;
  readonly performedOn: string;
  readonly status: string;
}

/** `GET …/studies` — "grouped by category" (API §4.5). */
export interface StudyGroupView {
  readonly category: string;
  readonly studies: readonly PatientStudyView[];
}
