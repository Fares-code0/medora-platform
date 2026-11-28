/** Wire shapes of the account-linking routes (contract §1) and `/me/insurance` (§4). */

/** `GET /me/patient-link`. */
export interface PatientLinkStatusView {
  readonly linked: boolean;
  readonly patient: { readonly id: string; readonly fullName: string } | null;
}

/** `POST /me/patient-link/code` — the code is shown once and never stored. */
export interface PatientLinkCodeView {
  readonly code: string;
  readonly expiresAt: string;
}

/** `POST /patients/:patientId/account-link`. */
export interface AccountLinkedView {
  readonly patient: { readonly id: string };
  readonly linkedAt: string;
}

/** `DELETE /patients/:patientId/account-link`. */
export interface AccountUnlinkedView {
  readonly patient: { readonly id: string };
  readonly unlinkedAt: string;
  readonly sessionsRevoked: number;
}

/** `GET /me/insurance` (contract §4). The policy number never leaves whole. */
export interface PatientInsuranceView {
  readonly insurance: {
    readonly providerName: string;
    readonly plan: string | null;
    readonly policyNumberLast4: string;
    readonly validUntil: string | null;
    readonly isActive: boolean;
  } | null;
  readonly authorizations: {
    readonly available: false;
    readonly reason: 'authorization_workflow_undecided';
  };
}
