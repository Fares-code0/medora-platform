/**
 * Doctors management — domain types (ADM-02 / ADM-03 · UX §3.2, §3.3).
 *
 * The administrative file on a doctor: who they are, whether their
 * credentials have been proven, what their account is allowed to do, and
 * what they have been doing with it. Deliberately separate from the
 * `PlatformDoctor` the appointment oversight picker reads — that record
 * answers "who has capacity this afternoon", this one answers "is this
 * person who they say they are". They share ids so the two views agree
 * about which doctor is which.
 */

/**
 * Where a doctor sits in the verification workflow. `docs-requested` is a
 * distinct state rather than a flavour of pending: the platform is waiting
 * on the doctor, not on an administrator, and the queue must not count it.
 */
export type VerificationStatus = 'verified' | 'pending' | 'docs-requested' | 'rejected';

/** What the account may do, independent of whether credentials are proven. */
export type AccountStatus = 'active' | 'suspended' | 'vacation';

export type DocumentKind =
  | 'medical-license'
  | 'degree'
  | 'identity'
  | 'insurance'
  | 'reference'
  /** The live API's catch-all for supporting material (FE-10.10). */
  | 'other';

/**
 * The documents an administrator can ask a doctor to (re)submit — the live
 * API's four kinds, in the platform's vocabulary (FE-10.10).
 */
export type RequestableDocumentKind = 'medical-license' | 'degree' | 'identity' | 'other';

export type DocumentDecision = 'approved' | 'rejected' | 'pending';

/**
 * The three checks §3.3 requires per document. Kept as separate booleans
 * rather than one "looks fine" flag because an administrator approving a
 * licence is asserting three different things, and a later audit needs to
 * know which one they got wrong.
 */
export interface DocumentChecklist {
  readonly authentic: boolean;
  readonly current: boolean;
  readonly matchesIdentity: boolean;
}

export interface CredentialDocument {
  readonly id: string;
  readonly kind: DocumentKind;
  /** Null where the platform stores the file without a display name. */
  readonly filename: string | null;
  readonly uploadedAt: string;
  /** ISO date, or null for documents that do not expire. */
  readonly expiresAt: string | null;
  readonly decision: DocumentDecision;
  readonly checklist: DocumentChecklist;
  /** Present once rejected; shown to the doctor. */
  readonly rejectionReason: string | null;
  readonly reviewedBy: string | null;
  readonly reviewedAt: string | null;
  /** Stand-in for the stored file; the preview drawer renders from this. */
  readonly previewLines: readonly string[];
}

export type LoginResult = 'success' | 'failed' | 'blocked';

export interface LoginEvent {
  readonly id: string;
  readonly at: string;
  readonly ip: string;
  readonly device: string;
  readonly location: string;
  readonly result: LoginResult;
  /**
   * Set when this sign-in is geographically impossible given the previous
   * one. Derived at seed time here; a real platform derives it server-side.
   */
  readonly impossibleTravel: boolean;
}

/**
 * Platform actions as counts, never content (§3.3). An administrator
 * auditing a doctor is entitled to know that fourteen records were edited,
 * not what any of them said.
 */
export interface ActivityCounts {
  readonly recordsEdited: number;
  readonly prescriptionsIssued: number;
  readonly labsReviewed: number;
  readonly messagesSent: number;
  readonly windowDays: number;
}

export interface DoctorStatistics {
  readonly patientsServed: number;
  readonly rating: number;
  /** Review counts by star, 1★ first. */
  readonly ratingDistribution: readonly number[];
  readonly avgResponseHours: number;
  readonly monthlyVolume: readonly { readonly label: string; readonly value: number }[];
}

/** The administrative fields §3.3 allows an admin to change, with attribution. */
export interface AdministrativeFields {
  readonly roleTemplate: string;
  readonly clinic: string;
}

export interface AdminAuditEntry {
  readonly id: string;
  readonly at: string;
  readonly actor: string;
  readonly action: string;
  readonly detail: string;
}

export interface DoctorRecord {
  readonly id: string;
  readonly name: string;
  readonly title: string;
  readonly email: string;
  readonly phone: string;
  readonly specialty: string;
  readonly licenseNumber: string;
  readonly languages: readonly string[];
  readonly bio: string;
  readonly joinedAt: string;
  /** Null for an account that has never signed in. */
  readonly lastActiveAt: string | null;
  readonly verification: VerificationStatus;
  /** Present once rejected or when documents were requested. */
  readonly verificationNote: string | null;
  readonly account: AccountStatus;
  readonly suspensionReason: string | null;
  /**
   * Null where the platform keeps no such record — the live API has no
   * role template or clinic assignment for a doctor (FE-10.10).
   */
  readonly administrative: AdministrativeFields | null;
  readonly patientsCount: number;
  readonly appointments30d: number;
  /** Average review score; null for a doctor nobody has rated yet. */
  readonly rating: number | null;
  /**
   * When the medical licence expires, as the roster reports it. Carried on
   * the record rather than read off `documents` because the live roster
   * serves it without the documents, which only the detail carries.
   */
  readonly licenseExpiresAt: string | null;
  /** Empty on a roster row in a live build: the detail carries the documents. */
  readonly documents: readonly CredentialDocument[];
  readonly logins: readonly LoginEvent[];
  /** Null where the platform serves no activity counts for a doctor. */
  readonly activity: ActivityCounts | null;
  /** Null where the platform serves no statistics beyond the roster's. */
  readonly statistics: DoctorStatistics | null;
  /** Every administrative action taken on this doctor, newest first. */
  readonly audit: readonly AdminAuditEntry[];
}

/** An onboarding invitation that has not been accepted yet (§3.2). */
export interface DoctorInvite {
  readonly id: string;
  readonly email: string;
  readonly specialty: string;
  readonly roleTemplate: string;
  readonly invitedAt: string;
  readonly invitedBy: string;
}

/** The sub-tabs above the toolbar. */
export type DoctorTab = 'all' | 'pending' | 'active' | 'suspended';

export type JoinedRangeKey = 'any' | '30d' | '90d' | '365d';

export interface DoctorFilters {
  /** Matches name, email and licence number (§3.2) — no PHI is involved. */
  readonly query: string;
  readonly specialty: string;
  readonly verification: VerificationStatus | 'all';
  readonly account: AccountStatus | 'all';
  readonly joined: JoinedRangeKey;
  /**
   * Narrows to doctors whose medical licence expires inside the overview's
   * 30-day horizon. Seeded from the URL by the ADM-01 action queue, so the
   * count on the overview and the rows here are the same set.
   */
  readonly expiring: boolean;
}
