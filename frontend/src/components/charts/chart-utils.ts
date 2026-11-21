/**
 * Chart geometry helpers — pure math shared by the SVG charts. Charts use a
 * fixed viewBox coordinate space and scale responsively via CSS (width:100%,
 * `preserveAspectRatio`). Colors are never computed here — they come from
 * design-system token utility classes (see palette.ts). This mirrors the
 * KpiWidget Sparkline precedent: hand-rolled token-styled SVG, no chart lib.
 */

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Round a max value up to a friendly axis bound (e.g. 194 → 200). */
export function niceCeil(max: number): number {
  if (max <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(max)));
  const normalized = max / magnitude;
  const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return nice * magnitude;
}

/**
 * Evenly spaced y-axis tick values from 0 to `max` (inclusive).
 *
 * De-duplicated, because the ticks are rounded to whole numbers and a small
 * `max` makes several of them land on the same one: an axis topping out at 1
 * over four steps rounds to `0, 0, 1, 1, 1`. That draws a gridline and its
 * label twice at each end, and — since both `LineAreaChart` and `BarChart` key
 * their grid rows on the tick value — hands React two children with the same
 * key, which it warns about and which leaves the axis at the mercy of
 * reconciliation order.
 *
 * Removing duplicates rather than choosing a different step keeps every axis
 * that was already correct byte-for-byte the same: at `max` of 200 the ticks
 * are still 0, 50, 100, 150, 200. Only the collapsed ones change, and they
 * change into the axis a reader of a 0-to-1 chart expects anyway.
 */
export function axisTicks(max: number, count = 4): readonly number[] {
  const step = max / count;
  const ticks = Array.from({ length: count + 1 }, (_, i) => Math.round(step * i));
  return [...new Set(ticks)];
}

/** Straight-segment line path through points. */
export function linePath(points: readonly Point[]): string {
  return points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(2)},${p.y.toFixed(2)}`)
    .join(' ');
}

/** Area path: the line, closed down to the baseline. */
export function areaPath(points: readonly Point[], baselineY: number): string {
  if (points.length === 0) return '';
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return '';
  return `${linePath(points)} L${last.x.toFixed(2)},${baselineY.toFixed(2)} L${first.x.toFixed(
    2,
  )},${baselineY.toFixed(2)} Z`;
}

export function polarToXY(cx: number, cy: number, radius: number, angleDeg: number): Point {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
}

/**
 * SVG path for a pie/donut segment. `innerRadius = 0` yields a pie slice;
 * a positive inner radius yields a donut arc.
 */
export function arcPath(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number,
): string {
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  const outerStart = polarToXY(cx, cy, outerRadius, startAngle);
  const outerEnd = polarToXY(cx, cy, outerRadius, endAngle);

  if (innerRadius <= 0) {
    return [
      `M${cx},${cy}`,
      `L${outerStart.x.toFixed(2)},${outerStart.y.toFixed(2)}`,
      `A${outerRadius},${outerRadius} 0 ${largeArc} 1 ${outerEnd.x.toFixed(2)},${outerEnd.y.toFixed(2)}`,
      'Z',
    ].join(' ');
  }

  const innerStart = polarToXY(cx, cy, innerRadius, endAngle);
  const innerEnd = polarToXY(cx, cy, innerRadius, startAngle);
  return [
    `M${outerStart.x.toFixed(2)},${outerStart.y.toFixed(2)}`,
    `A${outerRadius},${outerRadius} 0 ${largeArc} 1 ${outerEnd.x.toFixed(2)},${outerEnd.y.toFixed(2)}`,
    `L${innerStart.x.toFixed(2)},${innerStart.y.toFixed(2)}`,
    `A${innerRadius},${innerRadius} 0 ${largeArc} 0 ${innerEnd.x.toFixed(2)},${innerEnd.y.toFixed(2)}`,
    'Z',
  ].join(' ');
}

export const CHART_WIDTH = 640;
export const CHART_HEIGHT = 260;
export const CHART_PADDING = { top: 16, right: 16, bottom: 32, left: 44 } as const;

export interface PlotArea {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Widest an x-axis tick may be before its neighbour is at risk, in viewBox
 * units. `--text-micro` is 10px and a date label ("Aug 30") runs ~38px at that
 * size, so 44 buys a little air either side.
 */
const X_LABEL_WIDTH = 44;

/**
 * Which x positions may carry a tick label.
 *
 * Charts used to label EVERY point. That is fine for the seven-day series they
 * were built against and unreadable at thirty: the admin overview's activity
 * chart drew thirty "Aug N" labels into 580 units and they ran together into a
 * grey smear, which is text overlapping text, not a dense axis.
 *
 * So labels are thinned by a stride wide enough that neighbours cannot touch.
 * The FIRST and LAST are always kept — an axis whose ends are unlabelled has
 * lost the thing a reader actually needs from it (where the series starts and
 * where it ends) — and the stride is chosen so the final gap is never smaller
 * than the others, which is what produces a last label jammed against its
 * neighbour.
 */
export function xLabelIndexes(count: number, width = CHART_WIDTH - 60): readonly number[] {
  if (count <= 1) return count === 1 ? [0] : [];

  // Derive the stride from the spacing the points actually have, rather than
  // from a label budget. A budget answers "how many fit" and still allows two
  // neighbours to land 40 units apart when the last index is appended instead
  // of stepped onto; this way the spacing guarantee is the definition.
  const stepX = width / (count - 1);
  const stride = Math.max(1, Math.ceil(X_LABEL_WIDTH / stepX));

  const kept: number[] = [];
  for (let i = 0; i < count - 1; i += stride) kept.push(i);
  // The last point is appended, not stepped onto, so its gap is the one that
  // can come up short. Give it room by dropping picks until it has a full
  // stride to itself — a wider final gap reads as an axis; a cramped one
  // reads as two labels colliding, which is the defect this exists to avoid.
  while (kept.length > 1 && count - 1 - (kept[kept.length - 1] ?? 0) < stride) kept.pop();
  kept.push(count - 1);
  return kept;
}

export function plotArea(
  width = CHART_WIDTH,
  height = CHART_HEIGHT,
  padding = CHART_PADDING,
): PlotArea {
  return {
    x0: padding.left,
    y0: padding.top,
    x1: width - padding.right,
    y1: height - padding.bottom,
    width: width - padding.left - padding.right,
    height: height - padding.top - padding.bottom,
  };
}
