import { DEFAULT_PRIVACY, DEFAULT_WORKFLOW } from './defaults';
import type { IntegrationState, SettingsDocument } from './types';

/*
 * Demo data only — a production build does not carry this module (RM M40.4,
 * scripts/mock-boundary.ts). The defaults a live build needs are in
 * `defaults.ts`.
 */

/** The demo doctor's integrations: Google Calendar linked, the rest not. */
export const SEED_INTEGRATIONS: readonly IntegrationState[] = [
  {
    id: 'google-calendar',
    connected: true,
    connectedAt: '2026-02-14T10:30:00.000Z',
    account: 'amelia.chen@gmail.com',
  },
  { id: 'outlook', connected: false, connectedAt: null, account: null },
  { id: 'zoom', connected: false, connectedAt: null, account: null },
  { id: 'teams', connected: false, connectedAt: null, account: null },
];

/**
 * Seeded settings document for the demo doctor (Dr. Amelia Chen) — small,
 * hand-authored, deterministic. Every list stays at ≤5 records by design.
 * The biography and photo are intentionally left empty so the Profile
 * Completion widget has real missing fields to report on first run.
 */

export const SEED_SETTINGS: SettingsDocument = {
  account: {
    email: 'doctor@medora.health',
    username: 'amelia.chen',
    phone: '+1 (555) 012-4477',
    passwordUpdatedAt: '2026-04-02T09:12:00.000Z',
    mockPassword: 'Medora123!',
  },

  security: {
    twoFactorEnabled: false,
    // The demo keeps no recovery codes; the count is a server's to state.
    recoveryCodesRemaining: null,
    trustedDevices: [
      {
        id: 'dev-01',
        name: 'Clinic workstation',
        platform: 'windows',
        addedAt: '2025-11-18T08:05:00.000Z',
        lastSeenAt: '2026-07-14T07:42:00.000Z',
        current: true,
      },
      {
        id: 'dev-02',
        name: 'iPhone 15 Pro',
        platform: 'ios',
        addedAt: '2026-01-09T18:22:00.000Z',
        lastSeenAt: '2026-07-13T21:10:00.000Z',
        current: false,
      },
      {
        id: 'dev-03',
        name: 'Home MacBook Air',
        platform: 'mac',
        addedAt: '2026-03-27T20:40:00.000Z',
        lastSeenAt: '2026-07-06T22:03:00.000Z',
        current: false,
      },
    ],
    activeSessions: [
      {
        id: 'ses-01',
        device: 'Clinic workstation',
        browser: 'Chrome 138 · Windows 11',
        location: 'Springfield, IL',
        ipAddress: '10.24.8.113',
        startedAt: '2026-07-14T07:42:00.000Z',
        current: true,
      },
      {
        id: 'ses-02',
        device: 'iPhone 15 Pro',
        browser: 'Medora App · iOS 19',
        location: 'Springfield, IL',
        ipAddress: '172.58.41.207',
        startedAt: '2026-07-13T21:10:00.000Z',
        current: false,
      },
      {
        id: 'ses-03',
        device: 'Home MacBook Air',
        browser: 'Safari 19 · macOS',
        location: 'Springfield, IL',
        ipAddress: '98.212.74.35',
        startedAt: '2026-07-06T22:03:00.000Z',
        current: false,
      },
    ],
    loginHistory: [
      {
        id: 'log-01',
        at: '2026-07-14T07:42:00.000Z',
        device: 'Chrome · Windows 11',
        location: 'Springfield, IL',
        status: 'success',
      },
      {
        id: 'log-02',
        at: '2026-07-13T21:10:00.000Z',
        device: 'Medora App · iOS',
        location: 'Springfield, IL',
        status: 'success',
      },
      {
        id: 'log-03',
        at: '2026-07-12T08:01:00.000Z',
        device: 'Chrome · Windows 11',
        location: 'Springfield, IL',
        status: 'success',
      },
      {
        id: 'log-04',
        at: '2026-07-11T23:47:00.000Z',
        device: 'Firefox · Unknown',
        location: 'Rockford, IL',
        status: 'failed',
      },
      {
        id: 'log-05',
        at: '2026-07-11T07:55:00.000Z',
        device: 'Chrome · Windows 11',
        location: 'Springfield, IL',
        status: 'success',
      },
    ],
  },

  privacy: DEFAULT_PRIVACY,

  workflow: DEFAULT_WORKFLOW,

  integrations: SEED_INTEGRATIONS,

  settingsCenter: 'served',
  activity: [
    {
      id: 'act-01',
      at: '2026-07-14T07:42:00.000Z',
      kind: 'login',
      summary: 'Signed in',
      detail: 'Chrome · Windows 11 · Springfield, IL',
    },
    {
      id: 'act-02',
      at: '2026-07-11T23:47:00.000Z',
      kind: 'login',
      summary: 'Failed sign-in attempt',
      detail: 'Firefox · Rockford, IL — wrong password',
    },
    {
      id: 'act-03',
      at: '2026-06-30T14:05:00.000Z',
      kind: 'settings',
      summary: 'Notification preferences updated',
      detail: 'SMS channel disabled',
    },
    {
      id: 'act-04',
      at: '2026-04-02T09:12:00.000Z',
      kind: 'password',
      summary: 'Password changed',
      detail: null,
    },
    {
      id: 'act-05',
      at: '2026-02-14T10:30:00.000Z',
      kind: 'integration',
      summary: 'Google Calendar connected',
      detail: 'amelia.chen@gmail.com',
    },
  ],
};
