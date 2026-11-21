import type { ReactNode } from 'react';

import { Minus, TrendingDown, TrendingUp, type LucideIcon } from 'lucide-react';

import { Skeleton } from '@/components/feedback/Skeleton';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { cn } from '@/utils/cn';

/**
 * StatisticCard — DS §8.18 metric/KPI card variant.
 * Overline label · 30px/700 value in tabular figures (values never
 * count up — DS §9.4) · optional delta badge with direction arrow and
 * accessible text ("up 12% vs last week").
 */
export interface StatisticDelta {
  readonly direction: 'up' | 'down' | 'flat';
  /** Visible text, e.g. "12%". */
  readonly label: string;
  /** Whether the movement is good news; drives the badge color. */
  readonly tone: 'positive' | 'negative' | 'neutral';
  /** Comparison phrasing for screen readers, e.g. "vs last week". */
  readonly comparison?: string;
}

export type StatisticTone =
  'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info' | 'ai' | 'neutral';

const TONE_CHIP: Record<StatisticTone, string> = {
  primary: 'bg-primary-subtle text-primary',
  secondary: 'bg-secondary-subtle text-secondary',
  success: 'bg-success-subtle text-success',
  warning: 'bg-warning-subtle text-warning',
  error: 'bg-error-subtle text-error',
  info: 'bg-info-subtle text-info',
  ai: 'bg-accent-subtle text-accent',
  neutral: 'bg-surface-sunken text-text-secondary',
};

/**
 * How the card arranges itself.
 *
 *   inline  — text block left, icon chip right. The platform's own shape.
 *   stacked — label and icon on one row, the numeral beneath it. The
 *             Administration Center's shape, so its 37 tiles can move onto
 *             this card in 2d-b without changing what an administrator sees.
 *
 * A variant rather than two components: the elements are identical, only
 * their arrangement differs, and keeping two components is what let the two
 * areas drift apart on value size in the first place.
 */
export type StatisticLayout = 'inline' | 'stacked';

/** `md` is the platform numeral (20px); `lg` is the admin headline (18px→h2). */
export type StatisticSize = 'md' | 'lg';

/**
 * Label typography. `default` is the platform's; `overline` is the admin
 * area's wider-tracked voice — the same split `DataTable.headerVoice` makes,
 * for the same reason.
 */
export type StatisticLabelVoice = 'default' | 'overline';

export interface StatisticCardProps {
  label: string;
  /**
   * Pre-formatted value ("1,284", "96.2%") — formatting is the caller's job.
   * Numbers are accepted because the admin tiles pass raw counts; they are
   * rendered verbatim, never localised or rounded here. A node is accepted for
   * a value that animates in place (the admin live count's crossfade), so the
   * animation can wrap the figure alone rather than the whole card.
   */
  value: ReactNode;
  /** Unit rendered beside the numeral, baseline-aligned ("%", "min", "h"). */
  unit?: string | undefined;
  /**
   * Supporting figure BELOW the value ("3 pending verification"). Distinct
   * from `caption`, which sits beside the delta badge. Tabular, because
   * hints carry numbers and sit in a row of sibling cards.
   */
  hint?: ReactNode;
  delta?: StatisticDelta | undefined;
  icon?: LucideIcon | undefined;
  /** Icon-chip tint; lets each module's KPI family carry its identity color. */
  tone?: StatisticTone | undefined;
  caption?: string | undefined;
  layout?: StatisticLayout;
  size?: StatisticSize;
  labelVoice?: StatisticLabelVoice;
  loading?: boolean;
  /**
   * A control after the icon in the `stacked` header row — the ⋯ menu when
   * the card is a dashboard widget (Admin Overview). Unused by `inline`.
   */
  action?: ReactNode;
  /**
   * `stacked` only: replaces the value, delta and hint rows with this node
   * (a skeleton, an error) while keeping the card shell, label row and
   * `action` mounted. A caller that swaps *components* between loading and
   * loaded unmounts the `action`'s own state (an open ⋯ menu); swapping only
   * the body does not.
   */
  body?: ReactNode;
  /** `stacked` only: marks the content column `aria-busy` while `body` is a placeholder. */
  busy?: boolean | undefined;
  className?: string | undefined;
}

const DELTA_TONES: Record<StatisticDelta['tone'], BadgeVariant> = {
  positive: 'success',
  negative: 'error',
  neutral: 'neutral',
};

const DELTA_ICONS = { up: TrendingUp, down: TrendingDown, flat: Minus } as const;

export function StatisticCard({
  label,
  value,
  unit,
  hint,
  delta,
  icon: Icon,
  tone = 'primary',
  caption,
  layout = 'inline',
  size = 'md',
  labelVoice = 'default',
  loading = false,
  action,
  body,
  busy,
  className,
}: StatisticCardProps) {
  if (loading) {
    return (
      <Card padding="compact" className={className}>
        <div className="flex flex-col gap-3 p-1">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-20" />
        </div>
      </Card>
    );
  }

  const DeltaIcon = delta ? DELTA_ICONS[delta.direction] : null;
  const isStacked = layout === 'stacked';

  /*
   * A template string, not `cn` — for the same reason as the value below.
   * `cn` reads `text-caption` as a colour, `text-text-tertiary` wins the
   * group, and the label silently renders at the inherited 20px instead of
   * caption's 16px. That is 4px of card height, and it is invisible in
   * review because nothing errors.
   */
  const labelEl = (
    <p
      className={`text-caption font-semibold uppercase text-text-tertiary ${
        labelVoice === 'overline' ? 'tracking-[0.12em]' : 'tracking-wider'
      }`}
    >
      {label}
    </p>
  );

  /*
   * `items-baseline`, so a unit sits on the numeral's baseline rather than
   * being centred against a box two-thirds taller than it.
   */
  const valueEl = (
    <div className={cn('flex items-baseline gap-1', isStacked ? null : 'mt-1')}>
      {/*
        A plain template string, deliberately NOT `cn`. tailwind-merge does
        not know this project's font-size scale, so it reads `text-metric`
        as a colour, finds `text-text-primary` in the same group and drops
        the size — the value silently inherits its parent's. The same trap
        cost DataTable its `text-body-sm` (Wave 2c-b). Size and colour are
        different CSS properties, so a raw string is correct here; do not
        "tidy" this into `cn` without fixing the merge config first.
      */}
      <span
        className={`font-bold text-text-primary tabular-nums ${
          size === 'lg' ? 'text-h2' : 'text-metric'
        }`}
      >
        {value}
      </span>
      {unit !== undefined ? (
        <span className="text-body-sm font-medium text-text-tertiary">{unit}</span>
      ) : null}
    </div>
  );

  /*
   * Rendered unconditionally for `inline`, because it always was: an empty
   * row still contributes its `mt-2`, and the five platform cards were laid
   * out against that. Making it conditional shrank the labs and records
   * cards by 6px, which is a layout change this wave is not entitled to make.
   *
   * `stacked` omits it when there is nothing to show, because MetricTile has
   * no delta row at all and 2d-b has to match MetricTile, not this card.
   */
  const hasDeltaRow = !isStacked || delta !== undefined || caption !== undefined;
  const deltaRow = hasDeltaRow ? (
      <div className="mt-2 flex items-center gap-2">
        {delta && DeltaIcon ? (
          <Badge variant={DELTA_TONES[delta.tone]} icon={DeltaIcon}>
            {delta.label}
            <span className="sr-only">
              {` ${delta.direction === 'up' ? 'up' : delta.direction === 'down' ? 'down' : 'unchanged'}${
                delta.comparison ? ` ${delta.comparison}` : ''
              }`}
            </span>
          </Badge>
        ) : null}
        {caption ? <span className="text-caption text-text-tertiary">{caption}</span> : null}
      </div>
    ) : null;

  /* Hints carry figures too, and sibling cards sit side by side (DS §3.1). */
  const hintEl =
    hint !== undefined && hint !== null ? (
      <p className="text-caption text-text-secondary tabular-nums">{hint}</p>
    ) : null;

  const iconEl = Icon ? (
    <span
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-surface',
        TONE_CHIP[tone],
      )}
    >
      <Icon aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
    </span>
  ) : null;

  if (isStacked) {
    /*
     * `padding="default"` (16px) with no inner `p-1`, because MetricTile was a
     * plain `p-4` box. The inline card's `compact` 14px plus its `p-1` comes
     * to 18px, which made every migrated admin tile 4px taller — measured, not
     * guessed. Inline keeps its own padding untouched.
     */
    return (
      <Card padding="default" className={className}>
        <div className="flex flex-col gap-3" aria-busy={busy || undefined}>
          <div className="flex items-center justify-between gap-3">
            {labelEl}
            {action !== undefined ? (
              <div className="flex shrink-0 items-center gap-2">
                {iconEl}
                {action}
              </div>
            ) : (
              iconEl
            )}
          </div>
          {body !== undefined ? (
            body
          ) : (
            <>
              {valueEl}
              {deltaRow}
              {hintEl}
            </>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card padding="compact" className={className}>
      <div className="flex items-start justify-between gap-3 p-1">
        <div className="min-w-0">
          {labelEl}
          {valueEl}
          {deltaRow}
          {hintEl}
        </div>
        {iconEl}
      </div>
    </Card>
  );
}
