/**
 * Admin Platform Settings — domain model (Phase 18).
 * One structured document persisted through the mock service (localStorage),
 * mirroring what a platform-configuration API would return. Sixteen panels
 * grouped Stripe/Linear-style; form panels edit a keyed slice of the
 * document, list panels mutate collections inside it. No PHI.
 */

import {
  Building2,
  Cloud,
  Database,
  FileClock,
  Globe2,
  Info,
  KeyRound,
  Mail,
  MessageSquareText,
  Palette,
  Plug,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  UsersRound,
  Lock,
  type LucideIcon,
} from 'lucide-react';

import type { AdminSectionSlug } from './administration.types';
import type { PermissionMatrixState, PlatformRole } from './permissions';

/**
 * Roles live in `permissions.ts` (the matrix module owns them) and are
 * re-exported here so every existing settings import keeps working.
 */
export { PLATFORM_ROLES, PLATFORM_ROLE_LABEL } from './permissions';
export type { PlatformRole } from './permissions';

/* ── Panels (settings sub-navigation) ─────────────────────────── */

export type AdminSettingsPanelId =
  | 'general'
  | 'organization'
  | 'branding'
  | 'localization'
  | 'notifications'
  | 'security'
  | 'users'
  | 'roles'
  | 'audit'
  | 'integrations'
  | 'api-keys'
  | 'email'
  | 'sms'
  | 'backup'
  | 'retention'
  | 'privacy'
  | 'about';

export interface AdminSettingsPanelMeta {
  readonly id: AdminSettingsPanelId;
  readonly label: string;
  readonly description: string;
  readonly icon: LucideIcon;
  readonly group: 'Organization' | 'Communication' | 'Access & security' | 'Data & platform';
}

export const SETTINGS_PANELS: readonly AdminSettingsPanelMeta[] = [
  {
    id: 'general',
    label: 'General',
    description: 'Platform name, support contact, and operating mode.',
    icon: Settings2,
    group: 'Organization',
  },
  {
    id: 'organization',
    label: 'Organization',
    description: 'Legal identity, address, and contact details.',
    icon: Building2,
    group: 'Organization',
  },
  {
    id: 'branding',
    label: 'Branding',
    description: 'Product naming and sign-in appearance.',
    icon: Palette,
    group: 'Organization',
  },
  {
    id: 'localization',
    label: 'Localization',
    description: 'Language, timezone, and regional formats.',
    icon: Globe2,
    group: 'Organization',
  },
  {
    id: 'notifications',
    label: 'Notifications',
    description: 'Delivery channels, digests, and quiet hours.',
    icon: MessageSquareText,
    group: 'Communication',
  },
  {
    id: 'email',
    label: 'Email',
    description: 'Sender identity and SMTP delivery.',
    icon: Mail,
    group: 'Communication',
  },
  {
    id: 'sms',
    label: 'SMS',
    description: 'Sender ID and text-message delivery.',
    icon: Smartphone,
    group: 'Communication',
  },
  {
    id: 'security',
    label: 'Security',
    description: 'Authentication and session policies.',
    icon: Lock,
    group: 'Access & security',
  },
  {
    id: 'users',
    label: 'Users & Permissions',
    description: 'Platform accounts, roles, and access.',
    icon: UsersRound,
    group: 'Access & security',
  },
  {
    id: 'roles',
    label: 'Roles & Permissions',
    description: 'The capability matrix every role is measured against.',
    icon: SlidersHorizontal,
    group: 'Access & security',
  },
  {
    id: 'api-keys',
    label: 'API Keys',
    description: 'Programmatic access credentials.',
    icon: KeyRound,
    group: 'Access & security',
  },
  {
    id: 'audit',
    label: 'Audit Logs',
    description: 'Administrative actions across the platform.',
    icon: FileClock,
    group: 'Access & security',
  },
  {
    id: 'integrations',
    label: 'Integrations',
    description: 'Connected external services.',
    icon: Plug,
    group: 'Data & platform',
  },
  {
    id: 'backup',
    label: 'Backup & Restore',
    description: 'Automatic backups and recovery points.',
    icon: Cloud,
    group: 'Data & platform',
  },
  {
    id: 'retention',
    label: 'Data Retention',
    description: 'How long each data class is kept.',
    icon: Database,
    group: 'Data & platform',
  },
  {
    id: 'privacy',
    label: 'Privacy',
    description: 'Analytics, error reporting, and agreements.',
    icon: ShieldCheck,
    group: 'Data & platform',
  },
  {
    id: 'about',
    label: 'About',
    description: 'Version, license, and support.',
    icon: Info,
    group: 'Data & platform',
  },
];

export const SETTINGS_PANEL_GROUPS: readonly AdminSettingsPanelMeta['group'][] = [
  'Organization',
  'Communication',
  'Access & security',
  'Data & platform',
];

export function isAdminSettingsPanel(value: string): value is AdminSettingsPanelId {
  return SETTINGS_PANELS.some((panel) => panel.id === value);
}

/* ── Form slices ──────────────────────────────────────────────── */

export interface GeneralSettings {
  readonly platformName: string;
  readonly supportEmail: string;
  readonly defaultSection: AdminSectionSlug;
  readonly maintenanceMode: boolean;
  readonly maintenanceMessage: string;
}

export interface OrganizationSettings {
  readonly name: string;
  readonly legalName: string;
  readonly taxId: string;
  readonly phone: string;
  readonly website: string;
  readonly addressLine: string;
  readonly city: string;
  readonly country: string;
}

export interface BrandingSettings {
  readonly productName: string;
  readonly tagline: string;
  readonly loginWelcome: string;
  readonly showPoweredBy: boolean;
}

export interface LocalizationSettings {
  readonly language: 'en';
  readonly timezone: string;
  readonly dateFormat: 'DMY' | 'MDY' | 'ISO';
  readonly timeFormat: '12h' | '24h';
  readonly firstDayOfWeek: 'monday' | 'sunday';
  readonly currency: 'USD' | 'EUR' | 'GBP';
}

export interface NotificationChannelSettings {
  readonly emailEnabled: boolean;
  readonly smsEnabled: boolean;
  readonly inAppEnabled: boolean;
  readonly dailyDigest: boolean;
  readonly criticalOnly: boolean;
  readonly quietFrom: string;
  readonly quietTo: string;
}

export interface SecurityPolicySettings {
  readonly twoFactorRequired: boolean;
  readonly passwordExpiryDays: number;
  readonly sessionTimeoutMinutes: number;
  readonly loginAttemptLimit: number;
  readonly singleSessionPerUser: boolean;
}

export interface EmailSettings {
  readonly fromName: string;
  readonly fromAddress: string;
  readonly replyTo: string;
  readonly smtpHost: string;
  readonly smtpPort: number;
  readonly signature: string;
}

export interface SmsSettings {
  readonly enabled: boolean;
  readonly senderId: string;
  readonly defaultCountryCode: string;
  readonly deliveryReports: boolean;
}

export interface BackupSettings {
  readonly autoBackup: boolean;
  readonly frequency: 'daily' | 'weekly' | 'monthly';
  readonly retainCount: number;
}

export interface RetentionSettings {
  readonly patientRecordYears: number;
  readonly auditLogDays: number;
  readonly messageDays: number;
  readonly autoPurge: boolean;
}

export interface PrivacyPlatformSettings {
  readonly productAnalytics: boolean;
  readonly errorReporting: boolean;
  readonly cookieBanner: boolean;
  readonly dpaAccepted: boolean;
}

/** The keys of the document that are edited as whole form slices. */
export interface AdminSettingsFormSlices {
  readonly general: GeneralSettings;
  readonly organization: OrganizationSettings;
  readonly branding: BrandingSettings;
  readonly localization: LocalizationSettings;
  readonly notifications: NotificationChannelSettings;
  readonly security: SecurityPolicySettings;
  readonly email: EmailSettings;
  readonly sms: SmsSettings;
  readonly backup: BackupSettings;
  readonly retention: RetentionSettings;
  readonly privacy: PrivacyPlatformSettings;
}

export type AdminSettingsFormKey = keyof AdminSettingsFormSlices;

/* ── Collections ──────────────────────────────────────────────── */

export interface PlatformUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: PlatformRole;
  readonly active: boolean;
  readonly lastActiveAt: string;
}

export interface IntegrationSetting {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly connected: boolean;
  readonly lastSyncAt: string | null;
}

export interface ApiKey {
  readonly id: string;
  readonly label: string;
  /** Displayable prefix — the full key is only shown once at creation. */
  readonly prefix: string;
  readonly createdAt: string;
  readonly lastUsedAt: string | null;
  readonly revoked: boolean;
}

export interface BackupEntry {
  readonly id: string;
  readonly label: string;
  readonly createdAt: string;
  readonly sizeMb: number;
  readonly kind: 'automatic' | 'manual';
}

/* ── Document ─────────────────────────────────────────────────── */

export interface AdminSettingsDocument extends AdminSettingsFormSlices {
  readonly users: readonly PlatformUser[];
  readonly integrations: readonly IntegrationSetting[];
  readonly apiKeys: readonly ApiKey[];
  readonly backups: readonly BackupEntry[];
  /** Capabilities × roles (ADM-09). Revisioned so concurrent saves conflict. */
  readonly permissions: PermissionMatrixState;
}
