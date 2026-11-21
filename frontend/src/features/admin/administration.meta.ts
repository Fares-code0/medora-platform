/**
 * Doctor Administration Center — static metadata & label maps (Phase 17).
 * Component-free so it can be shared by the shell, the rail and every
 * section without tripping the react-refresh boundary. Keeps status → label
 * and status → badge-variant mappings in one audited place.
 */

import {
  Activity,
  Armchair,
  Building2,
  CalendarCheck,
  CalendarOff,
  CalendarRange,
  ChartColumnBig,
  Clock,
  DoorOpen,
  FileSearch,
  FileText,
  LayoutDashboard,
  ListOrdered,
  Megaphone,
  MessagesSquare,
  Package,
  ScrollText,
  Settings2,
  SlidersHorizontal,
  Stethoscope,
  UserRoundCog,
  Users,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';

import type { StatisticTone, StatusKind } from '@/components/patterns';
import type { BadgeEmphasis, BadgeVariant } from '@/components/ui';
import type { TranslateFn } from '@/i18n';
import { formatDateWith } from '@/i18n';
import { adminNavigation } from '@/layouts';

import type {
  ActiveStatus,
  AdminSectionSlug,
  AnnouncementPriority,
  PresenceStatus,
  QueuePriority,
  Resource,
  RoomStatus,
  ShiftKind,
  StaffRole,
} from './administration.types';
import type { Tone } from './components/primitives';

/**
 * Landing-section options for the "default page" selects in Admin Profile
 * and General Settings. Derived from the shell's navigation config so the
 * choices can never drift from the sidebar (navigation as data, §4).
 */
export function adminSectionOptions(t: TranslateFn): readonly {
  readonly value: string;
  readonly label: string;
  readonly group: string;
}[] {
  /*
   * `t` is a parameter rather than a `useT()` call: this is a plain
   * function, not a hook, and it is called from two components. Passing the
   * translator in keeps it callable from either without making it a hook —
   * and keeps the options list re-derived on a locale change, because the
   * caller re-renders.
   */
  return adminNavigation.sections.flatMap((section) =>
    section.items.map((item) => ({
      value: item.id,
      label: t(item.labelKey),
      group: section.labelKey === undefined ? t('shell.more') : t(section.labelKey),
    })),
  );
}

export const SECTION_META: Record<
  AdminSectionSlug,
  { readonly label: string; readonly description: string; readonly icon: LucideIcon }
> = {
  overview: {
    label: 'Overview',
    description: 'Platform health, security alerts and the work waiting on you.',
    icon: LayoutDashboard,
  },
  clinic: {
    label: 'Clinic Overview',
    description: 'Live snapshot of today’s clinic activity and utilization.',
    icon: Activity,
  },
  doctors: {
    label: 'Doctors',
    description: 'Onboarding, verification, and the standing of every doctor on the platform.',
    icon: Stethoscope,
  },
  patients: {
    label: 'Patients',
    description: 'Account support, access governance and lifecycle — never clinical review.',
    icon: UsersRound,
  },
  appointments: {
    label: 'Appointment Oversight',
    description: 'Every doctor’s appointments, the ones that are stuck, and what to do about them.',
    icon: CalendarCheck,
  },
  queue: {
    label: 'Queue Management',
    description: 'Who is next, who is waiting and who is running late.',
    icon: ListOrdered,
  },
  'waiting-room': {
    label: 'Waiting Room',
    description: 'Patients checked in and waiting to be seen.',
    icon: Armchair,
  },
  staff: {
    label: 'Staff Management',
    description: 'Clinic team, roles, availability and permissions.',
    icon: Users,
  },
  departments: {
    label: 'Departments',
    description: 'Clinic departments, their heads and staffing.',
    icon: Building2,
  },
  shifts: {
    label: 'Shift Management',
    description: 'Weekly shift planner across the whole team.',
    icon: CalendarRange,
  },
  schedule: {
    label: 'Working Schedule',
    description: 'Clinic opening hours across the week.',
    icon: Clock,
  },
  holidays: {
    label: 'Holidays',
    description: 'Public and clinic closures for the year.',
    icon: CalendarOff,
  },
  rooms: {
    label: 'Room Management',
    description: 'Consultation, lab, procedure, pharmacy and waiting areas.',
    icon: DoorOpen,
  },
  resources: {
    label: 'Resources',
    description: 'Equipment and consumable stock across the clinic.',
    icon: Package,
  },
  announcements: {
    label: 'Announcements',
    description: 'Internal notices for the clinic team.',
    icon: Megaphone,
  },
  policies: {
    label: 'Clinic Policies',
    description: 'Operating policies and compliance documents.',
    icon: ScrollText,
  },
  templates: {
    label: 'Document Templates',
    description: 'Reusable clinical document templates.',
    icon: FileText,
  },
  communications: {
    label: 'Communication Monitoring',
    description: 'Conversation oversight, safety flags and gated content access.',
    icon: MessagesSquare,
  },
  logs: {
    label: 'System Logs',
    description: 'Every authentication, security and administrative event on the platform.',
    icon: FileSearch,
  },
  reports: {
    label: 'Reports',
    description: 'Growth, utilization, clinical operations and platform performance.',
    icon: ChartColumnBig,
  },
  settings: {
    label: 'Platform Settings',
    description: 'Organization, communication, security and data configuration.',
    icon: Settings2,
  },
  preferences: {
    label: 'My Settings',
    description: 'Your personal account, appearance, and workspace preferences.',
    icon: SlidersHorizontal,
  },
  profile: {
    label: 'My Profile',
    description: 'Your administrator identity, security and activity.',
    icon: UserRoundCog,
  },
};

/* ── Label maps ───────────────────────────────────────────────── */

export const STAFF_ROLE_LABEL: Record<StaffRole, string> = {
  doctor: 'Doctor',
  nurse: 'Nurse',
  receptionist: 'Receptionist',
  laboratory: 'Laboratory',
  pharmacy: 'Pharmacy',
};

export const PRESENCE_LABEL: Record<PresenceStatus, string> = {
  'on-duty': 'On duty',
  'on-break': 'On break',
  'off-duty': 'Off duty',
  'on-leave': 'On leave',
};

/**
 * Presence is a genuine lifecycle — a person moves through these states and
 * back — so it routes through `StatusKind` (ADR-0001 §12).
 *
 * `on-break` is `awaiting`: temporarily unavailable and coming back, which is
 * settled from the roster's point of view. `on-leave` is `archived` — out of
 * the roster for a period, which is what the Archive glyph says — while
 * `off-duty` is merely descriptive and takes `info`. Splitting those two
 * matters: they were both quiet greys before and read as the same thing.
 */
export const PRESENCE_KIND: Record<PresenceStatus, StatusKind> = {
  'on-duty': 'active',
  'on-break': 'awaiting',
  'off-duty': 'info',
  'on-leave': 'archived',
};

export const ROOM_STATUS_LABEL: Record<RoomStatus, string> = {
  available: 'Available',
  occupied: 'Occupied',
  cleaning: 'Cleaning',
  maintenance: 'Maintenance',
};

/**
 * A room moves available → occupied → cleaning → available, and drops out to
 * maintenance, so this is lifecycle rather than severity.
 *
 * `available` is the settled baseline (`normal`), not a live state — the room
 * is not doing anything. `maintenance` takes `cancelled`: out of service by a
 * decision someone made and can reverse, which is exactly the Ban glyph.
 */
export const ROOM_STATUS_KIND: Record<RoomStatus, StatusKind> = {
  available: 'normal',
  occupied: 'active',
  cleaning: 'pending',
  maintenance: 'cancelled',
};

export const ACTIVE_LABEL: Record<ActiveStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
};

export const SHIFT_LABEL: Record<ShiftKind, string> = {
  morning: 'Morning',
  evening: 'Evening',
  'on-call': 'On-call',
  vacation: 'Vacation',
  leave: 'Leave',
};

/*
 * `evening` was `ai`. A shift is not AI-generated content, and spending the
 * provenance violet on a rota chip dilutes the one signal that tells a
 * clinician a value was machine-written (ADR-0001 §6).
 *
 * Removing it leaves five kinds and no sixth non-alarm hue: `error` is the
 * only unused variant and an evening shift is not an alarm. Emphasis
 * supplies the missing axis instead — morning and evening share the
 * informational blue and separate by fill. On a taxonomy chip emphasis
 * carries no lifecycle claim; that reading is defined for StatusKind, and
 * shift kind is not a status (see the classification in ADR-0001 §12).
 */
export const SHIFT_VARIANT: Record<ShiftKind, BadgeVariant> = {
  morning: 'info',
  evening: 'info',
  'on-call': 'warning',
  vacation: 'success',
  leave: 'neutral',
};

export const SHIFT_EMPHASIS: Record<ShiftKind, BadgeEmphasis> = {
  morning: 'filled',
  evening: 'outline',
  'on-call': 'filled',
  vacation: 'filled',
  leave: 'filled',
};

export const QUEUE_PRIORITY_LABEL: Record<QueuePriority, string> = {
  routine: 'Routine',
  priority: 'Priority',
  urgent: 'Urgent',
};

export const QUEUE_PRIORITY_VARIANT: Record<QueuePriority, BadgeVariant> = {
  routine: 'neutral',
  priority: 'warning',
  urgent: 'error',
};

export const ANNOUNCEMENT_PRIORITY_LABEL: Record<AnnouncementPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
};

export const ANNOUNCEMENT_PRIORITY_VARIANT: Record<AnnouncementPriority, BadgeVariant> = {
  low: 'neutral',
  normal: 'info',
  high: 'error',
};

export const RESOURCE_STATUS_LABEL: Record<Resource['status'], string> = {
  'in-stock': 'In stock',
  low: 'Low',
  out: 'Out',
};

export const RESOURCE_STATUS_VARIANT: Record<Resource['status'], BadgeVariant> = {
  'in-stock': 'success',
  low: 'warning',
  out: 'error',
};

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

/* ── Formatters ───────────────────────────────────────────────── */

export function formatMinutes(minutes: number): string {
  if (minutes <= 0) return 'now';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return formatDateWith(date, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * The admin `Tone` scale calls the accent `accent`; the platform's
 * `StatisticTone` calls it `ai`. Same token either way — this is the bridge
 * Wave 2d-b uses so the 37 `MetricTile` sites map onto `StatisticCard`
 * deliberately, rather than by whichever name happens to typecheck.
 *
 * It lives here, not beside `StatisticCard`: the platform layer has no
 * business knowing the admin area's tone names, and this module is
 * component-free so a constant does not trip the react-refresh boundary.
 */
export const ADMIN_TONE_TO_STATISTIC: Record<Tone, StatisticTone> = {
  primary: 'primary',
  secondary: 'secondary',
  success: 'success',
  warning: 'warning',
  error: 'error',
  info: 'info',
  accent: 'ai',
};

/**
 * Resolves a stored landing-section preference against the slugs that exist
 * today. `platform` was a real section until ADM-01 absorbed it, and the
 * preference outlives the section: it is persisted per user in localStorage
 * and in the settings document, so a stale slug would otherwise route an
 * administrator nowhere. The overview is the honest default — it is where
 * UX §1.3 lands the role anyway.
 *
 * Lives here rather than at each caller so every reader of the preference
 * gets the same answer.
 *
 * `Object.hasOwn` rather than `in`: the stored value is arbitrary text from
 * localStorage, and `in` walks the prototype chain — `'constructor'`,
 * `'toString'` and `'__proto__'` would all pass as known slugs and be routed
 * to, which is the exact dead route this resolver exists to prevent.
 */
export function resolveLandingSection(stored: string): AdminSectionSlug {
  return Object.hasOwn(SECTION_META, stored) ? (stored as AdminSectionSlug) : 'overview';
}
