import { cloneElement, useCallback, useRef, useState } from 'react';
import type { HTMLAttributes, MouseEvent, ReactElement } from 'react';

import { AnimatePresence, m, type MotionStyle } from 'framer-motion';
import { createPortal } from 'react-dom';

import { useOutsideClick } from '@/hooks/useOutsideClick';
import { EASE_EMPHASIZED, EASE_IN, motionTokens } from '@/styles/motion';
import { cn } from '@/utils/cn';

import { useFloating } from './internal/floating';
import { MenuList, type MenuEntry } from './internal/MenuList';

export type {
  MenuEntry,
  MenuItem,
  MenuSegmented,
  MenuSegmentOption,
  MenuSeparator,
} from './internal/MenuList';

/**
 * Dropdown (action menu) — DS §8.13.
 * Anchored to its trigger; full menu keyboard pattern via MenuList.
 * Focus moves into the menu on open and returns to the trigger on close.
 * Entrance: fade + 4px rise + scale 0.98→1 over 200ms (DS §9.4).
 */
export interface DropdownProps {
  /** A focusable element (Button/IconButton); receives aria wiring via clone. */
  trigger: ReactElement<HTMLAttributes<HTMLElement>>;
  entries: readonly MenuEntry[];
  align?: 'start' | 'end';
  menuLabel?: string | undefined;
  className?: string;
}

export function Dropdown({ trigger, entries, align = 'end', menuLabel, className }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  const close = useCallback(() => setOpen(false), []);
  // The menu is portaled (internal/floating.ts): clicks inside it are not outside.
  // It follows the trigger as the page scrolls, and closes once the trigger
  // has scrolled fully out of view rather than floating over unrelated rows.
  const floating = useFloating<HTMLDivElement>(open, wrapperRef, {
    align,
    cap: 400,
    onAnchorHidden: close,
  });
  useOutsideClick([wrapperRef, floating.floatingRef], close, open);

  const closeAndRefocus = useCallback(() => {
    setOpen(false);
    const focusable = wrapperRef.current?.querySelector<HTMLElement>('button, [href], [tabindex]');
    focusable?.focus();
  }, []);

  const clonedTrigger = cloneElement(trigger, {
    'aria-expanded': open,
    'aria-haspopup': 'menu',
    onClick: (event: MouseEvent<HTMLElement>) => {
      trigger.props.onClick?.(event);
      setOpen((v) => !v);
    },
  });

  return (
    <div ref={wrapperRef} className={cn('relative inline-flex', className)}>
      {clonedTrigger}
      {floating.container
        ? createPortal(
            <AnimatePresence>
              {open ? (
                <m.div
                  ref={floating.floatingRef}
                  // Plain fixed geometry; none of it is animated by motion.
                  style={floating.style as MotionStyle}
                  data-placement={floating.placement}
                  initial={{ opacity: 0, y: floating.placement === 'top' ? 4 : -4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{
                    opacity: 0,
                    transition: { duration: motionTokens.duration.slow, ease: EASE_IN },
                  }}
                  transition={{ duration: motionTokens.duration.menu, ease: EASE_EMPHASIZED }}
                  // No overflow here: the max-height is inherited by MenuList,
                  // which scrolls inside its own rounded surface.
                  className="z-dropdown flex flex-col"
                >
                  <MenuList entries={entries} onClose={closeAndRefocus} aria-label={menuLabel} />
                </m.div>
              ) : null}
            </AnimatePresence>,
            floating.container,
          )
        : null}
    </div>
  );
}
