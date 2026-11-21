import type { PrescriptionDraft } from './authoring';
import type { Formulary, MedicationMonograph } from './catalogue';
import type {
  SafetyCheckSubject,
  SafetyEvidenceSource,
  SignablePrescription,
} from './safety-check';
import type { Prescription, PrescriptionSummary } from './types';

/**
 * The pharmacy port — `api/seam.ts`'s pattern, one feature, one port.
 *
 * Two adapters implement it: the session-lifetime mock over the demo
 * formulary, and the HTTP adapter over API §7 (`http/http-prescription-
 * service.ts`, FE-10.6), whose safety screen is the server's. `service.ts`
 * chooses between them; nothing downstream imports either, and the feature
 * never reads `env.enableMocks` itself.
 */
/** How many matches a medication search returns: one page, as a typeahead shows. */
export const MEDICATION_SEARCH_PAGE_SIZE = 20;

export interface PrescriptionService {
  /* ── Reads ─────────────────────────────────────────────────── */
  /** The list's rows (API §7.3) — summaries, not documents. */
  listPrescriptions(): Promise<readonly PrescriptionSummary[]>;
  getPrescription(prescriptionId: string): Promise<Prescription>;
  /** The formulary a prescription may be written from (API §7.1). */
  listMedications(): Promise<Formulary>;
  /**
   * The formulary entries whose brand or generic name contains `query`,
   * case-insensitively (API §7.1's `q`, D-18's typeahead). The server's
   * first page — the 20 best a typeahead shows — not the whole formulary.
   */
  searchMedications(query: string): Promise<Formulary>;
  /**
   * A formulary entry's prescribing reference (API §7.2), or `null` when the
   * formulary holds none for it — an absent monograph is an answer, not a
   * failure. Offered only where `capabilities.monographs` says a source
   * exists.
   */
  getMonograph(medicationId: string): Promise<MedicationMonograph | null>;
  /**
   * What the patient is on right now, from **every** source on their record:
   * any prescriber's prescriptions and what the patient reported. The
   * prescribing flow's pinned strip reads this, not `listPrescriptions` —
   * that one is the caller's own list (API §7.3), and drawing "current
   * medications" from it would show "none" for a patient on another
   * clinician's warfarin.
   */
  listCurrentMedications(patientId: string): Promise<readonly MedicationOnRecord[]>;

  /* ── Drafts (D-19: save as draft) ──────────────────────────── */
  listDrafts(): Promise<readonly PrescriptionDraft[]>;
  saveDraft(draft: PrescriptionDraft): Promise<PrescriptionDraft>;
  discardDraft(draftId: string): Promise<void>;

  /* ── The safety screen (D-17) ──────────────────────────────── */
  /**
   * Returns the raw screening result. Deliberately typed `unknown`: the
   * caller is `runSafetyCheck`, which refuses to treat anything it cannot
   * positively read as a warning list as "checked and clear". A port typed
   * to the happy shape would hand a future HTTP adapter a free pass to
   * mis-parse a body into an empty array — the exact fail-open this feature
   * is built to prevent.
   */
  checkSafety(subject: SafetyCheckSubject, signal: AbortSignal): Promise<unknown>;

  /* ── Lifecycle (D-19) ──────────────────────────────────────── */
  /**
   * Signs and issues. Takes `SignablePrescription`, whose only producer is
   * `assessSignability` — so no caller can reach this method without a
   * completed safety verdict. Never optimistic: nothing may look signed
   * before it is.
   */
  sign(signable: SignablePrescription): Promise<Prescription>;
  /** Opens a fresh draft pre-filled from an existing prescription. */
  renew(prescriptionId: string): Promise<PrescriptionDraft>;
  /**
   * Ends a prescription (DEC-002). Both write `discontinued`; the audit trail
   * records which act it was. `cancel` withdraws one that has not taken
   * effect (`pending-approval`); `discontinue` stops a therapy under way
   * (`active`, `dispensed`). `endActFor` picks; neither accepts a draft.
   */
  cancel(input: EndPrescriptionInput): Promise<Prescription>;
  discontinue(input: EndPrescriptionInput): Promise<Prescription>;
  /**
   * Discards an unsigned **server** draft (BR-DEC-002, ADR-044) — the kind a
   * refused signature leaves in the list, not a locally saved authoring draft
   * (`discardDraft`). A soft delete: the draft leaves every list and read; the
   * row stays for the audit trail. Only the prescriber's own draft: anyone
   * else's, or one already discarded, is `PRESCRIPTION_NOT_FOUND`; anything
   * past `draft` is `PRESCRIPTION_NOT_DRAFT` — a signed prescription is
   * withdrawn by `cancel` or `discontinue`, which keep its record.
   */
  discardPrescriptionDraft(prescriptionId: string): Promise<void>;
  /**
   * Appends a note to a prescription (API §7.10) and answers the document as
   * it now stands. Append-only: the port has no edit or delete, so rewriting
   * what a clinician wrote on a prescription is a compile error rather than a
   * missing button.
   */
  addNote(input: AddPrescriptionNoteInput): Promise<Prescription>;

  readonly capabilities: PrescriptionServiceCapabilities;
}

export interface PrescriptionServiceCapabilities {
  /** What `checkSafety` screens against — stamped on every verdict. */
  readonly safetySource: SafetyEvidenceSource;
  /** Whether a signed prescription reaches the prescribing service. */
  readonly transmits: boolean;
  /**
   * Whether the formulary carries prescribing monographs. False for the demo
   * formulary: inventing indications, contraindications and doses for real
   * drugs would be fabricated clinical reference, so the control is absent
   * rather than offered over prose nobody wrote.
   */
  readonly monographs: boolean;
}

/** The port's not-found contract: the id does not resolve to a prescription. */
/** What a patient is currently on — every course still running. */
export const CURRENT_PRESCRIPTION_STATUSES: ReadonlySet<string> = new Set([
  'active',
  'dispensed',
  'pending-approval',
]);

/** One active medication on a patient's record (API §4.5's medication tab). */
export interface MedicationOnRecord {
  readonly id: string;
  readonly name: string;
  readonly dosage: string;
  readonly frequency: string;
  /** The `RX-…` it was materialised from, or `null` when patient-reported. */
  readonly prescriptionId: string | null;
  /** `null` where the source does not say — never guessed as `false`. */
  readonly isHighRisk: boolean | null;
}

export const PRESCRIPTION_NOT_FOUND = 'PRESCRIPTION_NOT_FOUND';

/** The server's refusal to discard anything but an unsigned draft (409 `prescription_not_draft`). */
export const PRESCRIPTION_NOT_DRAFT = 'PRESCRIPTION_NOT_DRAFT';

export interface EndPrescriptionInput {
  readonly prescriptionId: string;
  /** One of `CANCELLATION_REASONS` — required for either act (UX P4). */
  readonly reason: string;
  readonly details: string;
  readonly actor: string;
}

/** The API's bound on a note's length (API §7.10). */
export const PRESCRIPTION_NOTE_MAX = 4_000;

export interface AddPrescriptionNoteInput {
  readonly prescriptionId: string;
  /** Trimmed and non-empty; the server refuses anything else. */
  readonly body: string;
  /** Display name the mock stamps; the server attributes the caller itself. */
  readonly author: string;
}

export const CANCELLATION_REASONS: readonly string[] = [
  'Adverse reaction',
  'Therapy no longer indicated',
  'Switched to an alternative medication',
  'Prescribed in error',
  'Patient request',
  'Duplicate prescription',
];
