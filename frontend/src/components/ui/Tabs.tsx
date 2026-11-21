import { useId, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

import { m } from 'framer-motion';

import { cn } from '@/utils/cn';

/**
 * Tabs — DS §8.20.
 * Line style (default) with a sliding 2px underline; enclosed style for
 * tight toggles. Roving tabindex, Left/Right/Home/End with automatic
 * activation. Maximum 6 tabs; overflow scrolls horizontally. Tabs switch
 * views; they never trigger actions.
 */
export interface TabItem {
  readonly value: string;
  readonly label: string;
  readonly count?: number;
  readonly disabled?: boolean;
  /** Optional panel; when present the active panel renders below the list. */
  readonly content?: ReactNode;
}

export interface TabsProps {
  items: readonly TabItem[];
  value: string;
  onValueChange: (value: string) => void;
  variant?: 'line' | 'enclosed';
  'aria-label': string;
  className?: string;
}

export function Tabs({
  items,
  value,
  onValueChange,
  variant = 'line',
  'aria-label': ariaLabel,
  className,
}: TabsProps) {
  const baseId = useId();
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());
  const enabled = items.filter((item) => !item.disabled);
  const active = items.find((item) => item.value === value);

  const activate = (tabValue: string) => {
    onValueChange(tabValue);
    tabRefs.current.get(tabValue)?.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (enabled.length === 0) return;
    const index = enabled.findIndex((item) => item.value === value);
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        activate(enabled[(index + 1) % enabled.length]?.value ?? value);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        activate(enabled[(index - 1 + enabled.length) % enabled.length]?.value ?? value);
        break;
      case 'Home':
        event.preventDefault();
        activate(enabled[0]?.value ?? value);
        break;
      case 'End':
        event.preventDefault();
        activate(enabled[enabled.length - 1]?.value ?? value);
        break;
    }
  };

  return (
    <div className={className}>
      <div
        role="tablist"
        aria-label={ariaLabel}
        onKeyDown={onKeyDown}
        className={cn(
          'flex max-w-full overflow-x-auto',
          variant === 'line'
            ? 'gap-4 border-b border-border'
            : 'w-fit gap-1 rounded-surface bg-surface-sunken p-0.5',
        )}
      >
        {items.map((item) => {
          const selected = item.value === value;
          return (
            <button
              key={item.value}
              ref={(node) => {
                if (node) tabRefs.current.set(item.value, node);
                else tabRefs.current.delete(item.value);
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.value}`}
              aria-selected={selected}
              aria-controls={
                item.content !== undefined ? `${baseId}-panel-${item.value}` : undefined
              }
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              onClick={() => onValueChange(item.value)}
              className={cn(
                'relative inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-body-sm font-medium',
                'transition-colors duration-fast ease-out disabled:cursor-not-allowed disabled:text-text-disabled',
                variant === 'line'
                  ? cn(
                      'h-11 px-1',
                      selected
                        ? 'text-tab-active-text'
                        : 'text-text-secondary hover:text-text-primary',
                    )
                  : cn(
                      'touch-target h-9 rounded-control px-3 [--touch-y:4px]',
                      selected
                        ? // The edge is the ONLY thing separating the active
                          // tab from its own track: surface on surface-sunken
                          // is 1.11:1 in light and 1.14:1 in dark. Without it
                          // the selected tab is invisible, so this is spelled
                          // explicitly rather than left to a deprecated alias.
                          'bg-surface text-tab-active-text ring-1 ring-border'
                        : 'text-text-secondary hover:text-text-primary',
                    ),
              )}
            >
              {item.label}
              {item.count !== undefined ? (
                <span className="rounded-pill bg-surface-sunken px-1.5 text-caption font-semibold text-text-secondary tabular-nums">
                  {item.count}
                </span>
              ) : null}
              {variant === 'line' && selected ? (
                <m.span
                  layoutId={`${baseId}-underline`}
                  aria-hidden="true"
                  className="absolute inset-x-0 -bottom-px h-0.5 rounded-pill bg-tab-indicator"
                  transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                />
              ) : null}
            </button>
          );
        })}
      </div>
      {active?.content !== undefined ? (
        <div
          role="tabpanel"
          id={`${baseId}-panel-${active.value}`}
          aria-labelledby={`${baseId}-tab-${active.value}`}
          tabIndex={0}
          className="pt-4 focus:outline-none"
        >
          {active.content}
        </div>
      ) : null}
    </div>
  );
}
