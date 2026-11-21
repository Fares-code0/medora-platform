import type {
  AccountSettings,
  IntegrationId,
  PrivacySettings,
  SecuritySettings,
  SettingsDocument,
  VerificationDocument,
  VerificationDocumentKind,
  WorkflowPreferences,
} from './types';

/**
 * The settings port — `api/seam.ts`'s pattern, one feature, one port.
 *
 * Two adapters: the session mock over a per-user browser document, and the
 * HTTP adapter (FE-10.9) over the account, password, two-factor, session,
 * device, login-history and activity routes (`/me/*`, API §2–§3), plus the
 * Settings Center (`/me/settings`, RM M22 — `backend` only) for privacy
 * consents and integrations. Whether a given server keeps those two is a
 * property of the answer, not of the adapter, so it travels on the document
 * (`settingsCenter`). What the client cannot do at all is declared in
 * `capabilities`. Workflow preferences — this browser's landing page and
 * formats — stay in the browser in both modes.
 */

/**
 * Rejects `updatePrivacy` when the server's settings changed since this
 * client read them (409 — RM M22.2's optimistic concurrency). Its own class
 * so the Privacy section can say "changed elsewhere, reloaded" rather than
 * "try again", which would only fail the same way.
 */
export class SettingsConflictError extends Error {
  constructor() {
    super('Settings changed since they were loaded');
    this.name = 'SettingsConflictError';
  }
}

/**
 * Rejects `changePassword` when the current password does not match. Its own
 * class rather than a code, because the Account section binds it to the
 * *current password field* specifically — a generic failure would mark the
 * whole form invalid and leave the doctor guessing which of three fields the
 * server disliked.
 */
export class CurrentPasswordError extends Error {
  constructor() {
    super('Current password is incorrect');
    this.name = 'CurrentPasswordError';
  }
}

/**
 * Rejects `submitVerificationDocument` with words a doctor can act on — the
 * server's own where it gave some (a refused file type or size), and a plain
 * statement where the cause is the deployment's (no file storage connected)
 * or the account's (no practitioner profile). Its own class, declared on the
 * port, so the section shows `message` whichever adapter threw it; any other
 * rejection is a failure to retry.
 */
export class VerificationSubmitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VerificationSubmitError';
  }
}

export interface SubmitVerificationDocumentInput {
  /** The bytes, uploaded first as `kind=verification_document`. */
  readonly file: File;
  readonly kind: VerificationDocumentKind;
  /** `YYYY-MM-DD`, or `null` when the document states no expiry. */
  readonly expiresOn: string | null;
}

export interface ChangePasswordInput {
  readonly current: string;
  readonly next: string;
}

export interface ToggleIntegrationInput {
  readonly id: IntegrationId;
  readonly connect: boolean;
  /**
   * The account to show as linked; `null` on disconnect, and on a connect
   * where the provider names it (a real OAuth flow; the demo adapter
   * simulates one).
   */
  readonly account: string | null;
}

export interface SettingsService {
  fetchSettings(userId: string): Promise<SettingsDocument>;

  /**
   * Every mutation below answers the **whole patched document**, never void
   * and never the section it touched. Two reasons, and the second is the one
   * that would bite: the query layer writes the answer straight into the
   * cache rather than refetching, and every write also appends to the
   * activity log — so a method that answered only its own section would
   * leave the Activity section stale until something else happened to
   * refetch it.
   */

  /**
   * Records that the profile was saved. The profile itself lives on
   * `DoctorProfileProvider`, not in this document — this method exists so
   * that saving it still reaches the activity log, which is why it takes no
   * patch.
   */
  recordProfileUpdate(userId: string): Promise<SettingsDocument>;

  saveAccount(
    userId: string,
    account: Pick<AccountSettings, 'email' | 'username' | 'phone'>,
  ): Promise<SettingsDocument>;
  /** Rejects with {@link CurrentPasswordError} when `current` does not match. */
  changePassword(userId: string, input: ChangePasswordInput): Promise<SettingsDocument>;

  updateSecurity(
    userId: string,
    patch: Partial<Pick<SecuritySettings, 'twoFactorEnabled'>>,
  ): Promise<SettingsDocument>;
  revokeSession(userId: string, sessionId: string): Promise<SettingsDocument>;
  revokeOtherSessions(userId: string): Promise<SettingsDocument>;
  removeTrustedDevice(userId: string, deviceId: string): Promise<SettingsDocument>;

  /** Rejects with {@link SettingsConflictError} when the server's copy moved on. */
  updatePrivacy(userId: string, privacy: PrivacySettings): Promise<SettingsDocument>;
  saveWorkflow(userId: string, workflow: WorkflowPreferences): Promise<SettingsDocument>;
  toggleIntegration(userId: string, input: ToggleIntegrationInput): Promise<SettingsDocument>;

  /* ── Two-factor enrolment (live) ───────────────────────────── */
  /**
   * Starts enrolment with the account's current password (owner decision
   * D2): the server checks it against the sign-in guess budget and only
   * then mints a secret the authenticator app is given. Nothing is switched
   * on until `enableTwoFactor` proves the app produces codes for it.
   */
  beginTwoFactorSetup(userId: string, password: string): Promise<TwoFactorEnrolment>;
  /** Turns two-factor on with a code from the app; a wrong code is refused. */
  enableTwoFactor(userId: string, code: string): Promise<SettingsDocument>;
  /** Turns it off with the account password; the server ends every other session. */
  disableTwoFactor(userId: string, password: string): Promise<SettingsDocument>;

  /**
   * Replaces the authenticator (owner decision Q7 / R4), step 1 of 2:
   * `POST /me/2fa/reenroll` with the current password and a code from the
   * **current** app. Returns the new secret; nothing changes yet, and the
   * old factor and recovery codes keep working until step 2.
   */
  beginTwoFactorReenrollment(
    userId: string,
    input: { readonly password: string; readonly code: string },
  ): Promise<TwoFactorReenrollment>;
  /**
   * Step 2 of 2: `POST /me/2fa/reenroll/confirm` with a code from the
   * **new** app. Only now are the factor and the recovery codes replaced;
   * the new codes are returned here, once.
   */
  confirmTwoFactorReenrollment(
    userId: string,
    input: { readonly enrolmentToken: string; readonly code: string },
  ): Promise<readonly string[]>;

  /* ── Verification documents (NEW-46, API §3.6a) ───────────── */
  /** The doctor's filed documents, newest first, each with its decision. */
  listVerificationDocuments(userId: string): Promise<readonly VerificationDocument[]>;
  /**
   * Uploads the file and files it for review: answers the filed document,
   * `pending` until an administrator decides. Rejects with
   * {@link VerificationSubmitError} when the server refused it for a reason
   * the doctor should read.
   */
  submitVerificationDocument(
    userId: string,
    input: SubmitVerificationDocumentInput,
  ): Promise<VerificationDocument>;

  readonly capabilities: SettingsServiceCapabilities;
}

export interface TwoFactorEnrolment {
  /** Base32, for an app that cannot scan. */
  readonly secret: string;
  /** `otpauth://totp/…` — what an authenticator app is given. */
  readonly otpauthUrl: string;
  /** Shown once; each signs in instead of a code if the phone is lost. */
  readonly recoveryCodes: readonly string[];
}

export interface TwoFactorReenrollment {
  /** Base32, for an app that cannot scan. */
  readonly secret: string;
  readonly otpauthUrl: string;
  /** Binds step 2 to this session and to the factor being replaced. */
  readonly enrolmentToken: string;
}

export interface SettingsServiceCapabilities {
  /**
   * `true`: two-factor is switched on through enrolment (secret, then a
   * code) and off with the password — the server's flow. `false`: the
   * mock's simple toggle.
   */
  readonly twoFactorEnrolment: boolean;
  /** Whether the sign-in email can be changed here. */
  readonly emailEditable: boolean;
  /**
   * Whether Connect can be offered for an integration. Live it cannot: the
   * server's connect route answers 501 until an OAuth client is configured
   * per provider (RA-M22.1), so a button would only ever fail. Disconnect is
   * always offered for a connected one.
   */
  readonly integrationConnect: boolean;
  /**
   * Whether "Delete my account" exists. No route deletes an account on any
   * branch; the demo's dialog says it removes nothing.
   */
  readonly accountDeletion: boolean;
}
