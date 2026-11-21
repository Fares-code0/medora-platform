/**
 * Patients management — domain types (ADM-04 · UX §3.4).
 *
 * The administrative file on a patient *account*: whether the person can
 * sign in, who holds access to their record, and what their account has
 * been doing. Deliberately not a clinical record — §3.4 is explicit that
 * this screen is "support, access governance, and lifecycle, **not**
 * clinical review", so nothing here carries a diagnosis, a medication or a
 * result. An administrator resolving a locked account has no business
 * reading why the patient was last seen.
 *
 * Ids are the `PT-…` business ids the rest of the app displays, shared with
 * the canonical roster in `shared-domain/patient-identity`, so the admin
 * view and the doctor view are talking about the same people.
 */

/**
 * What the account may do. Distinct from any clinical state: `locked` is a
 * security outcome (failed sign-ins, a support hold) that an administrator
 * can clear, while `inactive` is a deliberate deactivation that needs a
 * decision to reverse.
 */
export type PatientAccountStatus = 'active' | 'inactive' | 'locked';

/** Why an account locked — shown so unlocking is an informed decision. */
export type LockCause = 'failed-sign-ins' | 'support-hold' | 'suspected-compromise';

/**
 * How much of a record an access grant covers. Scope is the whole point of
 * the grid: "this cardiologist can see labs" and "this cardiologist can see
 * everything" are different answers to the question §3.4 asks.
 */
export type AccessScope = 'full-record' | 'summary' | 'labs' | 'prescriptions' | 'appointments';

/** Who holds a grant. Roles mirror the platform's own role vocabulary. */
export type GranteeRole = 'doctor' | 'nurse' | 'laboratory' | 'pharmacy';

export type GrantStatus = 'active' | 'revoked';

/**
 * One entry in the medical-access grid. Revocation keeps the row rather
 * than deleting it: §3.4 requires that "every historical access grant/revoke
 * is listed", and a grid that forgets who used to hold access answers the
 * wrong question during an investigation.
 */
export interface AccessGrant {
  readonly id: string;
  readonly granteeId: string;
  readonly granteeName: string;
  readonly granteeRole: GranteeRole;
  readonly scope: AccessScope;
  readonly grantedBy: string;
  readonly grantedAt: string;
  readonly status: GrantStatus;
  readonly revokedBy: string | null;
  readonly revokedAt: string | null;
  readonly revocationReason: string | null;
}

/** A request for access awaiting an administrator's decision (§3.4). */
export interface AccessRequest {
  readonly id: string;
  readonly requesterId: string;
  readonly requesterName: string;
  readonly requesterRole: GranteeRole;
  readonly scope: AccessScope;
  readonly requestedAt: string;
  /** The clinical justification the requester gave. */
  readonly reason: string;
}

/**
 * Account events only (§3.4): sign-ins, bookings, consent changes, and
 * messages **as counts**. There is no message content here and no way to
 * reach any — the tab is a timeline of what the account did, not of what
 * the patient said.
 */
export type AccountEventKind =
  | 'sign-in'
  | 'sign-in-failed'
  | 'booking-made'
  | 'booking-cancelled'
  | 'messages-sent'
  | 'consent-change'
  | 'credential-reset'
  | 'account-locked'
  | 'account-unlocked'
  | 'account-deactivated'
  | 'account-reactivated'
  | 'access-granted'
  | 'access-revoked';

export interface AccountEvent {
  readonly id: string;
  readonly at: string;
  readonly kind: AccountEventKind;
  readonly detail: string;
  /** Set on aggregate events (`messages-sent`); absent on singular ones. */
  readonly count?: number;
  /** The administrator responsible, for events an administrator caused. */
  readonly actor?: string;
}

/** An open support flag on this account — the §3.4 "open issues" column. */
export type SupportFlagKind = 'billing' | 'access' | 'data-correction' | 'complaint';

export interface SupportFlag {
  readonly id: string;
  readonly kind: SupportFlagKind;
  readonly summary: string;
  readonly openedAt: string;
}

export interface PatientAccount {
  readonly id: string;
  readonly name: string;
  readonly mrn: string;
  readonly email: string;
  readonly phone: string;
  readonly dateOfBirth: string;
  readonly status: PatientAccountStatus;
  /** Present while `locked`; cleared when an administrator unlocks. */
  readonly lockCause: LockCause | null;
  readonly registeredAt: string;
  readonly lastActivityAt: string;
  /** Names of the doctors currently holding a grant, for the list column. */
  readonly assignedDoctors: readonly string[];
  readonly deactivationReason: string | null;
  readonly grants: readonly AccessGrant[];
  readonly accessRequests: readonly AccessRequest[];
  readonly events: readonly AccountEvent[];
  readonly flags: readonly SupportFlag[];
}

export type RegisteredRangeKey = 'any' | '30d' | '90d' | '365d';

/**
 * Activity bands. "Dormant" is the operationally interesting one — an
 * account nobody has used for three months is the one worth a support call.
 */
export type ActivityKey = 'any' | 'recent' | 'quiet' | 'dormant';

export interface PatientFilters {
  /**
   * Matches name, patient id, phone and email (§3.4). Searching a masked
   * table still searches the underlying values — an administrator who knows
   * a phone number can find its row without first revealing anybody's.
   */
  readonly query: string;
  readonly status: PatientAccountStatus | 'all';
  readonly registered: RegisteredRangeKey;
  /** A doctor's name, or `all`. */
  readonly doctor: string;
  readonly activity: ActivityKey;
  /** Narrows to accounts somebody is waiting on — the ADM-01 queue's set. */
  readonly openWork: boolean;
}
