import { SlidersHorizontal, X } from 'lucide-react';

import { Button, Chip } from '@/components/ui';
import { cn } from '@/utils/cn';

import { type useReportFilters } from '../hooks/useReportFilters';
import {
  DATE_RANGES,
  REPORT_CATEGORIES,
  type DateRangeKey,
  type ReportCategory,
} from '../model/types';

/**
 * Sticky reports filter bar — category pills, the date-range segmented
 * control, and an advanced-filters button with an active-count badge. Sits
 * at the top of the scroll region so filters stay reachable while the long
 * analytics column scrolls. Active advanced filters render as removable
 * chips beneath.
 */
export interface ReportsFilterBarProps {
  filters: ReturnType<typeof useReportFilters>['filters'];
  onCategory: (category: ReportCategory) => void;
  onRange: (range: DateRangeKey) => void;
  onOpenFilters: () => void;
  advancedCount: number;
  activeChips: readonly {
    readonly key: string;
    readonly label: string;
    readonly onRemove: () => void;
  }[];
  onClear: () => void;
}

export function ReportsFilterBar({
  filters,
  onCategory,
  onRange,
  onOpenFilters,
  advancedCount,
  activeChips,
  onClear,
}: ReportsFilterBarProps) {
  return (
    <div className="sticky top-0 z-sticky -mx-4 border-b border-border bg-background/95 px-4 py-3 backdrop-blur md:-mx-6 md:px-6">
      {/* Category pills */}
      <div
        className="flex gap-1.5 overflow-x-auto pb-2"
        role="tablist"
        aria-label="Report category"
      >
        {REPORT_CATEGORIES.map((category) => {
          const Icon = category.icon;
          const selected = category.id === filters.category;
          return (
            <button
              key={category.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onCategory(category.id)}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-pill border px-3 py-1.5 text-body-sm font-medium transition-colors duration-fast',
                selected
                  ? 'border-primary bg-primary text-text-inverse'
                  : 'border-border-strong bg-surface text-text-secondary hover:bg-surface-sunken hover:text-text-primary',
              )}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
              {category.label}
            </button>
          );
        })}
      </div>

      {/* Range + advanced */}
      <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-surface border border-border-strong bg-surface p-0.5">
          {DATE_RANGES.map((range) => {
            const selected = range.id === filters.range;
            return (
              <button
                key={range.id}
                type="button"
                aria-pressed={selected}
                onClick={() => onRange(range.id)}
                className={cn(
                  'rounded-surface px-2.5 py-1 text-body-sm font-medium transition-colors duration-fast',
                  selected
                    ? 'bg-primary-subtle text-primary'
                    : 'text-text-secondary hover:text-text-primary',
                )}
              >
                {range.label}
              </button>
            );
          })}
        </div>

        <Button
          variant="secondary"
          size="sm"
          leadingIcon={SlidersHorizontal}
          onClick={onOpenFilters}
        >
          Filters
          {advancedCount > 0 ? (
            <span className="ms-1 inline-flex h-4 min-w-4 items-center justify-center rounded-pill bg-primary px-1 text-micro font-bold text-text-inverse">
              {advancedCount}
            </span>
          ) : null}
        </Button>
      </div>

      {/* Active filter chips */}
      {activeChips.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {activeChips.map((chip) => (
            <Chip key={chip.key} label={chip.label} onRemove={chip.onRemove} />
          ))}
          <button
            type="button"
            onClick={onClear}
            className="inline-flex items-center gap-1 rounded-surface px-2 py-1 text-caption font-medium text-text-tertiary hover:text-text-primary"
          >
            <X className="h-3 w-3" strokeWidth={2} aria-hidden="true" />
            Clear all
          </button>
        </div>
      ) : null}
    </div>
  );
}
