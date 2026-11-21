import {
  Activity,
  CalendarClock,
  ClipboardList,
  FileClock,
  Filter,
  HardDrive,
  HeartPulse,
  Radio,
  Stethoscope,
  UserRoundPlus,
  UsersRound,
} from 'lucide-react';

import type { NamedSeries } from '@/components/charts';
import type {
  DashboardWidgetChrome,
  DashboardWidgetDefinition,
  DashboardWidgetGroupDefinition,
} from '@/components/patterns';

import type { AuditEvent, PlatformStatus } from '../administration.types';

import {
  ActionQueueSlot,
  ActiveUsersSlot,
  AdminActivitySlot,
  AppointmentFunnelSlot,
  AppointmentsTodaySlot,
  PlatformActivitySlot,
  RecentSignupsSlot,
  StorageUsageSlot,
  SystemHealthSlot,
  TotalDoctorsSlot,
  TotalPatientsSlot,
} from './AdminWidgetSlots';
import type {
  ActionQueueRow,
  ActivityRange,
  AppointmentFunnel,
  OverviewKpis,
  ServiceHealth,
  SignupEntry,
} from './overview.types';

/**
 * The Admin Overview's widget catalogue — the one list the page, the
 * customize drawer and the persisted selection are all driven by. The
 * Doctor Overview has its own; the two share no widget, and the layout,
 * drawer and selection behind them are the shared customizable-dashboard
 * pattern (`components/patterns/dashboard`).
 *
 * Available → (administrator selects) → active → responsive layout. A widget
 * is "available" exactly when its id is not in the administrator's
 * selection, so it can never appear in both places at once.
 *
 * ── What is here, and what is not ───────────────────────────────────
 * Exactly the widgets the fixed Overview already rendered, with the KPI row
 * split into its four tiles. Nothing was invented to fill the catalogue.
 *
 * Two things the fixed page drew are deliberately *not* widgets:
 *
 * - The security alerts banner. §3.1 makes it undismissable and requires its
 *   failure to be visible rather than silently absent; a widget an
 *   administrator can switch off is both. It stays pinned above the
 *   dashboard, gated on `logs.view` as before.
 * - The fresh-deployment onboarding card. It is not a view anyone chooses —
 *   it appears while no doctor or patient has signed up and goes away when
 *   one does — so it stays a page-level notice too.
 *
 * No entry carries a `source`. The drawer's "Sample data" / "Not available
 * yet" markers are a claim about where each figure comes from in this build;
 * the Admin Overview's figures are derived from several admin documents
 * whose connection state differs, and each widget already reports its own
 * failure in place. The drawer makes no claim rather than a wrong one.
 */

/** Every widget id, in catalogue order. */
export const ADMIN_WIDGET_IDS = [
  'metric-total-doctors',
  'metric-total-patients',
  'metric-appointments-today',
  'metric-active-users',
  'action-queue',
  'appointment-funnel',
  'platform-activity',
  'system-health',
  'storage-usage',
  'admin-activity',
  'recent-signups',
] as const;

export type AdminWidgetId = (typeof ADMIN_WIDGET_IDS)[number];

/** Drawer grouping, in the order the drawer shows the groups. */
export const ADMIN_WIDGET_GROUPS = [
  { id: 'metrics', label: 'Key metrics', tone: 'bg-info-subtle text-info' },
  { id: 'operations', label: 'Operations', tone: 'bg-warning-subtle text-warning' },
  { id: 'platform', label: 'Platform', tone: 'bg-primary-subtle text-primary' },
  { id: 'activity', label: 'Activity', tone: 'bg-surface-sunken text-text-secondary' },
] as const satisfies readonly DashboardWidgetGroupDefinition[];

export type AdminWidgetGroup = (typeof ADMIN_WIDGET_GROUPS)[number]['id'];

/** One source's query state, as a widget draws its loading and failure. */
export interface WidgetQueryState {
  readonly isLoading: boolean;
  readonly isError: boolean;
  readonly onRetry: () => void;
}

/**
 * Everything the page has read or derived, handed to every widget. The page
 * owns the queries and the one clock (so the metrics and the action queue
 * agree on what "today" means); each widget binding in `AdminWidgetSlots`
 * picks its section and the query state of the sources *it* reads — never a
 * wider one, so an outage takes down only the widgets that depend on it.
 */
export interface AdminOverviewData {
  readonly now: number;
  readonly kpis: OverviewKpis;
  /** Doctors, patients and oversight — behind the three document metrics. */
  readonly documents: WidgetQueryState;
  /** Undefined until the poll lands. */
  readonly activeUsers: number | undefined;
  readonly queue: readonly ActionQueueRow[];
  /** The documents plus communications — the queue's fifth row reads it. */
  readonly queueState: WidgetQueryState;
  readonly funnel: AppointmentFunnel;
  readonly oversight: WidgetQueryState;
  readonly activity: readonly NamedSeries[];
  readonly services: readonly ServiceHealth[];
  readonly range: ActivityRange;
  readonly onRangeChange: (range: ActivityRange) => void;
  readonly signals: WidgetQueryState;
  readonly platform: PlatformStatus | undefined;
  readonly platformState: WidgetQueryState;
  readonly auditEvents: readonly AuditEvent[];
  readonly audit: WidgetQueryState;
  readonly signups: readonly SignupEntry[];
  /** Doctors and patients only — who registered says nothing of oversight. */
  readonly accounts: WidgetQueryState;
}

export interface AdminWidgetData {
  readonly overview: AdminOverviewData;
}

/** What every widget component receives from the dashboard. */
export type AdminWidgetSlotProps = AdminWidgetData & DashboardWidgetChrome;

export type AdminWidgetDefinition = DashboardWidgetDefinition<
  AdminWidgetId,
  AdminWidgetGroup,
  AdminWidgetData
>;

export const ADMIN_WIDGETS: readonly AdminWidgetDefinition[] = [
  {
    id: 'metric-total-doctors',
    title: 'Total doctors',
    description: 'Verified doctors, and how many are waiting on verification.',
    icon: Stethoscope,
    size: 'compact',
    group: 'metrics',
    component: TotalDoctorsSlot,
  },
  {
    id: 'metric-total-patients',
    title: 'Total patients',
    description: 'Registered patients, and how many are active.',
    icon: UsersRound,
    size: 'compact',
    group: 'metrics',
    component: TotalPatientsSlot,
  },
  {
    id: 'metric-appointments-today',
    title: 'Appointments today',
    description: "Today's appointments, and how much of today's capacity they use.",
    icon: CalendarClock,
    size: 'compact',
    group: 'metrics',
    component: AppointmentsTodaySlot,
  },
  {
    id: 'metric-active-users',
    title: 'Active users now',
    description: 'Who is on the platform right now, updated every 15 seconds.',
    icon: Radio,
    size: 'compact',
    group: 'metrics',
    component: ActiveUsersSlot,
  },
  {
    id: 'action-queue',
    title: 'Admin action queue',
    description:
      'Verifications, expiring licences, open issues, stuck appointments and safety flags waiting on you.',
    icon: ClipboardList,
    size: 'standard',
    group: 'operations',
    component: ActionQueueSlot,
  },
  {
    id: 'appointment-funnel',
    title: 'Appointment funnel',
    description: 'Requested, confirmed and completed appointments over the last 7 days.',
    icon: Filter,
    size: 'standard',
    group: 'operations',
    component: AppointmentFunnelSlot,
  },
  {
    id: 'platform-activity',
    title: 'Platform activity',
    description: 'Daily active users, appointments booked and messages sent.',
    icon: Activity,
    size: 'wide',
    group: 'platform',
    component: PlatformActivitySlot,
  },
  {
    id: 'system-health',
    title: 'System health',
    description: 'The status of each platform service, with its incident note.',
    icon: HeartPulse,
    size: 'standard',
    group: 'platform',
    component: SystemHealthSlot,
  },
  {
    id: 'storage-usage',
    title: 'Storage & usage',
    description: 'Storage used and licence seats taken, against what the plan allows.',
    icon: HardDrive,
    size: 'standard',
    group: 'platform',
    component: StorageUsageSlot,
  },
  {
    id: 'admin-activity',
    title: 'Recent admin activity',
    description: 'The latest administrator actions from the audit log.',
    icon: FileClock,
    size: 'standard',
    group: 'activity',
    component: AdminActivitySlot,
  },
  {
    id: 'recent-signups',
    title: 'Recent signups',
    description: 'The newest doctor and patient accounts.',
    icon: UserRoundPlus,
    size: 'standard',
    group: 'activity',
    component: RecentSignupsSlot,
  },
];

const BY_ID = new Map<string, AdminWidgetDefinition>(
  ADMIN_WIDGETS.map((widget) => [widget.id, widget]),
);

export function isAdminWidgetId(value: unknown): value is AdminWidgetId {
  return typeof value === 'string' && BY_ID.has(value);
}

export function getAdminWidget(id: AdminWidgetId): AdminWidgetDefinition {
  const widget = BY_ID.get(id);
  // Unreachable for a narrowed id; the catalogue-integrity test pins it.
  if (!widget) throw new Error(`Unknown admin dashboard widget: ${id}`);
  return widget;
}
