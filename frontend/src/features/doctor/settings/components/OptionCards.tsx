import { Check, type LucideIcon } from 'lucide-react';

import { cn } from '@/utils/cn';

/**
 * OptionCards — a radiogroup of selectable tiles used across Appearance and
 * Preferences (theme, density, font size, landing page). Each tile shows an
 * optional icon/preview, a label, and a description; the selected tile gets
 * the primary ring and a check. Keyboard: arrow keys move, Space/Enter
 * selects (native radio semantics via role).
 */
export interface OptionCard<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly description?: string;
  readonly icon?: LucideIcon;
  /** Optional custom visual (e.g. a color/theme preview) above the label. */
  readonly preview?: React.ReactNode;
}

export interface OptionCardsProps<T extends string> {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: readonly OptionCard<T>[];
  columns?: 2 | 3;
}

export function OptionCards<T extends string>({
  label,
  value,
  onChange,
  options,
  columns = 3,
}: OptionCardsProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('grid gap-3', columns === 3 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2')}
    >
      {options.map((option) => {
        const selected = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative flex flex-col gap-1.5 rounded-surface border p-3 text-start transition-colors duration-base ease-out',
              selected
                ? 'border-primary bg-primary-subtle'
                : 'border-border-strong bg-surface hover:border-text-disabled',
            )}
          >
            {selected ? (
              <span
                aria-hidden="true"
                className="absolute end-2 top-2 flex h-4 w-4 items-center justify-center rounded-pill bg-primary text-text-inverse"
              >
                <Check className="h-3 w-3" strokeWidth={2.5} />
              </span>
            ) : null}
            {option.preview ?? null}
            <span className="flex items-center gap-2">
              {Icon ? (
                <Icon
                  aria-hidden="true"
                  className={cn(
                    'h-4 w-4 shrink-0',
                    selected ? 'text-primary' : 'text-text-secondary',
                  )}
                  strokeWidth={1.75}
                />
              ) : null}
              <span
                className={cn(
                  'text-body-sm font-medium',
                  selected ? 'text-primary' : 'text-text-primary',
                )}
              >
                {option.label}
              </span>
            </span>
            {option.description ? (
              <span className="text-caption text-text-secondary">{option.description}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
