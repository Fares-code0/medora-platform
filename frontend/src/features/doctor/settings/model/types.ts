import {
  Accessibility,
  Activity,
  BadgeCheck,
  Bell,
  CalendarClock,
  Info,
  Palette,
  Plug,
  Settings2,
  ShieldCheck,
  UserRound,
  UserRoundCog,
  Lock,
  type LucideIcon,
} from 'lucide-react';

/**
 * Settings domain model — feature-local types for the Doctor Settings &
 * Profile Center. Everything is frontend-only: one structured document per
 * user persisted through the mock service (localStorage), plus flat
 * interface preferences that route through the typed preferences service.
 * No PHI — the document describes the doctor's own account, never patients.
 */

/* ── Sections (left navigation) ─────────────────────────────────── */

export type SettingsSection =
  | 'profile'
  | 'verification'
  | 'account'
  | 'security'
  | 'privacy'
  | 'notifications'
  | 'availability'
  | 'appearance'
  | 'preferences'
  | 'accessibility'
  | 'integrations'
  | 'activity'
  | 'about';

export interface SettingsSectionMeta {
  readonly id: SettingsSection;
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
  /** Nav group header, Stripe/Linear style. */
  readonly group: 'Account' | 'Workspace' | 'System';
}

export const SETTINGS_SECTIONS: readonly SettingsSectionMeta[] = [
  {
    id: 'profile',
    label: 'Profile',
    description: 'Your professional identity as colleagues and staff see it.',
    icon: UserRound,
    group: 'Account',
  },
  {
    id: 'verification',
    label: 'Verification',
    description: 'The credential documents an administrator reviews to verify you.',
    icon: BadgeCheck,
    group: 'Account',
  },
  {
    id: 'account',
    label: 'Account',
    description: 'Sign-in email, username, phone, and password.',
    icon: UserRoundCog,
    group: 'Account',
  },
  {
    id: 'security',
    label: 'Security',
    description: 'Two-factor authentication, devices, and active sessions.',
    icon: Lock,
    group: 'Account',
  },
  {
    id: 'privacy',
    label: 'Privacy',
    description: 'Data sharing, analytics, and your data rights.',
    icon: ShieldCheck,
    group: 'Account',
  },
  {
    id: 'notifications',
    label: 'Notifications',
    description: 'Delivery channels and per-category alert preferences.',
    icon: Bell,
    group: 'Workspace',
  },
  {
    id: 'availability',
    label: 'Availability',
    description: 'Weekly working hours, breaks, appointment length and buffer.',
    icon: CalendarClock,
    group: 'Workspace',
  },
  {
    id: 'appearance',
    label: 'Appearance',
    description: 'Theme, density, font size, and language.',
    icon: Palette,
    group: 'Workspace',
  },
  {
    id: 'preferences',
    label: 'Preferences',
    description: 'Default landing page, formats, timezone, and drafts.',
    icon: Settings2,
    group: 'Workspace',
  },
  {
    id: 'accessibility',
    label: 'Accessibility',
    description: 'Motion, contrast, focus indicators, and text scaling.',
    icon: Accessibility,
    group: 'Workspace',
  },
  {
    id: 'integrations',
    label: 'Integrations',
    description: 'Calendar and meeting tools connected to Medora.',
    icon: Plug,
    group: 'System',
  },
  {
    id: 'activity',
    label: 'Activity log',
    description: 'Recent account actions and login history.',
    icon: Activity,
    group: 'System',
  },
  {
    id: 'about',
    label: 'About',
    description: 'Version, help and support, and legal documents.',
    icon: Info,
    group: 'System',
  },
];

export function isSettingsSection(value: string): value is SettingsSection {
  return SETTINGS_SECTIONS.some((section) => section.id === value);
}

/* ── Account ────────────────────────────────────────────────────── */

export interface AccountSettings {
  readonly email: string;
  readonly username: string;
  readonly phone: string;
  readonly passwordUpdatedAt: string;
  /**
   * Demo-only mock credential the fake backend verifies "current password"
   * against. A real API owns this server-side; it exists so the change-
   * password flow has honest validation, and it never renders in the UI.
   */
  readonly mockPassword: string;
}

/* ── Security ───────────────────────────────────────────────────── */

export interface TrustedDevice {
  readonly id: string;
  readonly name: string;
  /** The server also names form factors where it cannot tell the OS. */
  readonly platform: 'windows' | 'mac' | 'ios' | 'android' | 'desktop' | 'mobile' | 'tablet';
  readonly addedAt: string;
  readonly lastSeenAt: string;
  readonly current: boolean;
}

export interface ActiveSession {
  readonly id: string;
  readonly device: string;
  readonly browser: string;
  readonly location: string;
  readonly ipAddress: string;
  readonly startedAt: string;
  readonly current: boolean;
}

export interface LoginEvent {
  readonly id: string;
  readonly at: string;
  readonly device: string;
  readonly location: string;
  readonly status: 'success' | 'failed';
}

export interface SecuritySettings {
  readonly twoFactorEnabled: boolean;
  /**
   * How many single-use recovery codes the account has left — `GET /me/2fa`
   * (owner decision R2), the only place the server states it. `null` when
   * the number is not known: the demo, an API built from `main` (which has
   * no such route), or a read that failed. Live, a number is also the sign
   * that this server re-enrols an authenticator (R4 shipped with R2).
   */
  readonly recoveryCodesRemaining: number | null;
  readonly trustedDevices: readonly TrustedDevice[];
  readonly activeSessions: readonly ActiveSession[];
  readonly loginHistory: readonly LoginEvent[];
}

/* ── Privacy ────────────────────────────────────────────────────── */

export interface PrivacySettings {
  /** Share professional profile with in-network providers. */
  readonly dataSharing: boolean;
  readonly analytics: boolean;
  readonly cookies: boolean;
  readonly aiDataUsage: boolean;
}

/* ── Workflow preferences ───────────────────────────────────────── */

export type LandingPage = 'overview' | 'patients' | 'appointments' | 'labs' | 'messages';
export type PatientTab = 'summary' | 'records' | 'labs' | 'prescriptions';
export type RecordsTab = 'all' | 'recent' | 'critical';
export type DateFormat = 'MM/DD/YYYY' | 'DD/MM/YYYY' | 'YYYY-MM-DD';
export type TimeFormat = '12h' | '24h';

export interface WorkflowPreferences {
  readonly landingPage: LandingPage;
  readonly defaultPatientTab: PatientTab;
  readonly defaultRecordsTab: RecordsTab;
  readonly autoSaveDrafts: boolean;
  readonly dateFormat: DateFormat;
  readonly timeFormat: TimeFormat;
  readonly timezone: string;
}

/* ── Integrations ───────────────────────────────────────────────── */

export type IntegrationId = 'google-calendar' | 'outlook' | 'zoom' | 'teams';

export interface IntegrationState {
  readonly id: IntegrationId;
  readonly connected: boolean;
  readonly connectedAt: string | null;
  /** Account label shown while connected, e.g. an email address. */
  readonly account: string | null;
}

export interface IntegrationMeta {
  readonly id: IntegrationId;
  readonly name: string;
  readonly category: 'Calendar' | 'Meetings';
  readonly description: string;
}

export const INTEGRATION_META: readonly IntegrationMeta[] = [
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    category: 'Calendar',
    description: 'Two-way sync of appointments with your Google Calendar.',
  },
  {
    id: 'outlook',
    name: 'Outlook Calendar',
    category: 'Calendar',
    description: 'Sync your Medora schedule into Microsoft Outlook.',
  },
  {
    id: 'zoom',
    name: 'Zoom',
    category: 'Meetings',
    description: 'Create Zoom links automatically for telehealth visits.',
  },
  {
    id: 'teams',
    name: 'Microsoft Teams',
    category: 'Meetings',
    description: 'Host telehealth consultations over Microsoft Teams.',
  },
];

/* ── Activity log ───────────────────────────────────────────────── */

export type ActivityKind =
  'profile' | 'password' | 'login' | 'settings' | 'security' | 'integration' | 'privacy';

export const ACTIVITY_KIND_LABELS: Record<ActivityKind, string> = {
  profile: 'Profile',
  password: 'Password',
  login: 'Login',
  settings: 'Settings',
  security: 'Security',
  integration: 'Integration',
  privacy: 'Privacy',
};

export interface ActivityEntry {
  readonly id: string;
  readonly at: string;
  readonly kind: ActivityKind;
  readonly summary: string;
  readonly detail: string | null;
}

/* ── Verification documents (NEW-46) ────────────────────────────── */

/**
 * What a filed credential is — the server's vocabulary (API §3.6a), kept in
 * its wire spelling because nothing here renames it.
 */
export type VerificationDocumentKind =
  'medical_license' | 'degree_certificate' | 'national_id' | 'other';

export const VERIFICATION_DOCUMENT_KINDS: readonly VerificationDocumentKind[] = [
  'medical_license',
  'degree_certificate',
  'national_id',
  'other',
];

/** The admin review's own names (`features/admin/doctors/doctors.ts`), so both sides read alike. */
export const VERIFICATION_DOCUMENT_KIND_LABELS: Record<VerificationDocumentKind, string> = {
  medical_license: 'Medical licence',
  degree_certificate: 'Degree certificate',
  national_id: 'Identity document',
  other: 'Other supporting document',
};

/**
 * The three an administrator must approve before verification can be
 * completed; `other` is optional supporting material.
 */
export const REQUIRED_VERIFICATION_DOCUMENT_KINDS: readonly VerificationDocumentKind[] = [
  'medical_license',
  'degree_certificate',
  'national_id',
];

export type VerificationDecision = 'pending' | 'approved' | 'rejected';

export const VERIFICATION_DECISION_LABELS: Record<VerificationDecision, string> = {
  pending: 'Awaiting review',
  approved: 'Approved',
  rejected: 'Rejected',
};

export interface VerificationDocument {
  readonly id: string;
  readonly kind: VerificationDocumentKind;
  readonly fileId: string;
  /** ISO instant. */
  readonly uploadedAt: string;
  /** The day it expires, as local midnight (`readOptionalDay`); `null` when none was given. */
  readonly expiresOn: string | null;
  readonly decision: VerificationDecision;
  readonly decidedAt: string | null;
  /** The reviewer's words, on a rejected document. */
  readonly rejectReason: string | null;
  /** The reviewer's checklist, as the server stores it. */
  readonly checks: {
    readonly authentic: boolean;
    readonly current: boolean;
    readonly identityMatch: boolean;
  };
}

/* ── The per-user settings document ─────────────────────────────── */

/**
 * Whether the server keeps the Settings Center document — privacy consents
 * and integrations (`GET /me/settings`, RM M22). `unserved`: the route is
 * absent (an API built from `main` answers 404), so the two sections say
 * "not connected yet". `failed`: the route exists and did not answer; the two
 * sections offer Retry while every other section renders. The demo keeps
 * both in this browser and is always `served`.
 */
export type SettingsCenterState = 'served' | 'unserved' | 'failed';

export interface SettingsDocument {
  readonly account: AccountSettings;
  readonly security: SecuritySettings;
  readonly privacy: PrivacySettings;
  readonly workflow: WorkflowPreferences;
  readonly integrations: readonly IntegrationState[];
  readonly activity: readonly ActivityEntry[];
  /** Whether `privacy` and `integrations` are the server's; see {@link SettingsCenterState}. */
  readonly settingsCenter: SettingsCenterState;
}
