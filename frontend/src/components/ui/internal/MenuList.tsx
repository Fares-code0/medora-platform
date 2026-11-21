import { useEffect, useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { type LucideIcon } from 'lucide-react';

import { cn } from '@/utils/cn';

/**
 * Shared menu internals — DS §8.13 (WAI-ARIA menu pattern).
 * Dropdown and ContextMenu both render this list so item styling, roving
 * focus, arrows/Home/End, type-ahead, and destructive-item rules exist
 * exactly once. Destructive items render error-colored and belong last,
 * after a separator (enforced by convention + review).
 */

export interface MenuItem {
  readonly type?: 'item';
  readonly id: string;
  readonly label: string;
  readonly icon?: LucideIcon;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}

export interface MenuSeparator {
  readonly type: 'separator';
  readonly id: string;
}

/**
 * One option of a segmented entry: an icon-only choice that names itself to
 * assistive tech (`label`) and carries its own checked state.
 */
export interface MenuSegmentOption {
  readonly id: string;
  /** The accessible name and tooltip — the option shows only its icon. */
  readonly label: string;
  readonly icon: LucideIcon;
  readonly checked: boolean;
  readonly onSelect: () => void;
  /** Icon colour while checked; inactive options are always tertiary. */
  readonly activeClassName?: string | undefined;
}

/**
 * A pill of mutually exclusive choices inside a menu — the avatar menu's
 * theme switch (NEW-36). WAI-ARIA's menu pattern has a role for exactly
 * this: a `group` of `menuitemradio`, each with `aria-checked`. A
 * `radiogroup` or a `switch` would be invalid children of `role="menu"`.
 *
 * Choosing an option does **not** close the menu: the indicator moving is
 * the confirmation, and a menu that vanished first would hide it.
 */
export interface MenuSegmented {
  readonly type: 'segmented';
  readonly id: string;
  /** Visible label for the row, and the group's accessible name. */
  readonly label: string;
  readonly options: readonly MenuSegmentOption[];
}

export type MenuEntry = MenuItem | MenuSeparator | MenuSegmented;

/** Everything roving focus can land on, in document order. */
interface Focusable {
  readonly id: string;
  readonly label: string;
  readonly disabled: boolean;
  /** The segmented entry an option belongs to, for Left/Right. */
  readonly group: string | null;
}

function focusablesOf(entries: readonly MenuEntry[]): Focusable[] {
  return entries.flatMap((entry): Focusable[] => {
    if (entry.type === 'separator') return [];
    if (entry.type === 'segmented') {
      return entry.options.map((option) => ({
        id: option.id,
        label: option.label,
        disabled: false,
        group: entry.id,
      }));
    }
    return [{ id: entry.id, label: entry.label, disabled: entry.disabled === true, group: null }];
  });
}

const TYPEAHEAD_RESET_MS = 500;

interface MenuListProps {
  entries: readonly MenuEntry[];
  onClose: () => void;
  'aria-label'?: string | undefined;
  className?: string | undefined;
}

export function MenuList({ entries, onClose, 'aria-label': ariaLabel, className }: MenuListProps) {
  const enabled = focusablesOf(entries).filter((item) => !item.disabled);
  const [focusedId, setFocusedId] = useState<string | null>(enabled[0]?.id ?? null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const typeahead = useRef({ buffer: '', timer: 0 });

  useEffect(() => {
    if (focusedId) itemRefs.current.get(focusedId)?.focus();
  }, [focusedId]);

  const moveFocus = (delta: number) => {
    if (enabled.length === 0) return;
    const index = enabled.findIndex((item) => item.id === focusedId);
    const next = index < 0 ? 0 : (index + delta + enabled.length) % enabled.length;
    setFocusedId(enabled[next]?.id ?? null);
  };

  /**
   * Left/Right move between a segmented entry's options. The pill is laid
   * out left-to-right in every language (sun left, moon right), so the keys
   * are physical, matching what the reader sees.
   */
  const moveWithinGroup = (delta: number): boolean => {
    const current = enabled.find((item) => item.id === focusedId);
    if (current?.group == null) return false;
    const siblings = enabled.filter((item) => item.group === current.group);
    const index = siblings.findIndex((item) => item.id === current.id);
    const next = siblings[Math.min(siblings.length - 1, Math.max(0, index + delta))];
    if (next !== undefined) setFocusedId(next.id);
    return true;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    switch (event.key) {
      case 'ArrowLeft':
        if (moveWithinGroup(-1)) event.preventDefault();
        break;
      case 'ArrowRight':
        if (moveWithinGroup(1)) event.preventDefault();
        break;
      case 'ArrowDown':
        event.preventDefault();
        moveFocus(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveFocus(-1);
        break;
      case 'Home':
        event.preventDefault();
        setFocusedId(enabled[0]?.id ?? null);
        break;
      case 'End':
        event.preventDefault();
        setFocusedId(enabled[enabled.length - 1]?.id ?? null);
        break;
      case 'Escape':
        event.preventDefault();
        onClose();
        break;
      case 'Tab':
        onClose();
        break;
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          window.clearTimeout(typeahead.current.timer);
          typeahead.current.buffer += event.key.toLowerCase();
          typeahead.current.timer = window.setTimeout(() => {
            typeahead.current.buffer = '';
          }, TYPEAHEAD_RESET_MS);
          const match = enabled.find((item) =>
            item.label.toLowerCase().startsWith(typeahead.current.buffer),
          );
          if (match) setFocusedId(match.id);
        }
    }
  };

  return (
    <div
      role="menu"
      aria-label={ariaLabel}
      onKeyDown={onKeyDown}
      className={cn(
        'min-w-[180px] rounded-surface border border-border bg-surface-overlay p-1 shadow-popover',
        className,
      )}
    >
      {entries.map((entry) =>
        entry.type === 'separator' ? (
          <div key={entry.id} role="separator" className="my-1 h-px bg-border" />
        ) : entry.type === 'segmented' ? (
          <SegmentedRow
            key={entry.id}
            entry={entry}
            focusedId={focusedId}
            onFocusOption={setFocusedId}
            registerRef={(id, node) => {
              if (node) itemRefs.current.set(id, node);
              else itemRefs.current.delete(id);
            }}
          />
        ) : (
          <button
            key={entry.id}
            ref={(node) => {
              if (node) itemRefs.current.set(entry.id, node);
              else itemRefs.current.delete(entry.id);
            }}
            type="button"
            role="menuitem"
            disabled={entry.disabled}
            tabIndex={entry.id === focusedId ? 0 : -1}
            onClick={() => {
              entry.onSelect();
              onClose();
            }}
            onMouseEnter={() => {
              if (!entry.disabled) setFocusedId(entry.id);
            }}
            className={cn(
              // 44px rows on a coarse pointer: stacked with no gap, a hidden
              // extension would overlap the next item, so the row itself grows
              // (DEC-008) — "Cancel appointment" sits directly under its neighbour.
              'flex h-9 w-full items-center gap-2 rounded-control px-3 text-start text-body-sm touch:h-11',
              'transition-colors duration-fast ease-out',
              entry.destructive ? 'text-error' : 'text-text-primary',
              'hover:bg-surface-sunken focus:bg-surface-sunken focus:outline-none',
              'disabled:cursor-not-allowed disabled:text-text-disabled disabled:hover:bg-transparent',
            )}
          >
            {entry.icon ? (
              <entry.icon aria-hidden="true" className="h-5 w-5 shrink-0" strokeWidth={1.75} />
            ) : null}
            <span className="truncate">{entry.label}</span>
          </button>
        ),
      )}
    </div>
  );
}

/**
 * The pill: a rounded track, one icon button per option, and a circular
 * indicator that slides behind the checked one. The indicator is the
 * non-colour cue for the selection (WCAG 1.4.1); `aria-checked` is the
 * programmatic one.
 *
 * `dir="ltr"` on the track keeps the options in the order the design fixes
 * (sun left, moon right) under Arabic and Farsi too. That makes the
 * indicator's `translateX` and the Left/Right keys agree in every language,
 * which a mirrored track would need a second code path for (cf. `Switch`).
 */
function SegmentedRow({
  entry,
  focusedId,
  onFocusOption,
  registerRef,
}: {
  entry: MenuSegmented;
  focusedId: string | null;
  onFocusOption: (id: string) => void;
  registerRef: (id: string, node: HTMLButtonElement | null) => void;
}) {
  const labelId = useId();
  const active = entry.options.findIndex((option) => option.checked);

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      className="flex items-center justify-between gap-3 px-3 py-1.5"
    >
      <span id={labelId} className="text-body-sm text-text-primary">
        {entry.label}
      </span>
      <div dir="ltr" className="relative inline-flex shrink-0 rounded-pill bg-surface-sunken p-1">
        <span
          aria-hidden="true"
          data-segment-indicator=""
          data-position={active}
          className={cn(
            'pointer-events-none absolute start-1 top-1 h-8 w-8 rounded-pill bg-control-knob shadow-popover ring-1 ring-border',
            'transition-transform duration-moderate ease-out touch:h-11 touch:w-11',
            active < 0 && 'opacity-0',
          )}
          style={{ transform: `translateX(${String(Math.max(active, 0) * 100)}%)` }}
        />
        {entry.options.map((option) => (
          <button
            key={option.id}
            ref={(node) => registerRef(option.id, node)}
            type="button"
            role="menuitemradio"
            aria-checked={option.checked}
            aria-label={option.label}
            title={option.label}
            tabIndex={option.id === focusedId ? 0 : -1}
            onClick={() => {
              onFocusOption(option.id);
              option.onSelect();
            }}
            onMouseEnter={() => onFocusOption(option.id)}
            className={cn(
              'relative inline-flex h-8 w-8 items-center justify-center rounded-pill touch:h-11 touch:w-11',
              'transition-colors duration-base ease-out',
              option.checked
                ? (option.activeClassName ?? 'text-text-primary')
                : 'text-text-tertiary hover:text-text-secondary',
            )}
          >
            <option.icon aria-hidden="true" className="h-5 w-5" strokeWidth={1.75} />
          </button>
        ))}
      </div>
    </div>
  );
}
