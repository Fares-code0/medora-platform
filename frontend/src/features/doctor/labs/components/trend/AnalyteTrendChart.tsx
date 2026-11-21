import { TONE_CLASSES } from '@/components/charts';
import { cn } from '@/utils/cn';
import { formatDate } from '@/utils/dates';

import { trendDomain, type AnalyteTrend, type TrendBand } from '../../model/trends';
import { isCriticalFlag, LAB_RESULT_FLAG_META } from '../../model/types';

/**
 * The analyte trend chart (D-13, UX §2.6).
 *
 * **Why this is not `components/charts/LineAreaChart`.** That chart anchors
 * its y-axis at zero, which is right for the counts every other screen plots
 * and wrong here: a potassium series whose reference range is 3.5–5.1 drawn
 * from zero is a flat line across the top third of the frame, and the one
 * thing a reader needs to see — where the value sits relative to the range —
 * is compressed into nothing. It also has no concept of a reference band. So
 * this is a feature-local chart with a windowed domain (`trendDomain`) rather
 * than a shared primitive bent out of shape; it still takes its series
 * colours from the shared palette, so it stays theme-aware and consistent
 * with every other chart in the app.
 *
 * **The band is the message.** It is drawn first, behind everything, in the
 * success hue at low opacity, with its two bounds labelled — so "inside the
 * range" is a position, not a colour the reader has to decode.
 *
 * **Points carry the flag, lines carry the series.** A marker outside the
 * range is filled in its flag's hue and a critical one is drawn larger with a
 * ring; the line stays the series colour throughout. Colour is never the only
 * channel: every point has a native `<title>` naming the value, its flag and
 * its date, the axis labels state the bounds, and the drawer's table toggle is
 * the full non-visual equivalent (P6).
 */

const WIDTH = 640;
const HEIGHT = 260;
const PADDING = { top: 16, right: 16, bottom: 34, left: 52 } as const;

const PLOT = {
  x0: PADDING.left,
  x1: WIDTH - PADDING.right,
  y0: PADDING.top,
  y1: HEIGHT - PADDING.bottom,
  get width() {
    return this.x1 - this.x0;
  },
  get height() {
    return this.y1 - this.y0;
  },
};

/** Four evenly spaced ticks across the window, rounded for legibility. */
function ticksFor(min: number, max: number): readonly number[] {
  const span = max - min;
  const decimals = span < 2 ? 2 : span < 20 ? 1 : 0;
  return Array.from({ length: 5 }, (_, index) =>
    Number((min + (span * index) / 4).toFixed(decimals)),
  );
}

function formatValue(value: number, span: number): string {
  return value.toFixed(span < 2 ? 2 : span < 20 ? 1 : 0);
}

export interface AnalyteTrendChartProps {
  trends: readonly AnalyteTrend[];
  band: TrendBand | null;
  /** Announced as the chart's accessible name. */
  ariaLabel: string;
}

export function AnalyteTrendChart({ trends, band, ariaLabel }: AnalyteTrendChartProps) {
  const domain = trendDomain(trends, band);
  const span = domain.max - domain.min;

  /* Every instant any series has a point at, so the x-axis is shared. */
  const instants = Array.from(
    new Set(trends.flatMap((trend) => trend.points.map((point) => point.at))),
  ).sort((a, b) => a.localeCompare(b));

  const xAt = (at: string): number => {
    if (instants.length <= 1) return PLOT.x0 + PLOT.width / 2;
    return PLOT.x0 + (instants.indexOf(at) / (instants.length - 1)) * PLOT.width;
  };
  const yAt = (value: number): number =>
    PLOT.y1 - ((value - domain.min) / (span || 1)) * PLOT.height;

  const ticks = ticksFor(domain.min, domain.max);

  return (
    <svg
      viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
      className="h-auto w-full"
      role="img"
      aria-label={ariaLabel}
    >
      {/* The reference band, behind everything else. */}
      {band !== null ? (
        <g>
          <rect
            x={PLOT.x0}
            y={yAt(band.high)}
            width={PLOT.width}
            height={Math.max(0, yAt(band.low) - yAt(band.high))}
            className="fill-success"
            opacity={0.12}
          />
          {[band.low, band.high].map((bound) => (
            <line
              key={bound}
              x1={PLOT.x0}
              x2={PLOT.x1}
              y1={yAt(bound)}
              y2={yAt(bound)}
              className="stroke-success"
              strokeWidth={1}
              strokeDasharray="4 3"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <text
            x={PLOT.x1}
            y={yAt(band.high) - 4}
            textAnchor="end"
            className="fill-success text-micro"
          >
            Reference {band.text}
            {band.unit ? ` ${band.unit}` : ''}
          </text>
        </g>
      ) : null}

      {/* Y grid + tick labels. */}
      {ticks.map((tick) => (
        <g key={tick}>
          <line
            x1={PLOT.x0}
            x2={PLOT.x1}
            y1={yAt(tick)}
            y2={yAt(tick)}
            className="stroke-border"
            strokeWidth={1}
            strokeDasharray="3 3"
            vectorEffect="non-scaling-stroke"
          />
          <text
            x={PLOT.x0 - 8}
            y={yAt(tick) + 3}
            textAnchor="end"
            className="fill-text-tertiary text-micro"
          >
            {formatValue(tick, span)}
          </text>
        </g>
      ))}

      {/* X labels — first, middle and last only; the table carries them all. */}
      {[0, Math.floor((instants.length - 1) / 2), instants.length - 1]
        .filter((index, position, all) => index >= 0 && all.indexOf(index) === position)
        .map((index) => {
          const at = instants[index];
          if (at === undefined) return null;
          return (
            <text
              key={at}
              x={xAt(at)}
              y={PLOT.y1 + 20}
              textAnchor={index === 0 ? 'start' : index === instants.length - 1 ? 'end' : 'middle'}
              className="fill-text-tertiary text-micro"
            >
              {formatDate(at)}
            </text>
          );
        })}

      {/* Series. */}
      {trends.map((trend) => {
        const tone = TONE_CLASSES[trend.tone];
        const path = trend.points
          .map(
            (point, index) =>
              `${index === 0 ? 'M' : 'L'} ${xAt(point.at).toFixed(2)} ${yAt(point.value).toFixed(2)}`,
          )
          .join(' ');

        return (
          <g key={trend.analyte}>
            <path
              d={path}
              fill="none"
              className={tone.stroke}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            {trend.points.map((point) => {
              const critical = isCriticalFlag(point.flag);
              const abnormal = point.flag !== 'normal';
              return (
                <circle
                  key={`${trend.analyte}-${point.labId}`}
                  cx={xAt(point.at)}
                  cy={yAt(point.value)}
                  r={critical ? 6 : 4}
                  className={cn(
                    abnormal ? 'fill-error' : tone.fill,
                    critical && 'stroke-error',
                  )}
                  strokeWidth={critical ? 2 : 0}
                  // Native tooltip — the same affordance every other chart in
                  // the app uses, and one that needs no hover state to reach.
                >
                  <title>
                    {`${trend.analyte} ${formatValue(point.value, span)}${
                      trend.unit ? ` ${trend.unit}` : ''
                    } — ${LAB_RESULT_FLAG_META[point.flag].label}, ${formatDate(point.at)} (${point.labId})`}
                  </title>
                </circle>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
