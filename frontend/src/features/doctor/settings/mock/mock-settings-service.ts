import {
  CurrentPasswordError,
  VerificationSubmitError,
  type ChangePasswordInput,
  type SettingsService,
  type SubmitVerificationDocumentInput,
  type TwoFactorEnrolment,
  type ToggleIntegrationInput,
} from '../model/settings-service';
import { localId, readSettings, writeSettings } from '../model/store';
import type {
  AccountSettings,
  ActivityEntry,
  ActivityKind,
  IntegrationId,
  PrivacySettings,
  SecuritySettings,
  SettingsDocument,
  VerificationDocument,
  WorkflowPreferences,
} from '../model/types';

/**
 * Mock settings service — Promise-based seams shaped like the future
 * account API so TanStack Query swaps transports without touching hooks
 * or components. Every mutation persists through the per-user store and
 * appends an entry to the activity log, so the Activity section is a real
 * reflection of what happened this session. `userId` is threaded through
 * because the document is namespaced per account (auth wipes it on
 * logout). No PHI — this is the doctor's own account only.
 */

const LATENCY_MS = 320;

function delay(ms: number = LATENCY_MS): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchSettings(userId: string): Promise<SettingsDocument> {
  await delay();
  return readSettings(userId);
}

function logActivity(
  document: SettingsDocument,
  kind: ActivityKind,
  summary: string,
  detail: string | null,
): readonly ActivityEntry[] {
  const entry: ActivityEntry = {
    id: localId('act'),
    at: new Date().toISOString(),
    kind,
    summary,
    detail,
  };
  // Newest first; keep the log bounded so it never balloons.
  return [entry, ...document.activity].slice(0, 25);
}

interface Mutation {
  readonly patch: (document: SettingsDocument) => SettingsDocument;
  readonly activity: {
    readonly kind: ActivityKind;
    readonly summary: string;
    readonly detail: string | null;
  };
}

function commit(userId: string, mutation: Mutation): SettingsDocument {
  const current = readSettings(userId);
  const patched = mutation.patch(current);
  const next: SettingsDocument = {
    ...patched,
    activity: logActivity(
      patched,
      mutation.activity.kind,
      mutation.activity.summary,
      mutation.activity.detail,
    ),
  };
  writeSettings(userId, next);
  return next;
}

/* ── Profile ────────────────────────────────────────────────────── */

/**
 * The profile itself is owned by the app-level DoctorProfileProvider (the
 * single source of truth). This only records the activity-log entry so the
 * Activity section still reflects the change.
 */
async function recordProfileUpdate(userId: string): Promise<SettingsDocument> {
  await delay();
  return commit(userId, {
    patch: (document) => document,
    activity: { kind: 'profile', summary: 'Profile updated', detail: null },
  });
}

/* ── Account ────────────────────────────────────────────────────── */

async function saveAccount(
  userId: string,
  account: Pick<AccountSettings, 'email' | 'username' | 'phone'>,
): Promise<SettingsDocument> {
  await delay();
  return commit(userId, {
    patch: (document) => ({ ...document, account: { ...document.account, ...account } }),
    activity: { kind: 'settings', summary: 'Account details updated', detail: null },
  });
}

async function changePassword(
  userId: string,
  input: ChangePasswordInput,
): Promise<SettingsDocument> {
  await delay(420);
  const document = readSettings(userId);
  if (input.current !== document.account.mockPassword) {
    throw new CurrentPasswordError();
  }
  return commit(userId, {
    patch: (current) => ({
      ...current,
      account: {
        ...current.account,
        mockPassword: input.next,
        passwordUpdatedAt: new Date().toISOString(),
      },
    }),
    activity: { kind: 'password', summary: 'Password changed', detail: null },
  });
}

/* ── Security ───────────────────────────────────────────────────── */

async function updateSecurity(
  userId: string,
  patch: Partial<Pick<SecuritySettings, 'twoFactorEnabled'>>,
): Promise<SettingsDocument> {
  await delay();
  const enabling = patch.twoFactorEnabled === true;
  return commit(userId, {
    patch: (document) => ({ ...document, security: { ...document.security, ...patch } }),
    activity: {
      kind: 'security',
      summary:
        patch.twoFactorEnabled === undefined
          ? 'Security settings updated'
          : `Two-factor authentication ${enabling ? 'enabled' : 'disabled'}`,
      detail: null,
    },
  });
}

async function revokeSession(userId: string, sessionId: string): Promise<SettingsDocument> {
  await delay();
  return commit(userId, {
    patch: (document) => ({
      ...document,
      security: {
        ...document.security,
        activeSessions: document.security.activeSessions.filter(
          (session) => session.id !== sessionId,
        ),
      },
    }),
    activity: { kind: 'security', summary: 'Session revoked', detail: null },
  });
}

async function revokeOtherSessions(userId: string): Promise<SettingsDocument> {
  await delay();
  return commit(userId, {
    patch: (document) => ({
      ...document,
      security: {
        ...document.security,
        activeSessions: document.security.activeSessions.filter((session) => session.current),
      },
    }),
    activity: {
      kind: 'security',
      summary: 'Signed out of all other sessions',
      detail: null,
    },
  });
}

async function removeTrustedDevice(userId: string, deviceId: string): Promise<SettingsDocument> {
  await delay();
  return commit(userId, {
    patch: (document) => ({
      ...document,
      security: {
        ...document.security,
        trustedDevices: document.security.trustedDevices.filter((device) => device.id !== deviceId),
      },
    }),
    activity: { kind: 'security', summary: 'Trusted device removed', detail: null },
  });
}

/* ── Privacy ────────────────────────────────────────────────────── */

async function updatePrivacy(userId: string, privacy: PrivacySettings): Promise<SettingsDocument> {
  await delay();
  return commit(userId, {
    patch: (document) => ({ ...document, privacy }),
    activity: { kind: 'privacy', summary: 'Privacy preferences updated', detail: null },
  });
}

/* ── Workflow preferences ───────────────────────────────────────── */

async function saveWorkflow(
  userId: string,
  workflow: WorkflowPreferences,
): Promise<SettingsDocument> {
  await delay();
  return commit(userId, {
    patch: (document) => ({ ...document, workflow }),
    activity: { kind: 'settings', summary: 'Workflow preferences updated', detail: null },
  });
}

/* ── Integrations ───────────────────────────────────────────────── */

/** The account each demo integration "links" — the demo's stand-in for an OAuth reply. */
const DEMO_INTEGRATION_ACCOUNTS: Record<IntegrationId, string> = {
  'google-calendar': 'amelia.chen@gmail.com',
  outlook: 'a.chen@medora.health',
  zoom: 'amelia.chen@medora.health',
  teams: 'a.chen@medora.health',
};

async function toggleIntegration(
  userId: string,
  input: ToggleIntegrationInput,
): Promise<SettingsDocument> {
  await delay(280);
  return commit(userId, {
    patch: (document) => ({
      ...document,
      integrations: document.integrations.map((integration) =>
        integration.id === input.id
          ? {
              ...integration,
              connected: input.connect,
              connectedAt: input.connect ? new Date().toISOString() : null,
              account: input.connect
                ? (input.account ?? DEMO_INTEGRATION_ACCOUNTS[input.id] ?? null)
                : null,
            }
          : integration,
      ),
    }),
    activity: {
      kind: 'integration',
      summary: `${input.connect ? 'Connected' : 'Disconnected'} an integration`,
      detail: input.id,
    },
  });
}

/* ── Verification documents (NEW-46) ────────────────────────────── */

/**
 * The demo's filed documents, per user, newest first. Kept in memory for the
 * session — there is no reviewer in the demo to decide on them, so each
 * stays `pending` — and the type and size rules are the server's
 * (`file-policy.ts`, `verification_document`), so the demo refuses what the
 * server would.
 */
const verificationDocuments = new Map<string, readonly VerificationDocument[]>();
const VERIFICATION_TYPES: readonly string[] = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];
const VERIFICATION_MAX_BYTES = 10 * 1024 * 1024;

async function listVerificationDocuments(userId: string): Promise<readonly VerificationDocument[]> {
  await delay();
  return verificationDocuments.get(userId) ?? [];
}

async function submitVerificationDocument(
  userId: string,
  { file, kind, expiresOn }: SubmitVerificationDocumentInput,
): Promise<VerificationDocument> {
  await delay(420);
  if (!VERIFICATION_TYPES.includes(file.type)) {
    throw new VerificationSubmitError(
      `${file.type === '' ? 'This file type' : file.type} is not accepted for verification_document`,
    );
  }
  if (file.size > VERIFICATION_MAX_BYTES) {
    throw new VerificationSubmitError('The file is larger than 10 MB.');
  }
  const document: VerificationDocument = {
    id: localId('vdoc'),
    kind,
    fileId: localId('file'),
    uploadedAt: new Date().toISOString(),
    expiresOn: expiresOn === null ? null : `${expiresOn}T00:00:00`,
    decision: 'pending',
    decidedAt: null,
    rejectReason: null,
    checks: { authentic: false, current: false, identityMatch: false },
  };
  verificationDocuments.set(userId, [document, ...(verificationDocuments.get(userId) ?? [])]);
  return document;
}

/**
 * The mock adapter. Reached only through `features/doctor/settings/service.ts`
 * (`docs/handoff/auth-seam.md` §1, rule 3) — nothing downstream may import
 * this module, and `service.test.ts` asserts it over the source tree because
 * a type alone does not keep a seam closed.
 */
/** The demo's enrolment, for completeness of the port: the demo screens use the toggle. */
async function beginTwoFactorSetup(): Promise<TwoFactorEnrolment> {
  await delay();
  return {
    secret: 'DEMO DEMO DEMO DEMO',
    otpauthUrl: 'otpauth://totp/Medora:demo?secret=DEMODEMODEMODEMO&issuer=Medora',
    recoveryCodes: [],
  };
}

export const mockSettingsService: SettingsService = {
  capabilities: {
    twoFactorEnrolment: false,
    emailEditable: true,
    integrationConnect: true,
    accountDeletion: true,
  },
  fetchSettings,
  recordProfileUpdate,
  saveAccount,
  changePassword,
  updateSecurity,
  revokeSession,
  revokeOtherSessions,
  removeTrustedDevice,
  updatePrivacy,
  saveWorkflow,
  toggleIntegration,
  beginTwoFactorSetup,
  enableTwoFactor: (userId) => updateSecurity(userId, { twoFactorEnabled: true }),
  disableTwoFactor: (userId) => updateSecurity(userId, { twoFactorEnabled: false }),
  // The demo has no authenticator to replace: `twoFactorEnrolment` is off,
  // so the screens never offer it. Refused rather than faked if called.
  beginTwoFactorReenrollment: () =>
    Promise.reject(new Error('The demo has no authenticator to replace')),
  confirmTwoFactorReenrollment: () =>
    Promise.reject(new Error('The demo has no authenticator to replace')),
  listVerificationDocuments,
  submitVerificationDocument,
};
