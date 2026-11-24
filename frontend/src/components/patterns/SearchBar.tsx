import { useEffect, useRef } from 'react';

import { SearchInput } from '@/components/ui/SearchInput';
import { SEARCH_DEBOUNCE_MS } from '@/constants';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useT } from '@/i18n';

/**
 * SearchBar — DS §8.28 contextual search (tables/lists).
 * Controlled input; `onDebouncedChange` fires 300ms after typing stops.
 * The result count is announced politely via a visually hidden live
 * region ("14 results"). Empty results must render the Empty State
 * pattern echoing the query, with a "Clear search" action (owned by the
 * consuming table/list).
 */
export interface SearchBarProps {
  value: string;
  onValueChange: (value: string) => void;
  /** Debounced notification — wire this to the query/filter, not `onValueChange`. */
  onDebouncedChange?: ((value: string) => void) | undefined;
  debounceMs?: number;
  placeholder?: string;
  /** Announced via aria-live when provided (null = nothing announced). */
  resultCount?: number | null;
  label?: string;
  disabled?: boolean;
  className?: string;
}

export function SearchBar({
  value,
  onValueChange,
  onDebouncedChange,
  debounceMs = SEARCH_DEBOUNCE_MS,
  placeholder,
  resultCount = null,
  label,
  disabled = false,
  className,
}: SearchBarProps) {
  const t = useT();
  const debounced = useDebouncedValue(value, debounceMs);
  const callbackRef = useRef(onDebouncedChange);
  callbackRef.current = onDebouncedChange;
  const isFirstRun = useRef(true);

  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    callbackRef.current?.(debounced);
  }, [debounced]);

  return (
    <div className={className}>
      <SearchInput
        aria-label={label ?? t('ui.search')}
        placeholder={placeholder ?? t('shell.searchPlaceholder')}
        value={value}
        disabled={disabled}
        onChange={(event) => onValueChange(event.target.value)}
        onClear={() => onValueChange('')}
      />
      <span aria-live="polite" className="sr-only">
        {resultCount === null ? '' : t('ui.resultCount', { count: resultCount })}
      </span>
    </div>
  );
}
