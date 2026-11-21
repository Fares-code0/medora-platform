import { cloneElement, isValidElement, useEffect, useId, useRef, useState } from 'react';
import type { HTMLAttributes, ReactElement } from 'react';

import { cn } from '@/utils/cn';

/**
 * Tooltip — DS §8.11.
 * Non-interactive text hint only (one sentence; no links/buttons — use a
 * popover for those). 300ms show delay, instant hide; shown on keyboard
 * focus; dismissible with Esc while remaining hoverable (WCAG 1.4.13).
 * Never hide essential clinical information in a tooltip.
 */
export interface TooltipProps {
  content: string;
  placement?: 'top' | 'bottom' | 'left' | 'right';
  delayMs?: number;
  disabled?: boolean;
  children: ReactElement<HTMLAttributes<HTMLElement>>;
}

const PLACEMENTS = {
  /*
   * `start-1/2` mirrors on its own; the centering `-translate-x-1/2` does
   * not — `translate` is physical in both directions — so RTL needs the
   * opposite half-shift or a centred tooltip lands a full width off.
   */
  top: 'bottom-full start-1/2 mb-1.5 -translate-x-1/2 rtl:translate-x-1/2',
  bottom: 'top-full start-1/2 mt-1.5 -translate-x-1/2 rtl:translate-x-1/2',
  left: 'end-full top-1/2 me-1.5 -translate-y-1/2',
  right: 'start-full top-1/2 ms-1.5 -translate-y-1/2',
} as const;

export function Tooltip({
  content,
  placement = 'top',
  delayMs = 300,
  disabled = false,
  children,
}: TooltipProps) {
  const [open, setOpen] = useState(false);
  const timer = useRef(0);
  const tooltipId = useId();

  useEffect(() => () => window.clearTimeout(timer.current), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const show = () => {
    if (disabled) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(true), delayMs);
  };

  const hide = () => {
    window.clearTimeout(timer.current);
    setOpen(false);
  };

  const child = isValidElement(children)
    ? cloneElement(children, {
        'aria-describedby': open ? tooltipId : children.props['aria-describedby'],
      })
    : children;

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
    >
      {child}
      {open ? (
        <span
          id={tooltipId}
          role="tooltip"
          className={cn(
            'pointer-events-none absolute z-dropdown w-max max-w-[240px] animate-popover-in rounded-control px-2.5 py-1.5',
            'bg-text-primary text-caption font-medium text-background shadow-popover',
            PLACEMENTS[placement],
          )}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}
