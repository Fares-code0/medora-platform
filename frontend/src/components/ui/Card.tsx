import { forwardRef } from 'react';
import type { HTMLAttributes, KeyboardEvent, ReactNode } from 'react';

import { cn } from '@/utils/cn';

/**
 * Card — DS §8.18.
 * Surface background, radius lg, a single 1px border and no shadow, 16px padding (14px
 * compact). Interactive cards (whole card clickable) hover to shadow-popover +
 * translateY(-1px) and must contain exactly one interactive element — the
 * card itself. Never nest cards.
 */
export type CardTone =
  'none' | 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info' | 'ai';

const TONE_BAR: Record<Exclude<CardTone, 'none'>, string> = {
  primary: 'before:bg-primary',
  secondary: 'before:bg-secondary',
  success: 'before:bg-success',
  warning: 'before:bg-warning',
  error: 'before:bg-error',
  info: 'before:bg-info',
  ai: 'before:bg-accent',
};

export interface CardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  /** Optional header: title + caption subtitle + trailing action slot. */
  title?: ReactNode;
  /**
   * Heading element for a string `title`, h2 by default; never skip levels
   * (DS §3.4). The page's ContentHeader owns the h1, so a card sitting
   * directly on a page is h2 — drop to h3/h4 only inside a titled Section.
   */
  headingAs?: 'h2' | 'h3' | 'h4';
  subtitle?: string | undefined;
  headerAction?: ReactNode;
  footer?: ReactNode;
  padding?: 'default' | 'compact' | 'none';
  /** 3px top accent bar tying a card family to a module color. */
  tone?: CardTone;
  /** Whole-card click target; adds hover elevation, focus ring, keyboard activation. */
  interactive?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  {
    title,
    headingAs: Heading = 'h2',
    subtitle,
    headerAction,
    footer,
    padding = 'default',
    tone = 'none',
    interactive = false,
    className,
    children,
    onClick,
    ...rest
  },
  ref,
) {
  const pad = padding === 'compact' ? 'p-3.5' : padding === 'none' ? '' : 'p-4';
  const clickable = interactive && Boolean(onClick);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!clickable) return;
    // `' '`, not `''` — `KeyboardEvent.key` is never the empty string, so the
    // Space half of this check could not fire and an interactive card was
    // Enter-only. ARIA requires a `role="button"` to answer both (WCAG 2.1.1).
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.currentTarget.click();
    }
  };

  return (
    <div
      ref={ref}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={clickable ? onKeyDown : undefined}
      className={cn(
        'rounded-surface border border-border bg-surface',
        tone !== 'none' &&
          cn(
            'relative overflow-hidden before:absolute before:inset-x-0 before:top-0 before:h-[3px]',
            TONE_BAR[tone],
          ),
        interactive &&
          'cursor-pointer transition-[box-shadow,transform,border-color] duration-base ease-out hover:-translate-y-px hover:border-border-strong hover:shadow-popover',
        className,
      )}
      {...rest}
    >
      {title !== undefined || headerAction !== undefined ? (
        <div
          className={cn(
            'flex items-start justify-between gap-4',
            pad,
            footer === undefined && children === undefined ? '' : 'pb-0',
          )}
        >
          <div className="min-w-0">
            {typeof title === 'string' ? (
              <Heading className="text-h5 font-semibold text-text-primary">{title}</Heading>
            ) : (
              title
            )}
            {subtitle ? <p className="mt-0.5 text-caption text-text-secondary">{subtitle}</p> : null}
          </div>
          {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
        </div>
      ) : null}
      {children !== undefined ? (
        <div className={cn(pad, title !== undefined || headerAction !== undefined ? 'pt-3' : '')}>
          {children}
        </div>
      ) : null}
      {footer !== undefined ? (
        <div
          className={cn(
            'border-t border-border',
            padding === 'compact' ? 'px-3.5 py-2' : 'px-4 py-2.5',
          )}
        >
          {footer}
        </div>
      ) : null}
    </div>
  );
});
