import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import { CornerDownLeft, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { SearchInput } from '@/components/ui';
import { useOutsideClick } from '@/hooks/useOutsideClick';
import { useT } from '@/i18n';
import { cn } from '@/utils/cn';

import { useShellSearch } from '../search-context';

/**
 * GlobalSearch — UX §1.2 navbar search, scoped by role.
 * Ctrl/⌘+K focuses the field from anywhere (the doctor "keyboard-first"
 * affordance, UX §1.1). Results come from `ShellSearchContext`, which the
 * app layer fills per role — the shell itself knows no domain.
 *
 * **Keyboard-first means the whole interaction (D-26).** ⌘K put the caret in
 * the field and then abandoned you there: the results were reachable only by
 * mouse, so the shortcut saved one click and cost another. ↑/↓ move the
 * active option, Enter opens it, Escape clears and closes — clearing is
 * `SearchInput`'s own contract (DS §8.28), and the panel follows it rather
 * than growing a second Escape meaning in one field.
 *
 * That also fixes the ARIA, which claimed a `listbox` while rendering a list
 * of buttons — an `option` may not contain a button, and the rows were only
 * reachable by pointer anyway. It is now a combobox owning a listbox whose
 * options are the rows themselves, with the active one carried by
 * `aria-activedescendant` so the caret never leaves the input.
 *
 * **"No matches" is a claim, so it waits for the evidence.** An index whose
 * sources are still loading reports `pending`, and the panel says so instead
 * of asserting that nothing matched — the doctor index reads three queries,
 * and for their first few hundred milliseconds the honest answer to
 * "Khaled" is "still looking", not "no such patient".
 */
const MAX_RESULTS = 7;

const LISTBOX_ID = 'global-search-results';
const optionId = (index: number) => `${LISTBOX_ID}-option-${String(index)}`;

export interface GlobalSearchProps {
  placeholder: string;
  /** Focus the field on mount — the navbar mounts it when its icon is chosen. */
  autoFocus?: boolean;
  /**
   * The surface hosting the field may close: Escape was pressed (after
   * SearchInput's own clear), or a result was chosen and navigated to.
   */
  onDismiss?: ((reason: 'escape' | 'select') => void) | undefined;
}

export function GlobalSearch({ placeholder, autoFocus = false, onDismiss }: GlobalSearchProps) {
  const [term, setTerm] = useState('');
  const t = useT();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { search, pending = false, onActivate } = useShellSearch();

  useOutsideClick([wrapperRef], () => setOpen(false), open);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const matches = useMemo(() => search(term).slice(0, MAX_RESULTS), [search, term]);
  const showPanel = open && term.trim().length > 0;
  // Clamped rather than reset on every keystroke, so narrowing a query keeps
  // the highlight on a row instead of snapping back to the top mid-type.
  const activeIndex = matches.length === 0 ? -1 : Math.min(active, matches.length - 1);

  const select = (path: string) => {
    navigate(path);
    setTerm('');
    setOpen(false);
    setActive(0);
    onDismiss?.('select');
  };

  const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      setOpen(false);
      onDismiss?.('escape');
      return;
    }
    if (!showPanel || matches.length === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((current) => (Math.min(current, matches.length - 1) + 1) % matches.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(
        (current) => (Math.min(current, matches.length - 1) + matches.length - 1) % matches.length,
      );
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      const match = matches[activeIndex];
      if (match !== undefined) select(match.path);
    }
  };

  return (
    <div ref={wrapperRef} className="relative w-full">
      <SearchInput
        ref={inputRef}
        role="combobox"
        aria-label={t('shell.globalSearch')}
        aria-keyshortcuts="Control+K"
        aria-expanded={showPanel}
        aria-controls={showPanel ? LISTBOX_ID : undefined}
        aria-autocomplete="list"
        aria-activedescendant={showPanel && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        placeholder={placeholder}
        value={term}
        onChange={(event) => {
          setTerm(event.target.value);
          setOpen(true);
          onActivate?.();
        }}
        onFocus={() => {
          setOpen(true);
          onActivate?.();
        }}
        onKeyDown={onInputKeyDown}
        onClear={() => {
          setTerm('');
          setActive(0);
        }}
      />
      {showPanel ? (
        <div className="absolute start-0 end-0 top-[calc(100%+6px)] z-dropdown animate-menu-in overflow-hidden rounded-surface border border-border bg-surface-overlay shadow-modal">
          {matches.length === 0 ? (
            <p role="status" className="px-4 py-6 text-center text-body-sm text-text-secondary">
              {/* Never "no matches" over an index that has not finished
                  loading — that is a claim the shell cannot yet support. */}
              {pending ? 'Searching…' : `No matches for “${term.trim()}”.`}
            </p>
          ) : (
            <ul
              id={LISTBOX_ID}
              role="listbox"
              aria-label={t('shell.searchResults')}
              className="max-h-80 overflow-y-auto p-1.5"
            >
              {/*
                The row IS the option. Keyboard control lives on the input via
                aria-activedescendant, so these need no tab stop — and an
                `option` containing a `button` is invalid ARIA besides.

                Hover tracks `mousemove`, NOT `mouseenter`. `mouseenter` fires
                when the panel opens or re-renders UNDER a stationary cursor,
                which silently moved the active option away from the top hit:
                click anything, press ⌘K, type, press Enter, and you opened
                whichever row happened to sit under a pointer you had not
                touched. `mousemove` only fires when the user actually moves
                the mouse, so the pointer takes the selection when it is being
                used and never when it is merely resting.
              */}
              {matches.map((result, index) => (
                <li
                  key={result.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={index === activeIndex}
                  onClick={() => select(result.path)}
                  onMouseMove={() => setActive(index)}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-3 rounded-surface px-3 py-2',
                    'transition-colors duration-fast hover:bg-surface-sunken',
                    index === activeIndex && 'bg-surface-sunken',
                  )}
                >
                  <Search
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 text-text-tertiary"
                    strokeWidth={1.75}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body-sm font-medium text-text-primary">
                      {result.label}
                    </span>
                    <span className="block truncate text-caption text-text-secondary">
                      {result.hint}
                    </span>
                  </span>
                  <CornerDownLeft
                    aria-hidden="true"
                    className="h-3.5 w-3.5 shrink-0 text-text-disabled"
                    strokeWidth={1.75}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
