import type { DashboardSection } from '../model/dashboard-service';
import type { DashboardOverviewState, DashboardWidgetSlotProps } from '../model/widgets';

import { AppointmentsTrendWidget } from './AppointmentsTrendWidget';
import { NotificationsWidget } from './NotificationsWidget';
import { PracticePulseWidget } from './PracticePulseWidget';
import { RecentActivityWidget } from './RecentActivityWidget';
import { SatisfactionWidget } from './SatisfactionWidget';
import { ScheduleWidget } from './ScheduleWidget';

/**
 * The catalogue's data widgets, bound to the Overview document.
 *
 * The widgets themselves take their data as props (FE-10.4) and know nothing
 * about the dashboard; the catalogue needs one component per id that takes
 * only the slot props. Each binding here reads its section of
 * `overview.data`, which the dashboard seam filled from the mock or the API.
 * A section the API has no source for is `null`, and the widget renders
 * "Not available yet" — so this is the one place a section is chosen, and
 * none of it can come from the fixture module.
 */

/**
 * The document's failure, or this section's own: the M27 sections and
 * practice pulse load apart from the core, so one can fail while the KPIs beside it are fine.
 */
function sectionError(overview: DashboardOverviewState, section: DashboardSection) {
  if (overview.error) return overview.error;
  if (!overview.data?.failedSections.includes(section)) return undefined;
  const retry = overview.retry;
  return retry === undefined ? {} : { onRetry: retry };
}

export function ScheduleSlot({ overview, menu, className }: DashboardWidgetSlotProps) {
  return (
    <ScheduleWidget
      entries={overview.data?.schedule ?? []}
      loading={overview.loading}
      error={overview.error}
      menu={menu}
      className={className}
    />
  );
}

export function NotificationsSlot({ overview, menu, className }: DashboardWidgetSlotProps) {
  return (
    <NotificationsWidget
      items={overview.data?.alerts ?? []}
      loading={overview.loading}
      error={overview.error}
      menu={menu}
      className={className}
    />
  );
}

export function PracticePulseSlot({ overview, menu, className }: DashboardWidgetSlotProps) {
  return (
    <PracticePulseWidget
      statistics={overview.data?.statistics ?? null}
      loading={overview.loading}
      error={sectionError(overview, 'pulse')}
      menu={menu}
      className={className}
    />
  );
}

export function AppointmentsTrendSlot({ overview, menu, className }: DashboardWidgetSlotProps) {
  return (
    <AppointmentsTrendWidget
      series={overview.data?.trend ?? null}
      loading={overview.loading}
      error={sectionError(overview, 'trend')}
      menu={menu}
      className={className}
    />
  );
}

export function SatisfactionSlot({ overview, menu, className }: DashboardWidgetSlotProps) {
  return (
    <SatisfactionWidget
      slices={overview.data?.satisfaction ?? null}
      loading={overview.loading}
      error={sectionError(overview, 'satisfaction')}
      menu={menu}
      className={className}
    />
  );
}

export function RecentActivitySlot({ overview, menu, className }: DashboardWidgetSlotProps) {
  return (
    <RecentActivityWidget
      entries={overview.data?.activity ?? null}
      loading={overview.loading}
      error={sectionError(overview, 'activity')}
      menu={menu}
      className={className}
    />
  );
}
