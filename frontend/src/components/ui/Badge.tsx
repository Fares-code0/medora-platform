import { type LucideIcon } from 'lucide-react';

import { cn } from '@/utils/cn';

/**
 * Badge — DS §8.8. Static, non-interactive status descriptor.
 * Status is always dot-or-icon + text — never color alone (DS §1.3).
 * The platform-wide status→variant mapping lives in patterns/StatusBadge.
 */
export type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'neutral' | 'ai';

/**
 * The second dimension, ADR-0001 §12. Hue alone cannot separate fourteen
 * status kinds across six variants, so emphasis carries lifecycle:
 *
 *   filled  = live / actionable   — the state is still moving
 *   outline = terminal / settled  — the state has come to rest
 *
 * `ai` is provenance, not lifecycle, and sits outside the axis entirely.
 */
export type BadgeEmphasis = 'filled' | 'outline';

/*
 * The tint is a background image over an opaque `bg-surface`, not a
 * background colour. Dark-mode `*-subtle` tokens are 16% alpha, so painted
 * directly they composite with whatever is behind the badge — on a selected
 * table row (16% primary) every tone's text fell to 3.8–4.6:1, under 4.5
 * (axe, on the DataTable stories). Over a fixed base a badge reads the same
 * on any row: 5.2–6.3:1 in dark. Light subtles are opaque, so light is
 * unchanged. DataTable's pinned cells use the same layering (DEC-015).
 */
const FILLED: Record<BadgeVariant, string> = {
  success:
    'bg-surface bg-[image:linear-gradient(var(--color-success-subtle),var(--color-success-subtle))] text-success',
  warning:
    'bg-surface bg-[image:linear-gradient(var(--color-warning-subtle),var(--color-warning-subtle))] text-warning',
  error:
    'bg-surface bg-[image:linear-gradient(var(--color-error-subtle),var(--color-error-subtle))] text-error',
  info: 'bg-surface bg-[image:linear-gradient(var(--color-info-subtle),var(--color-info-subtle))] text-info',
  neutral: 'bg-surface-sunken text-text-secondary',
  // The AI badge has its own roles (ADR-0005), on the same opaque base.
  ai: 'bg-surface bg-[image:linear-gradient(var(--color-ai-badge),var(--color-ai-badge))] text-ai-badge-text',
};

/*
 * `ring-1 ring-inset`, not `border`. A border would add 2px to the box and
 * eat 1px of an 18px pill's padding on every side, which is a density
 * regression in exactly the dense tables Wave 1 bought the space for; an
 * inset ring paints the same hairline with zero geometry change.
 *
 * No new colour tokens: measured against --color-surface AND
 * --color-surface-sunken (rows alternate) in both themes, the five hue
 * defaults clear 1.4.11's 3:1 as a boundary with room to spare (light
 * 5.91–6.62, dark 6.20–7.82). --color-border does NOT (1.27–1.57), so
 * neutral takes the strong border token (3.09–3.85) instead. Aliasing new
 * per-hue border keys onto values that already pass would rebuild the
 * alias debt Wave 1b just finished paying down.
 */
const OUTLINE: Record<BadgeVariant, string> = {
  success: 'ring-1 ring-inset ring-success text-success',
  warning: 'ring-1 ring-inset ring-warning text-warning',
  error: 'ring-1 ring-inset ring-error text-error',
  info: 'ring-1 ring-inset ring-info text-info',
  neutral: 'ring-1 ring-inset ring-border-strong text-text-secondary',
  ai: 'ring-1 ring-inset ring-accent text-ai-badge-text',
};

const EMPHASIS: Record<BadgeEmphasis, Record<BadgeVariant, string>> = {
  filled: FILLED,
  outline: OUTLINE,
};

/**
 * Dot and icon are mutually exclusive — a badge carrying both spends 28px of
 * an 18px pill on chrome, and the glyph is the channel that separates two
 * kinds sharing a hue, so a dot beside it only dilutes the signal. Expressed
 * as a union so the illegal pairing cannot compile (FRONTEND_ARCHITECTURE §9.2).
 */
type BadgeGlyph =
  { dot?: boolean | undefined; icon?: undefined } | { dot?: undefined; icon: LucideIcon };

export type BadgeProps = {
  variant?: BadgeVariant;
  emphasis?: BadgeEmphasis;
  children: React.ReactNode;
  className?: string | undefined;
} & BadgeGlyph;

export function Badge({
  variant = 'neutral',
  emphasis = 'filled',
  dot = false,
  icon: Icon,
  children,
  className,
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex h-[18px] items-center gap-1 whitespace-nowrap rounded-pill px-1.5 text-caption font-medium',
        EMPHASIS[emphasis][variant],
        className,
      )}
    >
      {dot ? (
        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-pill bg-current" />
      ) : null}
      {Icon ? <Icon aria-hidden="true" className="h-3 w-3 shrink-0" strokeWidth={2} /> : null}
      {children}
    </span>
  );
}

/**
 * CountBadge — DS §8.8 count style: filled error circle, min-width 18px.
 * Displays "99+" beyond `max` (UX §1.2 shell rule).
 */
export interface CountBadgeProps {
  count: number;
  max?: number;
  'aria-label'?: string | undefined;
  className?: string;
}

export function CountBadge({
  count,
  max = 99,
  'aria-label': ariaLabel,
  className,
}: CountBadgeProps) {
  if (count <= 0) return null;
  const display = count > max ? `${max}+` : String(count);
  return (
    <span
      aria-label={ariaLabel}
      className={cn(
        'inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-pill bg-error px-1 text-caption font-bold leading-none text-text-inverse tabular-nums',
        className,
      )}
    >
      {display}
    </span>
  );
}
