import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Check, ChevronDown } from 'lucide-react';
import { createPortal } from 'react-dom';

import { useOutsideClick } from '@/hooks/useOutsideClick';
import { withoutIsolates } from '@/i18n';
import { cn } from '@/utils/cn';

import { FieldWrapper, useFieldA11y } from './internal/Field';
import { useFloating } from './internal/floating';
import { fieldInputClasses, type FieldSize } from './internal/styles';

/**
 * Select — DS §8.4 (select-only combobox, WAI-ARIA pattern).
 * Trigger matches input styling; menu is a listbox with roving active
 * option (aria-activedescendant). Keyboard: Up/Down navigate, Enter/Space
 * select, Esc closes, Home/End jump, printable characters type-ahead.
 * Options support groups rendered as overline headers.
 */
export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
  /** Consecutive options sharing a group render under an overline header. */
  readonly group?: string;
}

export interface SelectProps {
  options: readonly SelectOption[];
  value: string | null;
  onChange: (value: string) => void;
  label?: string | undefined;
  helperText?: string | undefined;
  error?: string | undefined;
  placeholder?: string | undefined;
  disabled?: boolean;
  required?: boolean;
  size?: FieldSize;
  id?: string | undefined;
  /** Submitted form field name (rendered as a hidden input). */
  name?: string | undefined;
  /** Required when no visible `label` is provided. */
  'aria-label'?: string | undefined;
  /**
   * Styles the TRIGGER. Not the place for a width: the field wrapper around
   * it is `w-full`, so sizing the trigger alone leaves a full-width field
   * holding a narrow control — which in a flex toolbar makes every filter
   * claim a row of its own. Widths go on `containerClassName`, and
   * `scripts/check-retired-tokens.mjs` fails the build on the mistake.
   */
  className?: string | undefined;
  /** Styles the FIELD — this is where a width belongs. */
  containerClassName?: string | undefined;
}

const TYPEAHEAD_RESET_MS = 500;

export function Select({
  options,
  value,
  onChange,
  label,
  helperText,
  error,
  placeholder = 'Select…',
  disabled = false,
  required = false,
  size = 'md',
  id,
  name,
  'aria-label': ariaLabel,
  className,
  containerClassName,
}: SelectProps) {
  const { inputId, helperId, errorId } = useFieldA11y(id);
  const listboxId = `${inputId}-listbox`;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const typeahead = useRef({ buffer: '', timer: 0 });

  const selectedIndex = useMemo(
    () => options.findIndex((o) => o.value === value),
    [options, value],
  );
  const selected = selectedIndex >= 0 ? options[selectedIndex] : undefined;
  const enabledIndexes = useMemo(
    () => options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0),
    [options],
  );

  const close = useCallback(() => setOpen(false), []);
  // The listbox is portaled (internal/floating.ts), so it is outside the
  // wrapper in the DOM: a click on an option must not count as outside.
  useOutsideClick([wrapperRef, listRef], close, open);
  const floating = useFloating<HTMLUListElement>(open, triggerRef, { matchWidth: true, cap: 320 });

  const openList = () => {
    if (disabled || enabledIndexes.length === 0) return;
    const start =
      selectedIndex >= 0 && !options[selectedIndex]?.disabled
        ? selectedIndex
        : (enabledIndexes[0] ?? -1);
    setActiveIndex(start);
    setOpen(true);
  };

  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open || activeIndex < 0) return;
    document.getElementById(`${inputId}-opt-${activeIndex}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, activeIndex, inputId]);

  const moveActive = (delta: number) => {
    if (enabledIndexes.length === 0) return;
    const position = enabledIndexes.indexOf(activeIndex);
    const nextPosition = Math.min(Math.max(position + delta, 0), enabledIndexes.length - 1);
    setActiveIndex(enabledIndexes[nextPosition] ?? activeIndex);
  };

  const commit = (index: number) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    close();
    triggerRef.current?.focus();
  };

  const handleTypeahead = (key: string) => {
    window.clearTimeout(typeahead.current.timer);
    typeahead.current.buffer += key.toLowerCase();
    typeahead.current.timer = window.setTimeout(() => {
      typeahead.current.buffer = '';
    }, TYPEAHEAD_RESET_MS);
    const match = enabledIndexes.find((i) =>
      // A label may be LTR-isolated (`isolateLtr`); the controls are not typed.
      withoutIsolates(options[i]?.label ?? '')
        .toLowerCase()
        .startsWith(typeahead.current.buffer),
    );
    if (match !== undefined) setActiveIndex(match);
  };

  const onListKeyDown = (event: React.KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveActive(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveActive(-1);
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(enabledIndexes[0] ?? -1);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(enabledIndexes[enabledIndexes.length - 1] ?? -1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        commit(activeIndex);
        break;
      case 'Escape':
      case 'Tab':
        close();
        triggerRef.current?.focus();
        break;
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          handleTypeahead(event.key);
        }
    }
  };

  const onTriggerKeyDown = (event: React.KeyboardEvent) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' ', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      openList();
    }
  };

  let lastGroup: string | undefined;

  return (
    <FieldWrapper
      inputId={inputId}
      helperId={helperId}
      errorId={errorId}
      label={label}
      required={required}
      helperText={helperText}
      error={error}
      disabled={disabled}
      className={containerClassName}
    >
      <div ref={wrapperRef} className="relative">
        <button
          ref={triggerRef}
          id={inputId}
          type="button"
          role="combobox"
          disabled={disabled}
          aria-expanded={open}
          aria-controls={listboxId}
          aria-haspopup="listbox"
          aria-invalid={error ? true : undefined}
          aria-required={required || undefined}
          aria-label={label ? undefined : ariaLabel}
          aria-describedby={error ? errorId : helperText ? helperId : undefined}
          onClick={() => (open ? close() : openList())}
          onKeyDown={onTriggerKeyDown}
          className={cn(
            fieldInputClasses({
              size,
              invalid: Boolean(error),
              trailing: true,
              textEntry: false,
              className,
            }),
            // `relative` so the chevron below anchors to THIS button. It used
            // to anchor to the wrapper div, which is the field's full width —
            // so any trigger narrower than its wrapper flung the chevron to
            // the far edge of the row, yards from the control it belongs to.
            'relative flex items-center justify-between text-start',
          )}
        >
          {/*
           * A Select renders its placeholder as a real element rather than
           * through the CSS pseudo-class, so it needs the same decision
           * internal/styles.ts makes for every other field written out again.
           * See that file for why the disabled role was wrong here.
           */}
          <span className={cn('truncate', !selected && 'text-text-placeholder')}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'absolute end-3 h-5 w-5 shrink-0 text-text-secondary transition-transform duration-moderate ease-out',
              open && 'rotate-180',
            )}
            strokeWidth={1.75}
          />
        </button>
        {name ? <input type="hidden" name={name} value={value ?? ''} /> : null}
        {open && floating.container ? createPortal(
          <ul
            ref={(node) => {
              listRef.current = node;
              floating.floatingRef.current = node;
            }}
            style={floating.style}
            data-placement={floating.placement}
            id={listboxId}
            role="listbox"
            tabIndex={-1}
            aria-labelledby={label ? undefined : inputId}
            aria-activedescendant={activeIndex >= 0 ? `${inputId}-opt-${activeIndex}` : undefined}
            onKeyDown={onListKeyDown}
            className="z-dropdown animate-menu-in overflow-auto rounded-surface border border-border bg-surface-overlay p-1 shadow-popover focus:outline-none"
          >
            {options.map((option, index) => {
              const groupHeader =
                option.group && option.group !== lastGroup ? (
                  <li
                    key={`group-${option.group}`}
                    role="presentation"
                    className="px-3 pb-1 pt-2 text-caption font-semibold uppercase tracking-wider text-text-tertiary"
                  >
                    {option.group}
                  </li>
                ) : null;
              lastGroup = option.group;
              const isSelected = option.value === value;
              return (
                <Fragment key={option.value}>
                  {groupHeader}
                  <li
                    id={`${inputId}-opt-${index}`}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={option.disabled || undefined}
                    onClick={() => commit(index)}
                    onMouseMove={() => {
                      if (!option.disabled && activeIndex !== index) setActiveIndex(index);
                    }}
                    className={cn(
                      // 44px options on a coarse pointer, as menu rows (DEC-008).
                      'flex h-9 cursor-pointer items-center justify-between gap-2 rounded-control px-3 text-body-sm touch:h-11',
                      option.disabled
                        ? 'cursor-not-allowed text-text-disabled'
                        : isSelected
                          ? 'bg-primary-subtle text-primary'
                          : 'text-text-primary',
                      !option.disabled &&
                        activeIndex === index &&
                        !isSelected &&
                        'bg-surface-sunken',
                      !option.disabled &&
                        activeIndex === index &&
                        isSelected &&
                        'bg-primary-subtle',
                    )}
                  >
                    <span className="truncate">{option.label}</span>
                    {isSelected ? (
                      <Check aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={2} />
                    ) : null}
                  </li>
                </Fragment>
              );
            })}
          </ul>,
          floating.container,
        ) : null}
      </div>
    </FieldWrapper>
  );
}
