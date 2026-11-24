import { forwardRef } from 'react';

import { Search, X } from 'lucide-react';

import { useT } from '@/i18n';

import { Input, type InputProps } from './Input';
import { FIELD_ACTION_CLASSES } from './internal/styles';

/**
 * SearchInput — contextual search field (DS §8.28).
 * Leading search icon, clear button when non-empty, Escape clears.
 * Debouncing and result-count announcement are owned by the SearchBar
 * pattern; this atom is a plain controlled input.
 */
export interface SearchInputProps extends Omit<
  InputProps,
  'type' | 'leadingIcon' | 'trailingElement'
> {
  /** Shown as a labelled clear button whenever the value is non-empty. */
  onClear?: (() => void) | undefined;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { onClear, value, onKeyDown, className, ...rest },
  ref,
) {
  const t = useT();
  const hasValue = typeof value === 'string' && value.length > 0;

  return (
    <Input
      ref={ref}
      type="search"
      role="searchbox"
      leadingIcon={Search}
      value={value}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && hasValue && onClear) {
          event.preventDefault();
          onClear();
        }
        onKeyDown?.(event);
      }}
      className={`[&::-webkit-search-cancel-button]:appearance-none ${className ?? ''}`}
      trailingElement={
        hasValue && onClear ? (
          <button
            type="button"
            aria-label={t('ui.clearSearch')}
            onClick={onClear}
            className={FIELD_ACTION_CLASSES}
          >
            <X aria-hidden="true" className="h-4 w-4" strokeWidth={1.75} />
          </button>
        ) : undefined
      }
      {...rest}
    />
  );
});
