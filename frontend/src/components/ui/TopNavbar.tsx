import type { ReactNode } from 'react';

import { cn } from '@/utils/cn';

/**
 * TopNavbar — DS §8.17 (presentational shell chrome).
 * 52px desktop / 48px mobile, surface bg, bottom hairline; gains shadow-popover
 * only once content scrolls beneath it (`elevated`). Slots: start (menu
 * toggle + breadcrumb), center (global search, 480px max), end (bell, AI
 * entry, avatar menu). Primary page actions never live here — they belong
 * in the page header.
 */
export interface TopNavbarProps {
  start?: ReactNode;
  center?: ReactNode;
  end?: ReactNode;
  /** Set when content has scrolled beneath the bar. */
  elevated?: boolean;
  sticky?: boolean;
  className?: string;
}

export function TopNavbar({
  start,
  center,
  end,
  elevated = false,
  sticky = true,
  className,
}: TopNavbarProps) {
  return (
    <header
      className={cn(
        'flex h-12 w-full items-center gap-4 border-b border-border bg-surface px-4 md:h-[52px] md:px-6',
        'transition-shadow duration-base ease-out',
        sticky && 'sticky top-0 z-sticky',
        /*
         * A real drop shadow, not the hairline alias. This header is
         * full-bleed and already carries `border-b`, so the aliased
         * `shadow-sm` was drawing a 1px ring around all four sides of it —
         * three of which are off-screen — instead of lifting it. Scroll
         * elevation is the one thing on this element that genuinely floats,
         * which is what `--shadow-popover` is reserved for (ADR-0001).
         */
        elevated && 'shadow-popover',
        className,
      )}
    >
      {start ? <div className="flex min-w-0 items-center gap-3">{start}</div> : null}
      {center ? (
        <div className="mx-auto w-full max-w-[480px] flex-1">{center}</div>
      ) : (
        <div className="flex-1" />
      )}
      {end ? <div className="flex shrink-0 items-center gap-2">{end}</div> : null}
    </header>
  );
}
