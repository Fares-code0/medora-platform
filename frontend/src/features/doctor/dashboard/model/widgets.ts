import {
  Bell,
  Calendar,
  CalendarCheck,
  CalendarClock,
  ClipboardList,
  Gauge,
  History,
  LineChart,
  Smile,
  Users,
  Zap,
} from 'lucide-react';

import { selectService } from '@/api/seam';
import type {
  DashboardWidgetChrome,
  DashboardWidgetDefinition as SharedWidgetDefinition,
  DashboardWidgetGroupDefinition,
  DashboardWidgetSize,
  DashboardWidgetSource,
} from '@/components/patterns';
import { MedoraAiLogo } from '@/shared/components/branding';

import { AiAssistantWidget } from '../components/AiAssistantWidget';
import {
  ActivePatientsMetric,
  CompletedThisWeekMetric,
  PendingRequestsMetric,
  TodaysAppointmentsMetric,
} from '../components/MetricWidgets';
import {
  AppointmentsTrendSlot,
  NotificationsSlot,
  PracticePulseSlot,
  RecentActivitySlot,
  SatisfactionSlot,
  ScheduleSlot,
} from '../components/OverviewWidgetSlots';
import { QuickActionsWidget } from '../components/QuickActionsWidget';

import type { DashboardOverview } from './dashboard-service';

/**
 * The Doctor Overview's widget catalogue — the one list the page, the
 * customize drawer and the persisted selection are all driven by.
 *
 * Available → (doctor selects) → active → responsive layout. A widget is
 * "available" exactly when its id is not in the doctor's selection, so it
 * can never appear in both places at once.
 *
 * ── Adding a widget ─────────────────────────────────────────────────
 * Write the component (a `DashboardWidget` that forwards `menu` and
 * `className`, and takes any figures from `overview` — never from
 * `mock-data.ts`), give it an id in `DASHBOARD_WIDGET_IDS`, and add one entry
 * below. Nothing in the page or the layout changes: the layout reads `size`,
 * and the drawer reads `group` and `source`.
 *
 * ── What is here, and what is not ───────────────────────────────────
 * Exactly the widgets the fixed Overview already rendered, split back into
 * the pieces it had composed: the four KPI tiles are four metrics now, so a
 * doctor can keep "Pending requests" without "Active patients". Nothing was
 * invented to fill the catalogue.
 */

/** Every widget id, in catalogue order. */
export const DASHBOARD_WIDGET_IDS = [
  'todays-schedule',
  'notifications',
  'quick-actions',
  'metric-appointments-today',
  'metric-pending-requests',
  'metric-active-patients',
  'metric-completed-week',
  'practice-pulse',
  'appointments-trend',
  'patient-satisfaction',
  'recent-activity',
  'ai-assistant',
] as const;

export type DashboardWidgetId = (typeof DASHBOARD_WIDGET_IDS)[number];

/** Sizes and sources are the shared dashboard's (`components/patterns/dashboard`). */
export type { DashboardWidgetSize, DashboardWidgetSource };

/** Drawer grouping, in the order the drawer shows the groups. */
export const DASHBOARD_WIDGET_GROUPS = [
  { id: 'today', label: 'Today', tone: 'bg-primary-subtle text-primary' },
  { id: 'metrics', label: 'Key metrics', tone: 'bg-info-subtle text-info' },
  { id: 'analytics', label: 'Analytics', tone: 'bg-secondary-subtle text-secondary' },
  { id: 'tools', label: 'Activity & tools', tone: 'bg-surface-sunken text-text-secondary' },
] as const satisfies readonly DashboardWidgetGroupDefinition[];

export type DashboardWidgetGroup = (typeof DASHBOARD_WIDGET_GROUPS)[number]['id'];

/**
 * A data widget's source. Every data widget reads the one Overview document
 * (FE-10.4, `DashboardOverview`) through the dashboard seam, so the answer
 * depends on which adapter the seam picked: the mock's seeded figures in the
 * demo build (`sample`), and in a live build either the API's (`server`) or
 * nothing yet (`unavailable` — the widget says "Not available yet").
 *
 * The trend, satisfaction and recent activity are `server` because a route
 * serves them (RM M27.2) — on `backend` only, so against an API built from
 * `main` each still says "Not available yet" from the 404 it gets.
 */
function overviewSource(servedLive: boolean): DashboardWidgetSource {
  return selectService<DashboardWidgetSource>({
    mock: 'sample',
    http: servedLive ? 'server' : 'unavailable',
  });
}

/**
 * The Overview document as the page's single query holds it. The page asks
 * once and every widget reads its section from here — no widget imports the
 * fixture module, so a live build cannot render a seeded figure.
 */
export interface DashboardOverviewState {
  readonly data: DashboardOverview | undefined;
  readonly loading: boolean;
  /** Set when the document failed to load; the widgets offer Retry. */
  readonly error: { readonly onRetry: () => void } | undefined;
  /**
   * Reloads the document. A widget whose section is in the document's
   * `failedSections` offers it as Retry while the rest of the page renders.
   */
  readonly retry?: (() => void) | undefined;
}

/** The data the dashboard hands every widget, beside its menu. */
export interface DashboardWidgetData {
  readonly overview: DashboardOverviewState;
}

/** What every widget component receives from the dashboard. */
export type DashboardWidgetSlotProps = DashboardWidgetData & DashboardWidgetChrome;

export type DashboardWidgetDefinition = SharedWidgetDefinition<
  DashboardWidgetId,
  DashboardWidgetGroup,
  DashboardWidgetData
> & { readonly source: DashboardWidgetSource };

export const DASHBOARD_WIDGETS: readonly DashboardWidgetDefinition[] = [
  {
    id: 'todays-schedule',
    title: "Today's schedule",
    description: 'Every appointment today, with its status and who is up next.',
    icon: CalendarClock,
    size: 'wide',
    group: 'today',
    source: overviewSource(true),
    component: ScheduleSlot,
  },
  {
    id: 'notifications',
    title: 'Notifications',
    description: 'Critical results, booking requests and messages that need you.',
    icon: Bell,
    size: 'standard',
    group: 'today',
    source: overviewSource(true),
    component: NotificationsSlot,
  },
  {
    id: 'quick-actions',
    title: 'Quick actions',
    description: 'Start a prescription, record, lab order or message in one click.',
    icon: Zap,
    size: 'standard',
    group: 'today',
    source: 'none',
    component: QuickActionsWidget,
  },
  {
    id: 'metric-appointments-today',
    title: "Today's appointments",
    description: 'How many visits are booked today, and when the next one is.',
    icon: Calendar,
    size: 'compact',
    group: 'metrics',
    source: overviewSource(true),
    component: TodaysAppointmentsMetric,
  },
  {
    id: 'metric-pending-requests',
    title: 'Pending requests',
    description: 'Booking requests waiting for your decision.',
    icon: ClipboardList,
    size: 'compact',
    group: 'metrics',
    source: overviewSource(true),
    component: PendingRequestsMetric,
  },
  {
    id: 'metric-active-patients',
    title: 'Active patients',
    description: 'Patients under your care, and how many are high risk.',
    icon: Users,
    size: 'compact',
    group: 'metrics',
    source: overviewSource(true),
    component: ActivePatientsMetric,
  },
  {
    id: 'metric-completed-week',
    title: 'Completed this week',
    description: 'Visits completed this week against last week.',
    icon: CalendarCheck,
    size: 'compact',
    group: 'metrics',
    source: overviewSource(true),
    component: CompletedThisWeekMetric,
  },
  {
    id: 'practice-pulse',
    title: 'Practice pulse',
    description: 'Consultation length, response time and no-show rate.',
    icon: Gauge,
    size: 'standard',
    group: 'analytics',
    source: overviewSource(false),
    component: PracticePulseSlot,
  },
  {
    id: 'appointments-trend',
    title: 'Appointments trend',
    description: 'Completed against cancelled visits over the last 14 days.',
    icon: LineChart,
    size: 'wide',
    group: 'analytics',
    source: overviewSource(true),
    component: AppointmentsTrendSlot,
  },
  {
    id: 'patient-satisfaction',
    title: 'Patient satisfaction',
    description: 'Post-visit survey ratings for this month.',
    icon: Smile,
    size: 'standard',
    group: 'analytics',
    source: overviewSource(true),
    component: SatisfactionSlot,
  },
  {
    id: 'recent-activity',
    title: 'Recent activity',
    description: 'Your latest signed notes, issued prescriptions and released lab results.',
    icon: History,
    size: 'standard',
    group: 'tools',
    source: overviewSource(true),
    component: RecentActivitySlot,
  },
  {
    id: 'ai-assistant',
    title: 'Medora AI',
    description: 'A shortcut into the clinical assistant workspace.',
    icon: MedoraAiLogo,
    size: 'standard',
    group: 'tools',
    source: 'none',
    component: AiAssistantWidget,
  },
];

const BY_ID = new Map<string, DashboardWidgetDefinition>(
  DASHBOARD_WIDGETS.map((widget) => [widget.id, widget]),
);

export function isDashboardWidgetId(value: unknown): value is DashboardWidgetId {
  return typeof value === 'string' && BY_ID.has(value);
}

export function getDashboardWidget(id: DashboardWidgetId): DashboardWidgetDefinition {
  const widget = BY_ID.get(id);
  // Unreachable for a narrowed id; the catalogue-integrity test pins it.
  if (!widget) throw new Error(`Unknown dashboard widget: ${id}`);
  return widget;
}
