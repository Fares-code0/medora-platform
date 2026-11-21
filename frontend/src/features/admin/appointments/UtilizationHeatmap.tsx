import { CalendarRange } from 'lucide-react';

import { Tooltip } from '@/components/ui';
import { cn } from '@/utils/cn';

import { Overline, Panel } from '../components/primitives';

import {
  buildHeatmap,
  HEATMAP_HOURS,
  HEATMAP_MIN_APPOINTMENTS,
  HEATMAP_WEEKDAYS,
} from './oversight';
import type { OversightAppointment } from './oversight.types';

/**
 * Hour × weekday utilization (ADM-05 · UX §3.5, the optional heatmap).
 *
 * Capacity planning, not case management: it answers "when is the clinic
 * under pressure", so it is driven by whatever the toolbar currently has
 * filtered rather than by the whole dataset. Intensity is relative to the
 * busiest cell in the same matrix — an absolute scale would render every
 * honest week as uniformly empty.
 *
 * Colour is never the only channel: each cell carries its count as text for
 * anyone who cannot separate the shades (DS §2.4).
 */

/**
 * Intensity → cell fill + the foreground that stays legible on it.
 *
 * Four steps, not a continuous ramp, and the ramp stops climbing where the
 * text would stop being readable. The cells used to set element-level
 * `opacity`, which faded the COUNT along with the fill — at low intensity the
 * digits washed out to invisible in both themes, which is precisely the
 * channel §2.4 requires them to keep. Alpha belongs on the background alone.
 *
 * Every pair below clears WCAG AA in BOTH themes. That is what caps the ramp:
 * --color-primary is dark in light mode and LIGHT in dark mode, so a mid-ramp
 * fill flips which foreground works. Measured (light / dark):
 *   /15  + text-primary  15.5 / 7.3
 *   /30  + text-primary  13.0 / 4.9
 *   full + text-inverse   9.7 / 8.4
 * A /50…/80 step has no foreground that passes in both, which is why there
 * isn't one.
 */
const INTENSITY_STEPS: readonly { readonly upTo: number; readonly className: string }[] = [
  { upTo: 0.34, className: 'bg-primary/15 text-text-primary' },
  { upTo: 0.67, className: 'bg-primary/30 text-text-primary' },
  { upTo: Infinity, className: 'bg-primary text-text-inverse' },
];

function intensityClasses(intensity: number): string {
  return (
    INTENSITY_STEPS.find((step) => intensity <= step.upTo)?.className ??
    'bg-primary text-text-inverse'
  );
}
export function UtilizationHeatmap({
  appointments,
}: {
  appointments: readonly OversightAppointment[];
}) {
  const { cells, peak, total } = buildHeatmap(appointments);

  if (total < HEATMAP_MIN_APPOINTMENTS) {
    return (
      <Panel title="Utilization" icon={CalendarRange} tone="info">
        <p className="py-6 text-center text-body-sm text-text-secondary">
          Not enough data for this range.
        </p>
      </Panel>
    );
  }

  return (
    <Panel
      title="Utilization"
      description={`Appointments per hour · busiest slot holds ${String(peak)}`}
      icon={CalendarRange}
      tone="info"
    >
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-1" aria-label="Hourly utilization by weekday">
          <thead>
            <tr>
              <th scope="col" className="w-12 text-start">
                <span className="sr-only">Weekday</span>
              </th>
              {HEATMAP_HOURS.map((hour) => (
                <th key={hour} scope="col" className="text-center">
                  <Overline>{String(hour).padStart(2, '0')}</Overline>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {HEATMAP_WEEKDAYS.map((weekday, index) => (
              <tr key={weekday}>
                <th scope="row" className="pe-2 text-start">
                  <Overline>{weekday}</Overline>
                </th>
                {HEATMAP_HOURS.map((hour) => {
                  const cell = cells.find((c) => c.weekday === index && c.hour === hour);
                  const count = cell?.count ?? 0;
                  const intensity = cell?.intensity ?? 0;
                  const label = `${weekday} ${String(hour).padStart(2, '0')}:00 — ${String(count)} ${count === 1 ? 'appointment' : 'appointments'}`;
                  return (
                    <td key={hour} className="p-0">
                      <Tooltip content={label}>
                        <div
                          className={cn(
                            'flex h-8 min-w-8 items-center justify-center rounded-surface text-caption font-semibold tabular-nums',
                            count === 0
                              ? 'border border-border text-text-tertiary'
                              : cn('border border-transparent', intensityClasses(intensity)),
                          )}
                        >
                          <span aria-hidden="true">{count === 0 ? '' : count}</span>
                          <span className="sr-only">{label}</span>
                        </div>
                      </Tooltip>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
