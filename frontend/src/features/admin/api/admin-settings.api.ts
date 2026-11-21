/**
 * Admin Platform Settings — mock persistence (Phase 18).
 * One localStorage document merged over defaults on load (so new fields
 * added later never produce holes), with simulated latency. Every mutation
 * returns the FULL patched document so the query layer can seed its cache
 * without a refetch (the StrictMode-safe pattern used across the app).
 */

import type {
  AdminSettingsDocument,
  AdminSettingsFormKey,
  AdminSettingsFormSlices,
  ApiKey,
  BackupEntry,
  PlatformUser,
} from '../admin-settings.types';
import {
  DEFAULT_PERMISSION_STATE,
  normalizePermissionMatrix,
  normalizePermissionState,
  PermissionConflictError,
  type PermissionMatrix,
} from '../permissions';

const STORAGE_KEY = 'medora.admin.settings.v1';
const LATENCY_MS = 280;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

/* ── Defaults (the "reset defaults" baseline) ─────────────────── */

export const DEFAULT_ADMIN_SETTINGS: AdminSettingsDocument = {
  general: {
    platformName: 'Medora Clinic Platform',
    supportEmail: 'support@medora.health',
    defaultSection: 'overview',
    maintenanceMode: false,
    maintenanceMessage: 'Medora is undergoing scheduled maintenance. Back shortly.',
  },
  organization: {
    name: 'Medora Clinic — Riverside',
    legalName: 'Medora Health Systems LLC',
    taxId: 'US-88-1042733',
    phone: '+1 (555) 018-0000',
    website: 'https://medora.health',
    addressLine: '410 Riverside Avenue',
    city: 'Portland, OR',
    country: 'United States',
  },
  branding: {
    productName: 'Medora',
    tagline: 'The AI-powered platform for modern healthcare teams.',
    loginWelcome: 'Welcome to Medora',
    showPoweredBy: true,
  },
  localization: {
    language: 'en',
    timezone: 'America/Los_Angeles',
    dateFormat: 'MDY',
    timeFormat: '12h',
    firstDayOfWeek: 'monday',
    currency: 'USD',
  },
  notifications: {
    emailEnabled: true,
    smsEnabled: false,
    inAppEnabled: true,
    dailyDigest: true,
    criticalOnly: false,
    quietFrom: '21:00',
    quietTo: '07:00',
  },
  security: {
    twoFactorRequired: false,
    passwordExpiryDays: 180,
    sessionTimeoutMinutes: 30,
    loginAttemptLimit: 5,
    singleSessionPerUser: false,
  },
  email: {
    fromName: 'Medora Clinic',
    fromAddress: 'no-reply@medora.health',
    replyTo: 'support@medora.health',
    smtpHost: 'smtp.medora.health',
    smtpPort: 587,
    signature: 'Medora Clinic — Riverside · +1 (555) 018-0000',
  },
  sms: {
    enabled: false,
    senderId: 'MEDORA',
    defaultCountryCode: '+1',
    deliveryReports: true,
  },
  backup: {
    autoBackup: true,
    frequency: 'daily',
    retainCount: 5,
  },
  retention: {
    patientRecordYears: 10,
    auditLogDays: 365,
    messageDays: 180,
    autoPurge: false,
  },
  privacy: {
    productAnalytics: true,
    errorReporting: true,
    cookieBanner: true,
    dpaAccepted: true,
  },
  // Platform accounts — the seeded admin plus the canonical staff cast.
  users: [
    {
      id: 'usr-admin',
      name: 'Marcus Reed',
      email: 'admin@medora.health',
      role: 'admin',
      active: true,
      lastActiveAt: '2026-07-19T08:05:00Z',
    },
    {
      id: 'usr-doc',
      name: 'Dr. Lena Hart',
      email: 'lena.hart@medora.clinic',
      role: 'doctor',
      active: true,
      lastActiveAt: '2026-07-19T07:48:00Z',
    },
    {
      id: 'usr-rec',
      name: 'Priya Nair',
      email: 'priya.nair@medora.clinic',
      role: 'reception',
      active: true,
      lastActiveAt: '2026-07-18T16:40:00Z',
    },
    {
      id: 'usr-lab',
      name: 'Tomas Ellis',
      email: 'tomas.ellis@medora.clinic',
      role: 'laboratory',
      active: true,
      lastActiveAt: '2026-07-17T15:12:00Z',
    },
    {
      id: 'usr-phr',
      name: 'Sofia Marin',
      email: 'sofia.marin@medora.clinic',
      role: 'pharmacy',
      active: false,
      lastActiveAt: '2026-07-04T09:30:00Z',
    },
  ],
  integrations: [
    {
      id: 'int-calendar',
      name: 'Google Calendar',
      description: 'Two-way sync of appointments and time off.',
      connected: true,
      lastSyncAt: '2026-07-19T07:30:00Z',
    },
    {
      id: 'int-meet',
      name: 'Video Consultations',
      description: 'Meeting links for remote appointments.',
      connected: true,
      lastSyncAt: '2026-07-19T06:55:00Z',
    },
    {
      id: 'int-payments',
      name: 'Payments Gateway',
      description: 'Invoicing and card payments.',
      connected: false,
      lastSyncAt: null,
    },
    {
      id: 'int-email',
      name: 'Transactional Email',
      description: 'Delivery provider behind platform email.',
      connected: true,
      lastSyncAt: '2026-07-19T08:00:00Z',
    },
    {
      id: 'int-sms',
      name: 'SMS Gateway',
      description: 'Delivery provider behind text reminders.',
      connected: false,
      lastSyncAt: null,
    },
  ],
  apiKeys: [
    {
      id: 'key-reporting',
      label: 'Reporting export',
      prefix: 'mdra_live_9f2c',
      createdAt: '2026-05-02T10:00:00Z',
      lastUsedAt: '2026-07-18T22:10:00Z',
      revoked: false,
    },
    {
      id: 'key-legacy',
      label: 'Legacy intranet',
      prefix: 'mdra_live_41ab',
      createdAt: '2025-11-14T09:00:00Z',
      lastUsedAt: '2026-03-30T11:45:00Z',
      revoked: true,
    },
  ],
  backups: [
    {
      id: 'bak-0719',
      label: 'Daily automatic backup',
      createdAt: '2026-07-19T02:00:00Z',
      sizeMb: 412,
      kind: 'automatic',
    },
    {
      id: 'bak-0718',
      label: 'Daily automatic backup',
      createdAt: '2026-07-18T02:00:00Z',
      sizeMb: 409,
      kind: 'automatic',
    },
    {
      id: 'bak-0715',
      label: 'Pre-update snapshot',
      createdAt: '2026-07-15T18:20:00Z',
      sizeMb: 398,
      kind: 'manual',
    },
  ],
  permissions: DEFAULT_PERMISSION_STATE,
};

/* ── Storage ──────────────────────────────────────────────────── */

function load(): AdminSettingsDocument {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return DEFAULT_ADMIN_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_ADMIN_SETTINGS;
    const stored = parsed as Partial<AdminSettingsDocument>;
    // Merge each form slice over its defaults so later-added fields never
    // produce holes; collections are taken whole when present.
    return {
      ...DEFAULT_ADMIN_SETTINGS,
      ...stored,
      general: { ...DEFAULT_ADMIN_SETTINGS.general, ...stored.general },
      organization: { ...DEFAULT_ADMIN_SETTINGS.organization, ...stored.organization },
      branding: { ...DEFAULT_ADMIN_SETTINGS.branding, ...stored.branding },
      localization: { ...DEFAULT_ADMIN_SETTINGS.localization, ...stored.localization },
      notifications: { ...DEFAULT_ADMIN_SETTINGS.notifications, ...stored.notifications },
      security: { ...DEFAULT_ADMIN_SETTINGS.security, ...stored.security },
      email: { ...DEFAULT_ADMIN_SETTINGS.email, ...stored.email },
      sms: { ...DEFAULT_ADMIN_SETTINGS.sms, ...stored.sms },
      backup: { ...DEFAULT_ADMIN_SETTINGS.backup, ...stored.backup },
      retention: { ...DEFAULT_ADMIN_SETTINGS.retention, ...stored.retention },
      privacy: { ...DEFAULT_ADMIN_SETTINGS.privacy, ...stored.privacy },
      // Repaired rather than merged: a stored matrix may predate a capability
      // or violate a lock that was added since, and either would be a hole.
      permissions: normalizePermissionState(stored.permissions),
    };
  } catch {
    return DEFAULT_ADMIN_SETTINGS;
  }
}

function persist(document: AdminSettingsDocument): AdminSettingsDocument {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(document));
  } catch {
    // Storage unavailable — settings stay session-local.
  }
  return document;
}

function patch(mutate: (current: AdminSettingsDocument) => AdminSettingsDocument) {
  return delay(persist(mutate(load())));
}

/* ── API ──────────────────────────────────────────────────────── */

export interface CreatedApiKey {
  readonly document: AdminSettingsDocument;
  /** Shown once — the mock never stores the full secret. */
  readonly secret: string;
}

export const adminSettingsApi = {
  getSettings: (): Promise<AdminSettingsDocument> => delay(load()),

  saveSection: <K extends AdminSettingsFormKey>(
    key: K,
    value: AdminSettingsFormSlices[K],
  ): Promise<AdminSettingsDocument> => patch((current) => ({ ...current, [key]: value })),

  updateUser: (id: string, changes: Partial<Pick<PlatformUser, 'role' | 'active'>>) =>
    patch((current) => ({
      ...current,
      users: current.users.map((user) => (user.id === id ? { ...user, ...changes } : user)),
    })),

  toggleIntegration: (id: string) =>
    patch((current) => ({
      ...current,
      integrations: current.integrations.map((integration) =>
        integration.id === id
          ? {
              ...integration,
              connected: !integration.connected,
              lastSyncAt: integration.connected ? integration.lastSyncAt : new Date().toISOString(),
            }
          : integration,
      ),
    })),

  createApiKey: async (label: string): Promise<CreatedApiKey> => {
    const suffix = Math.random().toString(16).slice(2, 6);
    const key: ApiKey = {
      id: `key-${String(Date.now())}`,
      label,
      prefix: `mdra_live_${suffix}`,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      revoked: false,
    };
    const document = await patch((current) => ({
      ...current,
      apiKeys: [key, ...current.apiKeys].slice(0, 5),
    }));
    return { document, secret: `${key.prefix}_${Math.random().toString(16).slice(2, 18)}` };
  },

  revokeApiKey: (id: string) =>
    patch((current) => ({
      ...current,
      apiKeys: current.apiKeys.map((key) => (key.id === id ? { ...key, revoked: true } : key)),
    })),

  createBackup: () =>
    patch((current) => {
      const entry: BackupEntry = {
        id: `bak-${String(Date.now())}`,
        label: 'Manual backup',
        createdAt: new Date().toISOString(),
        sizeMb: 412,
        kind: 'manual',
      };
      return { ...current, backups: [entry, ...current.backups].slice(0, 5) };
    }),

  deleteBackup: (id: string) =>
    patch((current) => ({
      ...current,
      backups: current.backups.filter((backup) => backup.id !== id),
    })),

  resetSection: <K extends AdminSettingsFormKey>(key: K): Promise<AdminSettingsDocument> =>
    patch((current) => ({ ...current, [key]: DEFAULT_ADMIN_SETTINGS[key] })),

  /**
   * Permission matrix (ADM-09). Optimistic-concurrency by revision: the
   * editor sends the revision it opened, and a save against a stale one is
   * rejected with the *current* state so the UI can show both change sets
   * (the concurrent-edit merge dialog, UX §3.9) instead of silently winning.
   */
  savePermissions: (input: {
    matrix: PermissionMatrix;
    baseRevision: number;
    actor: string;
  }): Promise<AdminSettingsDocument> => {
    const current = load();
    if (current.permissions.revision !== input.baseRevision) {
      return delay(null).then(() => {
        throw new PermissionConflictError(current.permissions);
      });
    }
    return patch((document) => ({
      ...document,
      permissions: {
        matrix: normalizePermissionMatrix(input.matrix),
        revision: document.permissions.revision + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: input.actor,
      },
    }));
  },

  resetPermissions: (actor: string): Promise<AdminSettingsDocument> =>
    patch((document) => ({
      ...document,
      permissions: {
        ...DEFAULT_PERMISSION_STATE,
        revision: document.permissions.revision + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: actor,
      },
    })),
};
