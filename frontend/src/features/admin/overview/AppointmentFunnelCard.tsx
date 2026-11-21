import { Filter } from 'lucide-react';

import { Skeleton } from '@/components/feedback';

import { AsyncSection, Panel } from '../components/primitives';

import type { AppointmentFunnel, OverviewWidgetSurface } from './overview.types';

/**
 * Row 3 centre (§3.1 · spec §4.6) — requested → confirmed → completed over the
 * last seven days, with the two rates beside it.
 *
 * The denominator is printed rather than implied. Both rates and the funnel's
 * first stage come from one 7-day window (`summarize()`), so "12% cancelled ·
 * 6% no-show" can be read together; and when that window is empty the card
 * says so instead of showing two confident zeros, which would read as a clean
 * week rather than as no week at all.
 *
 * Its data is derived from the ADM-05 oversight document, not from the signals
 * service the other two Row-3 cards read — so it carries that document's query
 * state, and a telemetry outage leaves this card standing.
 */
export interface AppointmentFunnelCardProps extends OverviewWidgetSurface {
  funnel: AppointmentFunnel;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

export function AppointmentFunnelCard({
  funnel,
  isLoading,
  isError,
  onRetry,
  menu,
  className,
}: AppointmentFunnelCardProps) {
  return (
    <Panel
      title="Appointment funnel"
      description="Last 7 days"
      icon={Filter}
      tone="success"
      menu={menu}
      className={className}
    >
      <AsyncSection
        isLoading={isLoading}
        isError={isError}
        onRetry={onRetry}
        skeleton={<FunnelSkeleton />}
      >
        {funnel.window7dTotal === 0 ? (
          <p className="text-body-sm text-text-secondary">
            No appointments in the last 7 days — no basis to quote a rate.
          </p>
        ) : (
          <Stages funnel={funnel} />
        )}
      </AsyncSection>
    </Panel>
  );
}

function Stages({ funnel }: { funnel: AppointmentFunnel }) {
  // Bars are drawn against the widest stage, not against the window total, so
  // the top stage always fills the track and the drop-off is what varies.
  const top = funnel.stages[0]?.value ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2.5">
        {funnel.stages.map((stage) => (
          <li key={stage.label} className="flex items-center gap-3">
            <span className="w-20 shrink-0 text-caption text-text-tertiary">{stage.label}</span>
            <span
              aria-hidden="true"
              className="h-2 flex-1 overflow-hidden rounded-pill bg-surface-sunken"
            >
              <span
                className="block h-full rounded-pill bg-success"
                style={{
                  width: `${String(top === 0 ? 0 : Math.round((stage.value / top) * 100))}%`,
                }}
              />
            </span>
            <span className="w-8 shrink-0 text-end text-body-sm font-medium text-text-primary tabular-nums">
              {stage.value}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-caption text-text-tertiary tabular-nums">
        {`${String(funnel.cancellationRate7d)}% cancelled · ${String(funnel.noShowRate7d)}% no-show, of ${String(funnel.window7dTotal)} appointments`}
      </p>
    </div>
  );
}

/** Three stage rows and the rates line, in the rhythm the real ones use. */
function FunnelSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2.5">
        {['requested', 'confirmed', 'completed'].map((stage) => (
          <Skeleton key={stage} className="h-5 w-full rounded-surface" />
        ))}
      </div>
      <Skeleton className="h-4 w-48 rounded-surface" />
    </div>
  );
}
