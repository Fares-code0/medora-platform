import type { CompleteRecordDraft, MedicalRecordDraft } from './authoring';
import type { SignableNote } from './record-lifecycle';
import type {
  MedicalRecord,
  MedicalRecordStatus,
  MedicalRecordSummary,
  RecordDiagnosis,
} from './types';

/**
 * The medical-records port — `api/seam.ts`'s pattern, one feature, one port.
 *
 * Two adapters implement it: the session-lifetime mock, and the HTTP
 * adapter over API §6 (`http/http-record-service.ts`, FE-10.5). `service.ts`
 * chooses between them.
 *
 * **There is no `editNote`, and that is the point.** A signed clinical note
 * is a record of what a clinician believed at a time. Correcting it means
 * appending an addendum under your own name, which is what `amend` does.
 * Rewriting one is not a missing button here, it is a method that does not
 * exist — so it is a compile error rather than a policy someone can forget.
 */
export interface RecordService {
  /* ── Reads ─────────────────────────────────────────────────── */
  /** The list's rows (API §6.1) — summaries, not documents. */
  listRecords(filter?: RecordListFilter): Promise<readonly MedicalRecordSummary[]>;
  getRecord(recordId: string): Promise<MedicalRecord>;

  /* ── Drafts ────────────────────────────────────────────────── */
  /*
   * In-progress authoring, held for this tab only by both adapters. The
   * records service has no draft store — its `draft` is a record that
   * exists — and the browser's storage is not a place for clinical text.
   */
  listDrafts(): Promise<readonly MedicalRecordDraft[]>;
  saveDraft(draft: MedicalRecordDraft): Promise<MedicalRecordDraft>;
  discardDraft(draftId: string): Promise<void>;

  /* ── Authoring (D-21) ──────────────────────────────────────── */
  /**
   * Creates the record from a draft the type system has already checked is
   * complete. The record arrives with its first note **unsigned** — creating
   * and signing are two acts, and collapsing them would mean a doctor could
   * produce a signed clinical statement without ever being shown the review
   * step.
   */
  createRecord(draft: CompleteRecordDraft, authoredBy: string): Promise<MedicalRecord>;

  /**
   * Signs one note. Takes `SignableNote`, whose only producer is
   * `assessNoteSignability` — so no caller reaches this without an existing,
   * unsigned, non-empty note of their own. Never optimistic: nothing may look
   * signed before it is.
   */
  signNote(signable: SignableNote): Promise<MedicalRecord>;

  /** Appends an addendum. The only way to change what a record says. */
  amendRecord(input: AmendRecordInput): Promise<MedicalRecord>;

  /** Moves the encounter along its lifecycle; refuses an illegal transition. */
  setStatus(input: SetRecordStatusInput): Promise<MedicalRecord>;

  /**
   * Reports that something on the record is wrong (API §6.9). It changes
   * nothing on the record — correcting it is the author's addendum — and it
   * needs only read access, because the clinician most likely to notice an
   * error in a chart is often not the one who wrote it. The server keeps the
   * report and logs it in the reporter's activity; nothing in this client
   * reads reports back, so the caller must not promise who will see it.
   */
  reportIssue(input: ReportRecordIssueInput): Promise<void>;

  /**
   * Edits a record's fields (API §6.4) — sent only the fields that changed.
   * The server writes a version row with who, when and before/after values,
   * and refuses a completed or archived record (409 `record_not_editable`)
   * and an edit that changes nothing (409 `no_effective_change`).
   *
   * DEC-004: the client offers this **only on a draft with nothing signed**
   * (`canEditRecord`), stricter than the server. The server refuses anyone but
   * the record's author with 403 `not_record_author` (BR-DEC-004), surfaced as
   * `RECORD_NOT_AUTHOR`, and keeps an optional reason on the version row.
   */
  updateRecord(input: UpdateRecordInput): Promise<MedicalRecord>;

  /** The record's version history (API §6.8), newest first. */
  listVersions(recordId: string): Promise<readonly RecordVersion[]>;

  readonly capabilities: RecordServiceCapabilities;
}

export interface RecordListFilter {
  readonly patientId?: string;
}

export interface RecordServiceCapabilities {
  /**
   * Whether vitals entered while authoring are stored with the record.
   * API §6.3 has no field for them — vitals live on the patient's chart
   * and nothing links a reading to a record — so the HTTP adapter says no.
   */
  readonly attachesVitals: boolean;
  /** Whether a created record reaches the records service (false: this tab only). */
  readonly persistsRecords: boolean;
}

export interface AmendRecordInput {
  readonly recordId: string;
  readonly title: string;
  readonly body: string;
  readonly author: string;
}

export interface SetRecordStatusInput {
  readonly recordId: string;
  readonly status: MedicalRecordStatus;
  readonly actor: string;
}

/** The port's one error contract: the id does not resolve to a record. */
/** The fields DEC-004's edit may change; each one present is sent. */
export interface RecordEditableFields {
  /** A day, `YYYY-MM-DD`. */
  readonly visitDate: string;
  readonly visitType: string;
  readonly chiefComplaint: string;
  readonly historyOfPresentIllness: string;
  readonly physicalExamination: string;
  readonly diagnoses: readonly RecordDiagnosis[];
  /** Ordered steps; the whole list replaces the stored one. */
  readonly treatmentPlan: readonly string[];
  /** A day, `YYYY-MM-DD`, or `null` to clear it. */
  readonly followUpDate: string | null;
}

export interface UpdateRecordInput {
  readonly recordId: string;
  /** Only what differs from the record as loaded — the server refuses an empty change. */
  readonly changes: Partial<RecordEditableFields>;
  /** The mock's version row; the server takes the actor from the session. */
  readonly actor: string;
  /**
   * Why the edit was made (BR-DEC-004), kept on the version row; `''` sends
   * none. Optional server-side — whether to require it is the owner's call.
   */
  readonly reason: string;
}

/** API §6.8 — one entry of the version history. */
export interface RecordVersion {
  readonly version: number;
  readonly changedAt: string;
  readonly actor: string;
  readonly summary: string | null;
  /** The editor's reason, when one was given (BR-DEC-004); else `null`. */
  readonly reason: string | null;
  /** `{ field: { before, after } }`, as the server records it; rendered, never interpreted. */
  readonly changes: Readonly<Record<string, unknown>>;
}

/** A narrative field's bound (API §6.4's `narrative`). */
export const RECORD_NARRATIVE_MAX = 20_000;

/** The server's refusal of an edit that changes nothing. */
export const RECORD_NO_CHANGE = 'RECORD_NO_CHANGE';

/** The server's refusal to edit a completed or archived record. */
export const RECORD_NOT_EDITABLE = 'RECORD_NOT_EDITABLE';

/**
 * The server's refusal of an edit by anyone but the record's author
 * (BR-DEC-004, 403 `not_record_author`). The client cannot offer Edit to the
 * author only — a record names its doctor, not the session's account
 * (DEC-004) — so this refusal is the one place a colleague learns the rule.
 */
export const RECORD_NOT_AUTHOR = 'RECORD_NOT_AUTHOR';

/** The server's ceiling on an edit's reason (`updateRecordSchema.reason`). */
export const RECORD_EDIT_REASON_MAX = 300;

/** The server's bounds on a treatment plan (`treatmentPlanInput`): steps, and characters per step. */
export const RECORD_PLAN_STEPS_MAX = 50;
export const RECORD_PLAN_STEP_MAX = 500;

export interface ReportRecordIssueInput {
  readonly recordId: string;
  /** 1–2,000 characters after trimming (API §6.9's `reportIssueSchema`). */
  readonly description: string;
}

export const RECORD_ISSUE_MAX = 2_000;

/** A description the API would refuse: empty after trimming, or over the cap. */
export const RECORD_ISSUE_INVALID = 'RECORD_ISSUE_INVALID';

export const RECORD_NOT_FOUND = 'RECORD_NOT_FOUND';

/**
 * The record was created but its first note was not saved — two requests
 * against the records service, and the second failed. The error carries the
 * `recordId`, because "nothing was created" would be false and would invite
 * a duplicate.
 */
export const RECORD_NOTE_NOT_SAVED = 'RECORD_NOTE_NOT_SAVED';

/** Refused by `setStatus` when the transition is not on the map. */
export const ILLEGAL_TRANSITION = 'ILLEGAL_RECORD_TRANSITION';
