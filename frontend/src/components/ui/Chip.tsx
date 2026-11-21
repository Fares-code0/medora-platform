import type { KeyboardEvent } from 'react';

import { Check, X, type LucideIcon } from 'lucide-react';

import { cn } from '@/utils/cn';

/**
 * Chip — DS §8.9. Interactive sibling of Badge (filters, selections, tags).
 * Selected: primary-subtle bg + primary border/text + leading check.
 * Removable: trailing × with its own aria-label; Delete/Backspace removes.
 */
export interface ChipProps {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  /** Makes the chip a toggle button (Enter/Space toggles). */
  onSelect?: (() => void) | undefined;
  /** Renders the trailing remove button. */
  onRemove?: (() => void) | undefined;
  /** Accessible name for the remove button; defaults to "Remove {label}". */
  removeLabel?: string | undefined;
  icon?: LucideIcon | undefined;
  className?: string;
}

export function Chip({
  label,
  selected = false,
  disabled = false,
  onSelect,
  onRemove,
  removeLabel,
  icon: Icon,
  className,
}: ChipProps) {
  const baseClasses = cn(
    // max-w-full lets long labels truncate instead of overflowing the
    // container (e.g. education entries on narrow viewports).
    'inline-flex h-6 max-w-full items-center gap-1 rounded-pill border px-2.5 text-body-sm font-medium',
    'transition-colors duration-base ease-out',
    selected
      ? 'border-primary bg-primary-subtle text-primary'
      : 'border-border-strong bg-surface text-text-primary',
    disabled && 'cursor-not-allowed border-border bg-surface-sunken text-text-disabled',
    className,
  );

  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.key === 'Delete' || event.key === 'Backspace') && onRemove && !disabled) {
      event.preventDefault();
      onRemove();
    }
  };

  const content = (
    <>
      {selected ? (
        <Check aria-hidden="true" className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
      ) : null}
      {Icon && !selected ? (
        <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
      ) : null}
      <span className="min-w-0 truncate">{label}</span>
    </>
  );

  const removeButton = onRemove ? (
    <button
      type="button"
      disabled={disabled}
      aria-label={removeLabel ?? `Remove ${label}`}
      onClick={onRemove}
      className="hit-target touch-target -mr-1.5 inline-flex h-4 w-4 [--touch-x:14px] [--touch-y:14px] touch:mx-[14px] shrink-0 items-center justify-center rounded-pill text-current transition-colors duration-fast hover:bg-border disabled:cursor-not-allowed"
    >
      <X aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
    </button>
  ) : null;

  if (onSelect) {
    // Selectable chip; the remove control sits beside it (no nested buttons).
    if (removeButton) {
      return (
        <span className={baseClasses}>
          <button
            type="button"
            disabled={disabled}
            aria-pressed={selected}
            onClick={onSelect}
            onKeyDown={onKeyDown}
            className="inline-flex items-center gap-1.5 focus:outline-none"
          >
            {content}
          </button>
          {removeButton}
        </span>
      );
    }
    return (
      <button
        type="button"
        disabled={disabled}
        aria-pressed={selected}
        onClick={onSelect}
        onKeyDown={onKeyDown}
        className={cn(baseClasses, !disabled && !selected && 'hover:bg-surface-sunken')}
      >
        {content}
      </button>
    );
  }

  return (
    <span className={baseClasses} onKeyDown={onRemove ? onKeyDown : undefined}>
      {content}
      {removeButton}
    </span>
  );
}
