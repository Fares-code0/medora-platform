import { cn } from '@/utils/cn';

import { StatisticCard, type StatisticCardProps } from './StatisticCard';

/**
 * KPIWidget — UX P5 KPI card.
 * StatisticCard plus an optional 32px sparkline; the whole card can link
 * to its detail page (`href`). Values use tabular figures and never
 * animate (DS §9.4 — a count-up is misleading in clinical context).
 */
export interface KpiWidgetProps extends StatisticCardProps {
  /** Recent series for the 32px sparkline (rendered with the primary token). */
  sparkline?: readonly number[] | undefined;
  /** Whole-card link to the KPI's detail page. */
  href?: string | undefined;
  /** Accessible name for the link; defaults to "View {label} details". */
  linkLabel?: string | undefined;
}

/**
 * The 96×32 trend line KPI cards draw, in the primary token. Decorative —
 * the figure beside it carries the meaning — so it is hidden from assistive
 * technology. Exported for the Doctor Overview's metric widgets, which keep
 * this card's content on a different shell.
 */
export function Sparkline({
  points,
  className,
}: {
  points: readonly number[];
  className?: string | undefined;
}) {
  if (points.length < 2) return null;
  const width = 96;
  const height = 32;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = width / (points.length - 1);
  const path = points
    .map((point, index) => {
      const x = index * step;
      const y = height - 2 - ((point - min) / range) * (height - 4);
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${String(width)} ${String(height)}`}
      className={cn('h-8 w-24 text-primary', className)}
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}

export function KpiWidget({ sparkline, href, linkLabel, ...statProps }: KpiWidgetProps) {
  const card = (
    <div className="relative">
      <StatisticCard {...statProps} />
      {sparkline && !statProps.loading ? (
        <div className="pointer-events-none absolute bottom-4 end-4">
          <Sparkline points={sparkline} className="mt-2" />
        </div>
      ) : null}
    </div>
  );

  if (href === undefined || statProps.loading) return card;

  return (
    <a
      href={href}
      aria-label={linkLabel ?? `View ${statProps.label} details`}
      className="block rounded-surface transition-transform duration-base ease-out hover:-translate-y-px [&>div>div]:hover:shadow-popover"
    >
      {card}
    </a>
  );
}
