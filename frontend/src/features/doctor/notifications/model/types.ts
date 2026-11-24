import {
  Bell,
  BellRing,
  Calendar,
  FlaskConical,
  FolderHeart,
  Megaphone,
  MessageSquare,
  Pill,
  ServerCog,
  ShieldAlert,
  UserRound,
  type LucideIcon,
} from 'lucide-react';

import type { StatusKind } from '@/components/patterns';
import { MedoraAiLogo } from '@/shared/components/branding';

/**
 * Notifications domain model — feature-local types mirroring the future
 * notification/message DTOs. Everything is frontend-only: the dataset is
 * a deterministic seed persisted in localStorage through the mock
 * service; priorities map onto the sanctioned P8 StatusBadge vocabulary
 * (DS §8.8), and category icons/styles are the single source for every
 * surface (list, detail drawer, navbar bell).
 */

/* ── Categories ─────────────────────────────────────────────────── */

export type NotificationCategory =
  | 'appointments'
  | 'medical-records'
  | 'laboratory'
  | 'pharmacy'
  | 'patients'
  | 'ai'
  | 'system'
  | 'security';

export const NOTIFICATION_CATEGORY_META: Record<
  NotificationCategory,
  { readonly label: string; readonly icon: LucideIcon; readonly iconClass: string }
> = {
  appointments: { label: 'Appointments', icon: Calendar, iconClass: 'bg-info-subtle text-info' },
  'medical-records': {
    label: 'Medical Records',
    icon: FolderHeart,
    iconClass: 'bg-primary-subtle text-primary',
  },
  laboratory: { label: 'Laboratory', icon: FlaskConical, iconClass: 'bg-error-subtle text-error' },
  pharmacy: { label: 'Pharmacy', icon: Pill, iconClass: 'bg-warning-subtle text-warning' },
  patients: { label: 'Patients', icon: UserRound, iconClass: 'bg-primary-subtle text-primary' },
  ai: { label: 'Medora AI', icon: MedoraAiLogo, iconClass: 'bg-accent-subtle text-accent' },
  system: { label: 'System', icon: ServerCog, iconClass: 'bg-surface-sunken text-text-secondary' },
  security: { label: 'Security', icon: ShieldAlert, iconClass: 'bg-error-subtle text-error' },
};

export const NOTIFICATION_CATEGORIES = Object.keys(
  NOTIFICATION_CATEGORY_META,
) as readonly NotificationCategory[];

export function isNotificationCategory(value: string): value is NotificationCategory {
  return (NOTIFICATION_CATEGORIES as readonly string[]).includes(value);
}

/* ── Priority & kind ────────────────────────────────────────────── */

export type NotificationPriority = 'normal' | 'important' | 'critical';

export const NOTIFICATION_PRIORITY_META: Record<
  NotificationPriority,
  { readonly label: string; readonly kind: StatusKind }
> = {
  normal: { label: 'Normal', kind: 'normal' },
  important: { label: 'Important', kind: 'expiring' },
  critical: { label: 'Critical', kind: 'critical' },
};

export const NOTIFICATION_PRIORITIES = Object.keys(
  NOTIFICATION_PRIORITY_META,
) as readonly NotificationPriority[];

export type NotificationKind = 'alert' | 'reminder' | 'update';

export const NOTIFICATION_KIND_META: Record<
  NotificationKind,
  { readonly label: string; readonly icon: LucideIcon }
> = {
  alert: { label: 'Alert', icon: BellRing },
  reminder: { label: 'Reminder', icon: Bell },
  update: { label: 'Update', icon: Megaphone },
};

export const NOTIFICATION_KINDS = Object.keys(
  NOTIFICATION_KIND_META,
) as readonly NotificationKind[];

/* ── Status (read/archive lifecycle) ────────────────────────────── */

/**
 * The page's views, carried in `?status=` (absent = `active`, the inbox).
 * `starred` is the `favorite` flag the API already serves — every starred
 * notification, archived or not, the way a saved item outlives the inbox.
 */
export type NotificationStatusFilter = 'active' | 'unread' | 'read' | 'starred' | 'archived';

export const NOTIFICATION_STATUS_FILTERS: readonly NotificationStatusFilter[] = [
  'active',
  'unread',
  'read',
  'starred',
  'archived',
];

export const NOTIFICATION_STATUS_LABELS: Record<NotificationStatusFilter, string> = {
  active: 'Inbox',
  unread: 'Unread',
  read: 'Read',
  starred: 'Starred',
  archived: 'Archived',
};

/* ── Related clinical entities (mock ids only — no PHI) ─────────── */

export interface NotificationRelated {
  readonly patientId: string | null;
  readonly patientName: string | null;
  readonly recordId: string | null;
  readonly labId: string | null;
  readonly prescriptionId: string | null;
  readonly appointmentId: string | null;
}

export const NO_RELATED: NotificationRelated = {
  patientId: null,
  patientName: null,
  recordId: null,
  labId: null,
  prescriptionId: null,
  appointmentId: null,
};

/* ── The notification ───────────────────────────────────────────── */

export interface DoctorNotification {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly category: NotificationCategory;
  readonly priority: NotificationPriority;
  readonly kind: NotificationKind;
  readonly sender: string;
  readonly createdAt: string;
  readonly read: boolean;
  readonly archived: boolean;
  readonly favorite: boolean;
  readonly pinned: boolean;
  readonly related: NotificationRelated;
}

/* ── Communication center ───────────────────────────────────────── */

export type ConversationKind = 'direct' | 'announcement' | 'system';

export const CONVERSATION_KIND_META: Record<
  ConversationKind,
  { readonly label: string; readonly icon: LucideIcon }
> = {
  direct: { label: 'Direct message', icon: MessageSquare },
  announcement: { label: 'Announcement', icon: Megaphone },
  system: { label: 'System alerts', icon: ServerCog },
};

export interface ChatMessage {
  readonly id: string;
  /** 'me' = the signed-in doctor; anything else is the display name. */
  readonly from: string;
  readonly body: string;
  readonly at: string;
  readonly failed?: boolean;
}

export interface Conversation {
  readonly id: string;
  readonly name: string;
  readonly kind: ConversationKind;
  /** Role/subtitle line, e.g. "Cardiology" or "All staff". */
  readonly caption: string;
  readonly messages: readonly ChatMessage[];
  readonly unreadCount: number;
  /** Announcements and system channels are read-only for doctors. */
  readonly readOnly: boolean;
}

/* ── Preferences (persisted per user) ───────────────────────────── */

export type NotificationChannel = 'email' | 'sms' | 'push' | 'desktop' | 'inApp';

export const NOTIFICATION_CHANNEL_META: Record<
  NotificationChannel,
  { readonly label: string; readonly description: string }
> = {
  email: { label: 'Email', description: 'Daily digest and critical alerts to your inbox.' },
  sms: { label: 'SMS', description: 'Critical alerts only, to your registered phone.' },
  push: { label: 'Push', description: 'Mobile push notifications from the Medora app.' },
  desktop: { label: 'Desktop', description: 'Browser notifications while Medora is open.' },
  inApp: { label: 'In-app', description: 'The bell feed and this notification center.' },
};

export const NOTIFICATION_CHANNELS = Object.keys(
  NOTIFICATION_CHANNEL_META,
) as readonly NotificationChannel[];

export interface NotificationPreferences {
  readonly channels: Record<NotificationChannel, boolean>;
  readonly quietHours: {
    readonly enabled: boolean;
    /** "HH:MM" 24h */
    readonly from: string;
    readonly to: string;
  };
  /** Per-category opt-in; security cannot be disabled (enforced in UI). */
  readonly categories: Record<NotificationCategory, boolean>;
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  channels: { email: true, sms: false, push: true, desktop: false, inApp: true },
  quietHours: { enabled: false, from: '22:00', to: '07:00' },
  categories: {
    appointments: true,
    'medical-records': true,
    laboratory: true,
    pharmacy: true,
    patients: true,
    ai: true,
    system: true,
    security: true,
  },
};

/* ── Badge counts (shell integration) ───────────────────────────── */

export interface NotificationBadgeCounts {
  readonly notifications: number;
  readonly messages: number;
}
