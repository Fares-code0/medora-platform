/**
 * The patient-link port (ADR-048, staff-mediated linking).
 *
 * Field names are the contract's verbatim (`GET /me/patient-link`,
 * `POST /me/patient-link/code`). `patient.id` is the record's public id,
 * never rendered; `fullName` is shown on Profile once linked.
 */

export interface LinkedPatient {
  readonly id: string;
  readonly fullName: string;
}

export interface PatientLinkState {
  readonly linked: boolean;
  /** Non-null exactly when `linked`. */
  readonly patient: LinkedPatient | null;
}

export interface PatientLinkCode {
  /** Eight characters, ungrouped, as the server issued it. */
  readonly code: string;
  /** ISO instant. The server's clock, not this phone's, decides expiry. */
  readonly expiresAt: string;
}

export interface PatientLinkService {
  /** `GET /me/patient-link`. Also the app's eligibility probe (C-11). */
  getState(): Promise<PatientLinkState>;
  /**
   * `POST /me/patient-link/code`. Issuing a code invalidates the previous
   * one. `409 already_linked` when the account is already linked.
   */
  issueCode(): Promise<PatientLinkCode>;
}
