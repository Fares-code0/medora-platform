import type { DoctorRecord, DocumentChecklist, RequestableDocumentKind } from '../doctors.types';

import type {
  AccountInput,
  DoctorsDocument,
  DocumentDecisionInput,
  InviteInput,
  VerificationInput,
} from './doctors.api';

/**
 * Doctors management — the port (ADM-02 / ADM-03, FE-10.10).
 *
 * Two adapters sit behind it: the demo store (`doctors.api.ts`), and the
 * HTTP adapter over API §3.4–3.7 (`../http/http-doctors-service.ts`).
 * `service.ts` picks one; nothing else imports an adapter.
 *
 * ## Writes answer "here is the new document" or "ask again"
 *
 * The demo store returns the whole patched document, and the query layer
 * seeds its cache from it — the StrictMode-safe pattern the admin area was
 * built on. The live API answers a decision with the one field it changed
 * (`{ verificationStatus }`, `{ practiceStatus, affectedAppointments }`),
 * not a roster, so its adapter resolves `null` and the query layer
 * re-reads the roster, the open profile and the pending badge from the
 * server. Neither path guesses what the server did.
 */

/** What the platform behind the port can do — the screens offer only that. */
export interface DoctorsCapabilities {
  /**
   * Onboarding invitations for doctors. The live platform has none on
   * purpose: doctors self-register and are then verified, because their
   * registration number is checked against a register rather than typed in
   * by an administrator (`PlatformUserController`'s doc comment).
   */
  readonly invite: boolean;
  /** "Send access reset" — no administrator route; doctors use forgot-password. */
  readonly resetAccess: boolean;
  /** Reopening a rejected application — no route for it. */
  readonly returnToReview: boolean;
  /** Role template and clinic — the live API keeps neither for a doctor. */
  readonly administrativeFields: boolean;
}

/** The live API's request-documents body names the documents it asks for. */
export interface RequestDocumentsInput extends VerificationInput {
  readonly kinds: readonly RequestableDocumentKind[];
}

/** A checklist tick, written one field at a time (see `doctorsApi.setCheck`). */
export interface ChecklistTickInput {
  readonly doctorId: string;
  readonly documentId: string;
  readonly field: keyof DocumentChecklist;
  readonly value: boolean;
}

/** The patched document, or `null` for "re-read it from the server". */
export type DoctorsWrite = Promise<DoctorsDocument | null>;

export interface AdminDoctorsService {
  readonly capabilities: DoctorsCapabilities;
  list(): Promise<DoctorsDocument>;
  /** The full administrative file; `null` when no such doctor exists. */
  detail(doctorId: string): Promise<DoctorRecord | null>;
  /** How many verifications wait on an administrator — the shell badge. */
  pendingVerifications(): Promise<number>;
  setCheck(input: ChecklistTickInput): DoctorsWrite;
  approveDocument(input: DocumentDecisionInput): DoctorsWrite;
  rejectDocument(input: DocumentDecisionInput): DoctorsWrite;
  completeVerification(input: VerificationInput): DoctorsWrite;
  requestDocuments(input: RequestDocumentsInput): DoctorsWrite;
  rejectApplication(input: VerificationInput): DoctorsWrite;
  returnToReview(input: VerificationInput): DoctorsWrite;
  suspend(input: AccountInput): DoctorsWrite;
  reactivate(input: AccountInput): DoctorsWrite;
  resetAccess(input: AccountInput): DoctorsWrite;
  updateAdministrative(input: {
    doctorId: string;
    actor: string;
    fields: NonNullable<DoctorRecord['administrative']>;
  }): DoctorsWrite;
  invite(input: InviteInput): DoctorsWrite;
}
