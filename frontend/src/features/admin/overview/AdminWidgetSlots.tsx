import { CalendarClock, Stethoscope, UsersRound } from 'lucide-react';

import { ActionQueueCard } from './ActionQueueCard';
import { AdminActivityFeed, SignupsFeed } from './ActivityFeeds';
import { AppointmentFunnelCard } from './AppointmentFunnelCard';
import { ActiveUsersMetric, DocumentMetric } from './OverviewMetricWidgets';
import { PlatformActivityChart } from './PlatformActivityChart';
import { StorageUsageCard } from './StorageUsageCard';
import { SystemHealthCard } from './SystemHealthCard';
import type { AdminWidgetSlotProps } from './widgets';

/**
 * The catalogue's widgets, bound to what the page read.
 *
 * The cards themselves take their data and query state as props and know
 * nothing about the dashboard; the catalogue needs one component per id that
 * takes only the slot props. Each binding here picks its section of
 * `overview` and — the part that matters — the query state of exactly the
 * sources that widget derives from, which is what keeps a telemetry outage
 * from taking down the funnel, or an audit outage the signups feed (§3.1:
 * the widgets do not wait on each other).
 */

export function TotalDoctorsSlot({ overview, menu, className }: AdminWidgetSlotProps) {
  return (
    <DocumentMetric
      label="Total doctors"
      icon={Stethoscope}
      tone="primary"
      value={overview.kpis.verifiedDoctors}
      hint={`${String(overview.kpis.pendingVerifications)} pending verification`}
      {...overview.documents}
      menu={menu}
      className={className}
    />
  );
}

export function TotalPatientsSlot({ overview, menu, className }: AdminWidgetSlotProps) {
  return (
    <DocumentMetric
      label="Total patients"
      icon={UsersRound}
      tone="info"
      value={overview.kpis.totalPatients}
      hint={`${String(overview.kpis.activePatients)} active`}
      {...overview.documents}
      menu={menu}
      className={className}
    />
  );
}

export function AppointmentsTodaySlot({ overview, menu, className }: AdminWidgetSlotProps) {
  return (
    <DocumentMetric
      label="Appointments today"
      icon={CalendarClock}
      tone="success"
      value={overview.kpis.appointmentsToday}
      hint={`${String(overview.kpis.utilizationPercent)}% utilization`}
      {...overview.documents}
      menu={menu}
      className={className}
    />
  );
}

export function ActiveUsersSlot({ overview, menu, className }: AdminWidgetSlotProps) {
  return <ActiveUsersMetric activeUsers={overview.activeUsers} menu={menu} className={className} />;
}

export function ActionQueueSlot({ overview, menu, className }: AdminWidgetSlotProps) {
  return (
    <ActionQueueCard
      rows={overview.queue}
      {...overview.queueState}
      menu={menu}
      className={className}
    />
  );
}

export function AppointmentFunnelSlot({ overview, menu, className }: AdminWidgetSlotProps) {
  return (
    <AppointmentFunnelCard
      funnel={overview.funnel}
      {...overview.oversight}
      menu={menu}
      className={className}
    />
  );
}

export function PlatformActivitySlot({ overview, menu, className }: AdminWidgetSlotProps) {
  return (
    <PlatformActivityChart
      series={overview.activity}
      range={overview.range}
      onRangeChange={overview.onRangeChange}
      {...overview.signals}
      menu={menu}
      className={className}
    />
  );
}

export function SystemHealthSlot({ overview, menu, className }: AdminWidgetSlotProps) {
  return (
    <SystemHealthCard
      services={overview.services}
      now={overview.now}
      {...overview.signals}
      menu={menu}
      className={className}
    />
  );
}

export function StorageUsageSlot({ overview, menu, className }: AdminWidgetSlotProps) {
  return (
    <StorageUsageCard
      platform={overview.platform}
      {...overview.platformState}
      menu={menu}
      className={className}
    />
  );
}

export function AdminActivitySlot({ overview, menu, className }: AdminWidgetSlotProps) {
  return (
    <AdminActivityFeed
      events={overview.auditEvents}
      {...overview.audit}
      menu={menu}
      className={className}
    />
  );
}

export function RecentSignupsSlot({ overview, menu, className }: AdminWidgetSlotProps) {
  return (
    <SignupsFeed
      entries={overview.signups}
      {...overview.accounts}
      menu={menu}
      className={className}
    />
  );
}
