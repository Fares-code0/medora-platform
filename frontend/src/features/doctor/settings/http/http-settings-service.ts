import { apiClient, UPLOAD_TIMEOUT_MS } from '@/api/client';
import {
  asRecord,
  malformedResponse,
  notConnected,
  readArray,
  readBoolean,
  readData,
  readEnum,
  readOptionalDay,
  readOptionalString,
  readPage,
  readString,
} from '@/api/http';
import { isApiError, type ApiError } from '@/types/api';

import { DEFAULT_PRIVACY } from '../model/defaults';
import {
  CurrentPasswordError,
  SettingsConflictError,
  VerificationSubmitError,
  type SettingsService,
  type SubmitVerificationDocumentInput,
  type TwoFactorEnrolment,
  type TwoFactorReenrollment,
} from '../model/settings-service';
import { liveWorkflowStore } from '../model/store';
import {
  VERIFICATION_DOCUMENT_KINDS,
  type ActiveSession,
  type ActivityEntry,
  type ActivityKind,
  type IntegrationId,
  type IntegrationState,
  type LoginEvent,
  type PrivacySettings,
  type SettingsCenterState,
  type SettingsDocument,
  type TrustedDevice,
  type VerificationDecision,
  type VerificationDocument,
} from '../model/types';

/**
 * Account settings over HTTP (FE-10.9) — the `/me/*` routes, API §2–§3.
 *
 * | Section   | Read                                         | Write                              |
 * | --------- | -------------------------------------------- | ---------------------------------- |
 * | Account   | `GET /me/account`                            | `PATCH /me/account` (username, phone) |
 * | Password  | —                                            | `POST /me/password`                |
 * | Two-factor| `twoFactorEnabled` on the account; `GET /me/2fa` | `POST /me/2fa/setup · enable · disable · reenroll · reenroll/confirm` |
 * | Sessions  | `GET /me/sessions`                           | `DELETE …/{id}` · `POST …/revoke-others` |
 * | Devices   | `GET /me/devices`                            | `DELETE /me/devices/{id}`          |
 * | History   | `GET /me/login-history` (most recent page)   | —                                  |
 * | Activity  | `GET /me/activity` (most recent page)        | —                                  |
 * | Privacy   | `GET /me/settings` → `privacy`               | `PATCH /me/settings/privacy` `{ updatedAt, value }` |
 * | Integrations | `GET /me/settings` → `integrations`       | `POST /me/integrations/{id}/disconnect` |
 * | Verification | `GET /me/verification-documents`          | `POST /files` then `POST /me/verification-documents` |
 *
 * Every write answers the **refetched** document: the server writes the
 * activity entry itself, and a client-side guess at it would be a second,
 * disagreeing log.
 *
 * **The Settings Center (RM M22) is served only by an API built from
 * `backend`.** It is read beside the `/me/*` routes but cannot fail them: a
 * 404 — what `main` answers — makes the document `settingsCenter:
 * 'unserved'` and the two sections say "not connected yet"; any other
 * failure makes it `'failed'` and only those two offer Retry. In both cases
 * the `privacy`/`integrations` slots carry defaults for the type and the
 * screens do not render them. Connect is not offered (`capabilities`): the
 * server answers 501 until an OAuth client exists for the provider. Workflow
 * preferences are this browser's (`liveWorkflowStore`), in both modes —
 * the server's `preferences` slice is not read, so a device keeps its own.
 */

const RECENT = 50;
const PLATFORMS: readonly TrustedDevice['platform'][] = [
  'windows',
  'mac',
  'ios',
  'android',
  'desktop',
  'mobile',
  'tablet',
];
const ACTIVITY_KINDS: readonly ActivityKind[] = [
  'profile',
  'password',
  'login',
  'settings',
  'security',
  'integration',
  'privacy',
];

function toSession(value: unknown): ActiveSession {
  const what = 'session';
  const dto = asRecord(value, what);
  return {
    id: readString(dto, 'id', what),
    device: readOptionalString(dto, 'device', what) ?? 'Unknown device',
    browser: readOptionalString(dto, 'browser', what) ?? '—',
    location: readOptionalString(dto, 'location', what) ?? 'Location unknown',
    ipAddress: readOptionalString(dto, 'ipAddress', what) ?? '—',
    startedAt: readString(dto, 'startedAt', what),
    current: readBoolean(dto, 'current', what),
  };
}

function toDevice(value: unknown): TrustedDevice {
  const what = 'device';
  const dto = asRecord(value, what);
  const addedAt = readString(dto, 'addedAt', what);
  return {
    id: readString(dto, 'id', what),
    name: readString(dto, 'name', what),
    platform: readEnum(dto, 'platform', PLATFORMS, what),
    addedAt,
    // Never seen since it was trusted: the moment it was trusted is the last sighting.
    lastSeenAt: readOptionalString(dto, 'lastSeenAt', what) ?? addedAt,
    current: readBoolean(dto, 'current', what),
  };
}

function toLoginEvent(value: unknown): LoginEvent {
  const what = 'login event';
  const dto = asRecord(value, what);
  return {
    id: readString(dto, 'id', what),
    at: readString(dto, 'at', what),
    device: readOptionalString(dto, 'device', what) ?? 'Unknown device',
    location: readOptionalString(dto, 'location', what) ?? 'Location unknown',
    status: readEnum(dto, 'status', ['success', 'failed'] as const, what),
  };
}

function toActivity(value: unknown): ActivityEntry {
  const what = 'activity';
  const dto = asRecord(value, what);
  return {
    id: readString(dto, 'id', what),
    at: readString(dto, 'at', what),
    kind: readEnum(dto, 'kind', ACTIVITY_KINDS, what),
    summary: readString(dto, 'summary', what),
    detail: readOptionalString(dto, 'detail', what),
  };
}

const INTEGRATION_IDS: readonly IntegrationId[] = ['google-calendar', 'outlook', 'zoom', 'teams'];

interface SettingsCenter {
  readonly updatedAt: string;
  readonly privacy: PrivacySettings;
  readonly integrations: readonly IntegrationState[];
}

function toSettingsCenter(body: unknown): SettingsCenter {
  const what = 'settings';
  const dto = asRecord(readData(body, what), what);
  const privacy = asRecord(dto.privacy, `${what}.privacy`);
  return {
    updatedAt: readString(dto, 'updatedAt', what),
    privacy: {
      dataSharing: readBoolean(privacy, 'dataSharing', what),
      analytics: readBoolean(privacy, 'analytics', what),
      cookies: readBoolean(privacy, 'cookies', what),
      aiDataUsage: readBoolean(privacy, 'aiDataUsage', what),
    },
    integrations: readArray(dto, 'integrations', what).map((value) => {
      const row = asRecord(value, `${what}.integration`);
      return {
        id: readEnum(row, 'id', INTEGRATION_IDS, what),
        connected: readBoolean(row, 'connected', what),
        connectedAt: readOptionalString(row, 'connectedAt', what),
        account: readOptionalString(row, 'account', what),
      };
    }),
  };
}

/**
 * The `updatedAt` each user's Settings Center was last read at — what a
 * privacy write must send back (RM M22.2). Kept here rather than on the
 * port: it is a property of this transport, and the cache always holds the
 * document of the latest read, so this is the version the screen shows.
 */
const settingsVersions = new Map<string, string>();

async function loadSettingsCenter(
  userId: string,
): Promise<{ readonly state: SettingsCenterState; readonly center: SettingsCenter | null }> {
  try {
    const center = toSettingsCenter(await apiClient.get('/me/settings'));
    settingsVersions.set(userId, center.updatedAt);
    return { state: 'served', center };
  } catch (error) {
    settingsVersions.delete(userId);
    if (isApiError(error) && error.kind === 'not_found') return { state: 'unserved', center: null };
    return { state: 'failed', center: null };
  }
}

/**
 * `GET /me/2fa` → `recoveryCodesRemaining` (owner decision R2), served only
 * by an API built from `backend` (`8992a208`). It cannot fail the document:
 * a 404 (what `main` answers) or any other failure is `null`, which the
 * Security section reads as "not known" and offers no re-enrolment for.
 */
async function loadRecoveryCodesRemaining(): Promise<number | null> {
  try {
    const dto = asRecord(readData(await apiClient.get('/me/2fa'), 'two-factor'), 'two-factor');
    const remaining = dto.recoveryCodesRemaining;
    return typeof remaining === 'number' && Number.isInteger(remaining) && remaining >= 0
      ? remaining
      : null;
  } catch {
    return null;
  }
}

function readStrings(dto: Record<string, unknown>, key: string, what: string): string[] {
  return readArray(dto, key, what).map((value) => {
    if (typeof value !== 'string') throw malformedResponse(`${what}.${key}`);
    return value;
  });
}

function list(value: unknown, what: string): readonly unknown[] {
  const data = readData(value, what);
  if (!Array.isArray(data)) throw malformedResponse(what);
  return data as readonly unknown[];
}

/* ── Verification documents (NEW-46, API §3.6a) ─────────────────── */

const DECISIONS: readonly VerificationDecision[] = ['pending', 'approved', 'rejected'];

/**
 * One filed document, read strictly: a `kind` or `decision` outside the
 * vocabulary fails the read rather than being shown as something it is not.
 */
function toVerificationDocument(value: unknown): VerificationDocument {
  const what = 'verification document';
  const dto = asRecord(value, what);
  const checks = asRecord(dto.checks, `${what}.checks`);
  return {
    id: readString(dto, 'id', what),
    kind: readEnum(dto, 'kind', VERIFICATION_DOCUMENT_KINDS, what),
    fileId: readString(dto, 'fileId', what),
    uploadedAt: readString(dto, 'uploadedAt', what),
    expiresOn: readOptionalDay(dto, 'expiresOn', what),
    decision: readEnum(dto, 'decision', DECISIONS, what),
    decidedAt: readOptionalString(dto, 'decidedAt', what),
    rejectReason: readOptionalString(dto, 'rejectReason', what),
    checks: {
      authentic: readBoolean(checks, 'authentic', `${what}.checks`),
      current: readBoolean(checks, 'current', `${what}.checks`),
      identityMatch: readBoolean(checks, 'identityMatch', `${what}.checks`),
    },
  };
}

function isStorageUnavailable(error: ApiError): boolean {
  return (
    error.code === 'service_unavailable' || (error.kind === 'server' && error.ref === 'HTTP-503')
  );
}

/** The server's first field message — on `field` if it named one, else any. */
function firstFieldError(error: ApiError, field: string): string | undefined {
  if (error.kind !== 'validation') return undefined;
  return error.fieldErrors[field]?.[0] ?? Object.values(error.fieldErrors)[0]?.[0];
}

export const VERIFICATION_STORAGE_UNAVAILABLE =
  'No file storage is connected to this deployment, so documents cannot be uploaded yet.';

/**
 * Step 1: the bytes, through `POST /files` as `kind=verification_document`
 * (API §17.1). The type and size rules are the server's (`file-policy.ts`:
 * PDF or image, up to 10 MB), so its words are shown and nothing is
 * pre-checked here.
 */
async function uploadVerificationFile(file: File): Promise<string> {
  const form = new FormData();
  // The kind first: the server reads text parts that precede the file.
  form.append('kind', 'verification_document');
  form.append('file', file, file.name);
  try {
    const what = 'uploaded file';
    return readString(
      asRecord(
        readData(await apiClient.post('/files', form, { timeoutMs: UPLOAD_TIMEOUT_MS }), what),
        what,
      ),
      'id',
      what,
    );
  } catch (error) {
    if (!isApiError(error)) throw error;
    if (isStorageUnavailable(error))
      throw new VerificationSubmitError(VERIFICATION_STORAGE_UNAVAILABLE);
    if (error.kind === 'validation') {
      throw new VerificationSubmitError(
        firstFieldError(error, 'file') ?? 'The server did not accept this file.',
      );
    }
    if (error.kind === 'server' && error.ref === 'HTTP-413') {
      throw new VerificationSubmitError('The file is larger than the server accepts.');
    }
    throw error;
  }
}

const NOT_FILED = 'The file was uploaded but could not be filed for review.';

/**
 * Discards an upload whose filing failed (`DELETE /files/:id`, API §17.3).
 * The server's orphan sweep collects only soft-deleted files, so an unfiled
 * upload left alone would stay in storage for good. Best effort: the filing
 * failure is what the doctor needs to read, so a failed cleanup never
 * replaces it. A filed upload is refused by the server (409), never deleted.
 */
async function discardUpload(fileId: string): Promise<void> {
  try {
    await apiClient.delete(`/files/${fileId}`);
  } catch {
    // Nothing to tell the doctor; the filing error below is the message.
  }
}

/**
 * Step 2: file the upload (`POST /me/verification-documents`). A stored
 * file that was not filed is never reported as submitted, and is
 * discarded rather than left in storage.
 */
async function submitVerificationDocument(
  _userId: string,
  { file, kind, expiresOn }: SubmitVerificationDocumentInput,
): Promise<VerificationDocument> {
  const fileId = await uploadVerificationFile(file);
  try {
    const body = await apiClient.post('/me/verification-documents', {
      fileId,
      kind,
      ...(expiresOn === null ? {} : { expiresOn }),
    });
    return toVerificationDocument(readData(body, 'verification document'));
  } catch (error) {
    await discardUpload(fileId);
    if (!isApiError(error)) throw error;
    if (error.kind === 'validation') {
      const words = firstFieldError(error, 'fileId');
      throw new VerificationSubmitError(words === undefined ? NOT_FILED : `${NOT_FILED} ${words}`);
    }
    if (error.kind === 'conflict') {
      throw new VerificationSubmitError('This upload has already been filed.');
    }
    if (error.kind === 'not_found') {
      throw new VerificationSubmitError(
        'Only a practitioner account can submit verification documents.',
      );
    }
    throw error;
  }
}

async function fetchDocument(userId: string): Promise<SettingsDocument> {
  const settingsCenter = loadSettingsCenter(userId);
  const recoveryCodesRemaining = loadRecoveryCodesRemaining();
  const [account, sessions, devices, history, activity] = await Promise.all([
    apiClient.get('/me/account'),
    apiClient.get('/me/sessions'),
    apiClient.get('/me/devices'),
    apiClient.get('/me/login-history', { page: 1, pageSize: RECENT }),
    apiClient.get('/me/activity', { page: 1, pageSize: RECENT }),
  ]);
  const dto = asRecord(readData(account, 'account'), 'account');
  const { state, center } = await settingsCenter;

  return {
    account: {
      email: readString(dto, 'email', 'account'),
      username: readOptionalString(dto, 'username', 'account') ?? '',
      phone: readString(dto, 'phone', 'account'),
      passwordUpdatedAt: readString(dto, 'passwordUpdatedAt', 'account'),
      // The demo's comparison value; the server never discloses a password.
      mockPassword: '',
    },
    security: {
      twoFactorEnabled: readBoolean(dto, 'twoFactorEnabled', 'account'),
      recoveryCodesRemaining: await recoveryCodesRemaining,
      activeSessions: list(sessions, 'sessions').map(toSession),
      trustedDevices: list(devices, 'devices').map(toDevice),
      loginHistory: readPage(history, 'login history').items.map(toLoginEvent),
    },
    // Without the Settings Center (see the header): carried for the type,
    // never rendered.
    privacy: center?.privacy ?? DEFAULT_PRIVACY,
    integrations:
      center?.integrations ??
      INTEGRATION_IDS.map((id) => ({ id, connected: false, connectedAt: null, account: null })),
    workflow: liveWorkflowStore.read(userId),
    activity: readPage(activity, 'activity').items.map(toActivity),
    settingsCenter: state,
  };
}

export const httpSettingsService: SettingsService = {
  capabilities: {
    twoFactorEnrolment: true,
    emailEditable: false,
    integrationConnect: false,
    accountDeletion: false,
  },

  fetchSettings: fetchDocument,

  // The server records the profile save itself (PATCH /me/profile).
  recordProfileUpdate: fetchDocument,

  async saveAccount(userId, { username, phone }) {
    await apiClient.patch('/me/account', {
      ...(username.trim() === '' ? {} : { username: username.trim() }),
      phone: phone.trim(),
    });
    return fetchDocument(userId);
  },

  async changePassword(userId, { current, next }) {
    try {
      await apiClient.post('/me/password', { currentPassword: current, newPassword: next });
    } catch (error) {
      if (isApiError(error) && error.kind === 'auth' && error.code === 'invalid_credentials') {
        throw new CurrentPasswordError();
      }
      throw error;
    }
    return fetchDocument(userId);
  },

  updateSecurity() {
    // The toggle is the demo's; live, two-factor goes through enrolment.
    return Promise.reject(notConnected('Two-factor toggle'));
  },

  async revokeSession(userId, sessionId) {
    await apiClient.delete(`/me/sessions/${encodeURIComponent(sessionId)}`);
    return fetchDocument(userId);
  },

  async revokeOtherSessions(userId) {
    await apiClient.post('/me/sessions/revoke-others');
    return fetchDocument(userId);
  },

  async removeTrustedDevice(userId, deviceId) {
    await apiClient.delete(`/me/devices/${encodeURIComponent(deviceId)}`);
    return fetchDocument(userId);
  },

  async updatePrivacy(userId, privacy) {
    const updatedAt = settingsVersions.get(userId);
    // No version means the section was never read from the server — it is
    // not rendered then, so this is a caller defect, not a user's state.
    if (updatedAt === undefined) throw notConnected('Privacy preferences');
    try {
      await apiClient.patch('/me/settings/privacy', {
        updatedAt,
        value: {
          dataSharing: privacy.dataSharing,
          analytics: privacy.analytics,
          cookies: privacy.cookies,
          aiDataUsage: privacy.aiDataUsage,
        },
      });
    } catch (error) {
      if (isApiError(error) && error.kind === 'conflict') throw new SettingsConflictError();
      throw error;
    }
    return fetchDocument(userId);
  },

  async saveWorkflow(userId, workflow) {
    liveWorkflowStore.write(userId, workflow);
    return fetchDocument(userId);
  },

  async toggleIntegration(userId, { id, connect }) {
    // Connect is not offered live (`integrationConnect`); if called, the
    // server's own 501 is the answer rather than a client-side guess at it.
    await apiClient.post(
      `/me/integrations/${encodeURIComponent(id)}/${connect ? 'connect' : 'disconnect'}`,
    );
    return fetchDocument(userId);
  },

  async beginTwoFactorSetup(_userId, password): Promise<TwoFactorEnrolment> {
    const dto = asRecord(
      readData(await apiClient.post('/me/2fa/setup', { password }), 'enrolment'),
      'enrolment',
    );
    return {
      secret: readString(dto, 'secret', 'enrolment'),
      otpauthUrl: readString(dto, 'otpauthUrl', 'enrolment'),
      recoveryCodes: readStrings(dto, 'recoveryCodes', 'enrolment'),
    };
  },

  async enableTwoFactor(userId, code) {
    await apiClient.post('/me/2fa/enable', { code });
    return fetchDocument(userId);
  },

  async disableTwoFactor(userId, password) {
    await apiClient.post('/me/2fa/disable', { password });
    return fetchDocument(userId);
  },

  async beginTwoFactorReenrollment(_userId, { password, code }): Promise<TwoFactorReenrollment> {
    const what = 'reenrolment';
    const dto = asRecord(
      readData(await apiClient.post('/me/2fa/reenroll', { password, code }), what),
      what,
    );
    return {
      secret: readString(dto, 'secret', what),
      otpauthUrl: readString(dto, 'otpauthUrl', what),
      enrolmentToken: readString(dto, 'enrolmentToken', what),
    };
  },

  async listVerificationDocuments() {
    return list(await apiClient.get('/me/verification-documents'), 'verification documents').map(
      toVerificationDocument,
    );
  },

  submitVerificationDocument,

  async confirmTwoFactorReenrollment(_userId, { enrolmentToken, code }) {
    const what = 'reenrolment';
    const dto = asRecord(
      readData(await apiClient.post('/me/2fa/reenroll/confirm', { enrolmentToken, code }), what),
      what,
    );
    return readStrings(dto, 'recoveryCodes', what);
  },
};
