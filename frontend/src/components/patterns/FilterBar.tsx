import type { ReactNode } from 'react';

import { Chip } from '@/components/ui/Chip';
import { cn } from '@/utils/cn';

/**
 * FilterBar — UX P1 toolbar row.
 * Active filters materialize as removable Chips; "Clear all" appears with
 * ≥ 2 active filters. The right slot hosts the filter button (opening a
 * filter drawer), view switches, and the primary action.
 */
export interface ActiveFilter {
  readonly id: string;
  /** Display text, e.g. "Specialty: Cardiology". */
  readonly label: string;
}

export interface FilterBarProps {
  filters: readonly ActiveFilter[];
  onRemove: (id: string) => void;
  onClearAll?: (() => void) | undefined;
  /** Left slot, typically the SearchBar. */
  search?: ReactNode;
  /** Right slot: filter button, view switch, primary action. */
  actions?: ReactNode;
  className?: string;
}

export function FilterBar({
  filters,
  onRemove,
  onClearAll,
  search,
  actions,
  className,
}: FilterBarProps) {
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {search !== undefined || actions !== undefined ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {search !== undefined ? <div className="w-full max-w-[360px]">{search}</div> : <span />}
          {actions !== undefined ? (
            <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>
          ) : null}
        </div>
      ) : null}
      {filters.length > 0 ? (
        // "Clear all" is the list's neighbour, not its child: a list may hold
        // only list items, and a reader counting "2 items" should not meet a
        // third thing that is a button (axe aria-required-children).
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="flex flex-wrap items-center gap-2"
            role="list"
            aria-label="Active filters"
          >
            {filters.map((filter) => (
              <div key={filter.id} role="listitem">
                <Chip
                  label={filter.label}
                  onRemove={() => onRemove(filter.id)}
                  removeLabel={`Remove filter: ${filter.label}`}
                />
              </div>
            ))}
          </div>
          {filters.length >= 2 && onClearAll ? (
            <button
              type="button"
              onClick={onClearAll}
              className="rounded-control px-2 text-body-sm font-medium text-primary transition-colors duration-fast hover:text-primary-hover"
            >
              Clear all
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
