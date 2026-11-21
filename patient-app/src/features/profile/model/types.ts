/**
 * The patient profile.
 *
 * ── AD-2 is undecided, and this file is shaped by that ───────────────
 *
 * "Which fields may a patient edit?" is an open architecture decision
 * (audit AD-2). `patients.phone`, `address` and insurance details are all
 * edited by clinicians today, and a patient editing them concurrently is
 * a conflict nobody has adjudicated.
 *
 * So `ProfileField` carries an explicit `editable` flag **supplied by the
 * server**, and the UI renders a non-editable field as visibly read-only
 * with a note on who to contact. The alternative — guessing which fields
 * a patient owns and offering an edit that 403s on submit — is a worse
 * experience than an honest read-only row, and it is also a client
 * deciding an authorization question, which T-07 forbids.
 *
 * The audit's recommendation, if AD-2 is decided as proposed, is: the
 * patient owns contact details and preferences; clinical fields stay
 * clinician-owned; conflicts resolve clinician-wins with an audit row.
 * The shape below is ready for exactly that and does not assume it.
 */

export type ProfileFieldId =
  'fullName' | 'email' | 'phone' | 'address' | 'dateOfBirth' | 'bloodType';

export interface ProfileField {
  readonly id: ProfileFieldId;
  readonly label: string;
  readonly value: string | null;
  /** Server-supplied. The client never decides this (AD-2, T-07). */
  readonly editable: boolean;
  /** Shown under a read-only field: who to ask. */
  readonly ownedBy: string;
}

export interface PatientProfile {
  readonly displayName: string;
  readonly photoUrl: string | null;
  readonly fields: readonly ProfileField[];
  /**
   * Whether this account is linked to a clinical record. Deliberately a
   * boolean and not an MRN: the link exists or it does not, and showing
   * a record number on a profile screen is an identifier on a lock
   * screen preview for no benefit.
   */
  readonly linkedToClinicalRecord: boolean;
}

export interface ActiveSession {
  readonly id: string;
  /**
   * What the device calls itself, as the server knows it — `null` when
   * it does not know.
   *
   * Nullable because `sessions.device` and `sessions.browser` are both
   * nullable columns and a session can carry neither. The alternative
   * was for the HTTP adapter to substitute a name, and the only name it
   * could substitute is an English one written in the transport layer —
   * the C-09 defect this tree has found four times. So the absence
   * travels, and `SecurityScreen` names it in the patient's language.
   */
  readonly deviceLabel: string | null;
  readonly lastSeenAt: string;
  readonly current: boolean;
}

/**
 * Where a privacy request has got to — checklist P-09, P-10.
 *
 * Both requests are **asynchronous and server-owned**, which is why this
 * is a status rather than a result. An export is a job that produces a
 * file some minutes later; a deactivation is a request a human at the
 * clinic acts on. Neither finishes while the patient is looking at the
 * screen, and a screen that implied otherwise would be lying about the
 * one operation people most want a receipt for.
 *
 * `none` is not "no request has ever been made" in general — it is what
 * the server says about the current one. The client never infers it.
 */
export type PrivacyRequestStatus = 'none' | 'pending' | 'ready' | 'refused';

export interface PrivacyRequest {
  readonly status: PrivacyRequestStatus;
  /** When the patient asked. `null` while `none`. */
  readonly requestedAt: string | null;
}

export interface PrivacyState {
  /** P-09. `ready` means the notification has been sent, not that a file is here. */
  readonly export: PrivacyRequest;
  /** P-10. Never a deletion — see `PrivacyScreen`. */
  readonly deactivation: PrivacyRequest;
}

export interface ProfileService {
  get(): Promise<PatientProfile>;
  update(values: Partial<Record<ProfileFieldId, string>>): Promise<PatientProfile>;
  listSessions(): Promise<readonly ActiveSession[]>;
  revokeSession(id: string): Promise<void>;

  /**
   * The two privacy requests (P-09, P-10). Read together because the
   * screen shows them together, and because one request each is all the
   * row allows — a patient with an export already running is told so
   * rather than offered a second one.
   */
  getPrivacyState(): Promise<PrivacyState>;
  requestDataExport(): Promise<PrivacyState>;
  requestDeactivation(): Promise<PrivacyState>;
}
