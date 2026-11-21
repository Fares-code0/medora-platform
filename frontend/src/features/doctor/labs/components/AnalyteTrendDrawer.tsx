import { useMemo, useState } from 'react';

import { BarChart3, Table2 } from 'lucide-react';

import { BG_SOLID } from '@/components/charts';
import { Alert, EmptyState, ErrorState, Spinner } from '@/components/feedback';
import { Stack } from '@/components/layout';
import { StatusBadge } from '@/components/patterns';
import { Button, Chip, Drawer } from '@/components/ui';
import { cn } from '@/utils/cn';
import { formatDate } from '@/utils/dates';

import { useLabTrendsQuery } from '../api/useLabTestsQuery';
import {
  MAX_TREND_SERIES,
  toneForSeries,
  trendBand,
  trendTableRows,
  trendableAnalytes,
  type AnalyteTrend,
} from '../model/trends';
import type { LabTest } from '../model/types';
import { labService } from '../service';

import { AnalyteTrendChart } from './trend/AnalyteTrendChart';

/**
 * The trend view (D-13, UX §2.6) — "from any analyte, View trend opens a line
 * chart of that analyte over time for that patient (reference range as a
 * shaded band, results as points, hoverable, view-as-table toggle). Multiple
 * analytes can be overlaid (max 3) with distinct series colors."
 *
 * A drawer rather than a page, because §2.6's whole design is that the result
 * you came from stays behind it.
 *
 * The chips are the analytes the loaded orders show; the points are the
 * patient's whole released history for them, from the port (API §8.8) — not
 * whichever slice of orders the screen behind the drawer happened to load.
 *
 * Two honesty notes the UI carries on screen rather than in a comment:
 *
 * - **A single point is not a trend.** One result plots as one dot with no
 *   line, and the drawer says the series has one point rather than drawing
 *   something that looks like a flat trajectory.
 * - **The band disappears when it would be a lie.** Overlaying analytes with
 *   different reference ranges leaves one y-axis and three ranges, so
 *   `trendBand` returns null and a note explains that the shaded band is off
 *   for mixed units — rather than shading whichever range happened to be
 *   first.
 */

export interface AnalyteTrendDrawerProps {
  open: boolean;
  onClose: () => void;
  /** The loaded tests, which offer the analytes; the model narrows to this patient. */
  tests: readonly LabTest[];
  patientId: string;
  patientName: string;
  /** Pre-selected analyte, from the "View trend" the doctor clicked. */
  initialAnalyte: string | null;
}

export function AnalyteTrendDrawer({
  open,
  onClose,
  tests,
  patientId,
  patientName,
  initialAnalyte,
}: AnalyteTrendDrawerProps) {
  const available = useMemo(
    () => trendableAnalytes(tests, patientId),
    [tests, patientId],
  );

  const [selected, setSelected] = useState<readonly string[]>([]);
  const [asTable, setAsTable] = useState(false);

  /*
   * The selection follows the analyte the doctor opened the drawer from. Held
   * as derived state rather than an effect: an effect would fight a user who
   * deselects the initial analyte, re-adding it on the next render.
   */
  const [seededFor, setSeededFor] = useState<string | null>(null);
  const seedKey = `${patientId}|${initialAnalyte ?? ''}`;
  if (open && seededFor !== seedKey) {
    setSeededFor(seedKey);
    setSelected(
      initialAnalyte !== null && available.some((entry) => entry.analyte === initialAnalyte)
        ? [initialAnalyte]
        : available.slice(0, 1).map((entry) => entry.analyte),
    );
  }

  const trendsQuery = useLabTrendsQuery(patientId, selected, { enabled: open });
  const served = trendsQuery.data;
  const trends = useMemo(
    (): readonly AnalyteTrend[] =>
      (served?.series ?? []).map((series) => {
        // Coloured by the slot the doctor put it in, so a series keeps its
        // colour when another one turns out to have nothing to plot.
        const slot = selected.findIndex(
          (analyte) => analyte.toLowerCase() === series.analyte.toLowerCase(),
        );
        return { ...series, tone: toneForSeries(Math.max(slot, 0)) };
      }),
    [served, selected],
  );
  const unplotted = served?.empty ?? [];

  const band = trendBand(trends);
  const rows = trendTableRows(trends);
  const atCapacity = selected.length >= MAX_TREND_SERIES;

  const toggle = (analyte: string) =>
    setSelected((previous) => {
      if (previous.includes(analyte)) return previous.filter((entry) => entry !== analyte);
      if (previous.length >= MAX_TREND_SERIES) return previous;
      return [...previous, analyte];
    });

  const onlyOnePoint = trends.length > 0 && trends.every((trend) => trend.points.length < 2);

  return (
    <Drawer open={open} onClose={onClose} title={`Analyte trend — ${patientName}`} size="lg">
      <Stack gap={5}>
        {available.length === 0 ? (
          <EmptyState
            icon={BarChart3}
            tone="info"
            title="No numeric results to trend"
            description={`${patientName} has no released numeric analytes yet, so there is nothing to plot over time.`}
          />
        ) : (
          <>
            <div>
              <p className="text-body-sm font-medium text-text-primary">Analytes</p>
              <p className="text-caption text-text-tertiary">
                Overlay up to {MAX_TREND_SERIES}. Each carries its own colour in the chart.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {available.map((entry) => {
                  const active = selected.includes(entry.analyte);
                  return (
                    <Chip
                      key={entry.analyte}
                      label={`${entry.analyte} · ${String(entry.pointCount)}`}
                      selected={active}
                      disabled={!active && atCapacity}
                      onSelect={() => toggle(entry.analyte)}
                    />
                  );
                })}
              </div>
            </div>

            {selected.length === 0 ? (
              <Alert variant="info" title="Choose an analyte">
                Pick one above to plot its history for this patient.
              </Alert>
            ) : trendsQuery.isPending ? (
              <div className="flex items-center justify-center gap-3 py-10 text-body-sm text-text-secondary">
                <Spinner />
                Loading this patient&apos;s results…
              </div>
            ) : trendsQuery.isError ? (
              <ErrorState
                title="Couldn't load this trend"
                description="The results could not be read. Nothing is plotted rather than a partial history."
                error={trendsQuery.error}
                onRetry={() => void trendsQuery.refetch()}
              />
            ) : trends.length === 0 ? (
              <Alert variant="info" title="Nothing to plot">
                {`No released numeric result for ${unplotted.join(', ')}.`}
              </Alert>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {/* The legend is read-only: the chips above are the one
                      place a series is added or removed, and a second toggle
                      for the same thing is how two controls come to disagree. */}
                  <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                    {trends.map((trend) => (
                      <li
                        key={trend.analyte}
                        className="flex items-center gap-2 text-caption text-text-secondary"
                      >
                        <span
                          aria-hidden="true"
                          className={cn('h-2.5 w-2.5 shrink-0 rounded-pill', BG_SOLID[trend.tone])}
                        />
                        {trend.analyte}
                        {trend.unit ? ` (${trend.unit})` : ''}
                      </li>
                    ))}
                  </ul>
                  <Button
                    variant="secondary"
                    size="sm"
                    leadingIcon={asTable ? BarChart3 : Table2}
                    onClick={() => setAsTable((previous) => !previous)}
                    aria-pressed={asTable}
                  >
                    {asTable ? 'View as chart' : 'View as table'}
                  </Button>
                </div>

                {band === null ? (
                  <p className="text-caption text-text-tertiary">
                    {trends.length > 1
                      ? 'The reference band is hidden: the selected analytes do not share one reference range, and a single shaded band would belong to only one of them.'
                      : 'This analyte has no numeric reference range, so no band is drawn.'}
                  </p>
                ) : null}

                {unplotted.length > 0 ? (
                  <p className="text-caption text-text-tertiary">
                    {`No released numeric result for ${unplotted.join(', ')}, so it is not plotted.`}
                  </p>
                ) : null}

                {onlyOnePoint ? (
                  <Alert variant="info" title="Only one result so far">
                    A single point is plotted without a line — there is no trajectory to draw
                    until this patient has a second result for it.
                  </Alert>
                ) : null}

                {asTable ? (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[28rem] border-collapse text-body-sm">
                      <caption className="sr-only">
                        {trends.map((trend) => trend.analyte).join(', ')} over time for{' '}
                        {patientName}
                      </caption>
                      <thead>
                        <tr className="border-b border-border text-caption font-semibold uppercase tracking-wider text-text-tertiary">
                          <th scope="col" className="py-2 pe-4 text-start">
                            Date
                          </th>
                          {trends.map((trend) => (
                            <th key={trend.analyte} scope="col" className="py-2 pe-4 text-start">
                              {trend.analyte}
                              {trend.unit ? ` (${trend.unit})` : ''}
                            </th>
                          ))}
                          <th scope="col" className="py-2 text-start">
                            Lab ID
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr key={row.at} className="border-b border-border last:border-b-0">
                            <th
                              scope="row"
                              className="whitespace-nowrap py-2.5 pe-4 text-start font-medium text-text-primary"
                            >
                              {formatDate(row.at)}
                            </th>
                            {row.cells.map((cell) => (
                              <td key={cell.analyte} className="py-2.5 pe-4 tabular-nums">
                                {cell.value === null ? (
                                  <span className="text-text-tertiary">—</span>
                                ) : (
                                  <span className="flex items-center gap-2">
                                    {cell.value}
                                    {cell.flagLabel !== null && cell.flagLabel !== 'Normal' ? (
                                      <StatusBadge
                                        status={
                                          cell.flagLabel.startsWith('Critical')
                                            ? 'critical'
                                            : 'expiring'
                                        }
                                        label={cell.flagLabel}
                                      />
                                    ) : null}
                                  </span>
                                )}
                              </td>
                            ))}
                            <td className="py-2.5 font-mono text-text-tertiary">{row.labId}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <AnalyteTrendChart
                    trends={trends}
                    band={band}
                    ariaLabel={`${trends
                      .map((trend) => trend.analyte)
                      .join(', ')} over time for ${patientName}. Switch to the table view for the values.`}
                  />
                )}

                <p className="text-caption text-text-tertiary">
                  {labService.capabilities.transmits
                    ? "Points are this patient's released results from completed orders, as the laboratory service reports them."
                    : "Points come from this patient's released results in this demo dataset. No laboratory system is connected."}
                </p>
              </>
            )}
          </>
        )}
      </Stack>
    </Drawer>
  );
}
