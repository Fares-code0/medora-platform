import {
  createContext,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, ReactNode } from 'react';

import { ChevronDown, ChevronRight, type LucideIcon } from 'lucide-react';

import { cn } from '@/utils/cn';

import { CountBadge } from './Badge';

/**
 * Sidebar — DS §8.16 (presentational shell chrome).
 * 224px expanded / 64px icon rail collapsed. The collapsed rail shows icons
 * only — no hover labels or tooltips beside them (a design decision); each
 * icon keeps its name as its accessible label, so assistive technology
 * still announces it. Active item: primary-subtle bg + 3px left indicator bar (the
 * bar keeps the state visible without color perception). The Phase 3
 * layouts/Sidebar wraps this with the role-based menu config — this
 * component knows nothing about roles or routes.
 */

const SidebarContext = createContext<{ collapsed: boolean }>({ collapsed: false });

export interface SidebarProps {
  collapsed?: boolean;
  /** Brand/logo region pinned to the top. */
  header?: ReactNode;
  /** Bottom-pinned region (settings, help, user card — DS §8.16). */
  footer?: ReactNode;
  /** Extra classes for the footer region (e.g. a tighter mobile-drawer footer). */
  footerClassName?: string | undefined;
  'aria-label'?: string;
  className?: string | undefined;
  children: ReactNode;
}

export function Sidebar({
  collapsed = false,
  header,
  footer,
  footerClassName,
  'aria-label': ariaLabel = 'Main',
  className,
  children,
}: SidebarProps) {
  return (
    <SidebarContext.Provider value={{ collapsed }}>
      <nav
        aria-label={ariaLabel}
        className={cn(
          'flex h-full shrink-0 flex-col border-e border-border bg-surface',
          // The rail resizes the page beside it, so it moves on the entrance
          // length rather than a panel's: long enough to follow, short
          // enough that the content does not reflow for half a second. The
          // row labels truncate, so none spills while the rail grows.
          'transition-[width] duration-entrance ease-emphasized',
          collapsed ? 'w-16' : 'w-56',
          className,
        )}
      >
        {header ? <div className={cn('shrink-0 p-4', collapsed && 'px-2')}>{header}</div> : null}
        {/* Scrolls without a visible scrollbar (`scrollbar-hidden`, globals.css):
            the bar sat on the sidebar's edge against the page, and on the
            64px rail took a sixth of its width. */}
        <div className={cn('flex-1 overflow-y-auto p-3 scrollbar-hidden', collapsed && 'px-2')}>
          {children}
        </div>
        {footer ? (
          <div
            className={cn(
              'shrink-0 border-t border-border p-3',
              collapsed && 'px-2',
              footerClassName,
            )}
          >
            {footer}
          </div>
        ) : null}
      </nav>
    </SidebarContext.Provider>
  );
}

/** Overline group label; hidden (divider only) when collapsed. */
export function SidebarSection({
  label,
  children,
}: {
  label?: string | undefined;
  children: ReactNode;
}) {
  const { collapsed } = useContext(SidebarContext);
  return (
    <div className="flex flex-col gap-0.5 pb-3">
      {label ? (
        collapsed ? (
          <div aria-hidden="true" className="mx-2 mb-1 h-px bg-border" />
        ) : (
          <p className="px-2.5 pb-1 pt-1 text-caption font-semibold uppercase tracking-wider text-text-tertiary">
            {label}
          </p>
        )
      ) : null}
      {children}
    </div>
  );
}

export interface SidebarItemProps {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  badgeCount?: number | undefined;
  disabled?: boolean;
  href?: string | undefined;
  onClick?: (() => void) | undefined;
  className?: string | undefined;
}

/** Row classes shared by an item and a group's parent row. */
function rowClasses(active: boolean, collapsed: boolean, disabled = false) {
  return cn(
    // Stacked rows: on a coarse pointer each grows to 44px rather than
    // extending over its neighbour (DEC-008).
    'relative flex h-8 w-full items-center gap-2.5 rounded-surface px-2.5 text-body-sm touch:h-11',
    'transition-colors duration-base ease-out',
    active
      ? 'bg-primary-subtle font-semibold text-primary'
      : 'font-medium text-text-secondary hover:bg-surface-sunken hover:text-text-primary',
    disabled &&
      'cursor-not-allowed text-text-disabled hover:bg-transparent hover:text-text-disabled',
    collapsed && 'justify-center px-0',
  );
}

function ActiveBar() {
  return (
    <span
      aria-hidden="true"
      className="absolute inset-y-2 start-0 w-[3px] rounded-pill bg-primary"
    />
  );
}

export function SidebarItem({
  icon: Icon,
  label,
  active = false,
  badgeCount,
  disabled = false,
  href,
  onClick,
  className,
}: SidebarItemProps) {
  const { collapsed } = useContext(SidebarContext);

  const classes = cn(rowClasses(active, collapsed, disabled), className);

  const content = (
    <>
      {active ? <ActiveBar /> : null}
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={1.75} />
      {!collapsed ? <span className="flex-1 truncate text-start">{label}</span> : null}
      {!collapsed && badgeCount !== undefined ? (
        <CountBadge count={badgeCount} aria-label={`${String(badgeCount)} unread`} />
      ) : null}
      {collapsed && badgeCount !== undefined && badgeCount > 0 ? (
        <span
          aria-hidden="true"
          className="absolute end-1.5 top-1.5 h-2 w-2 rounded-pill bg-error"
        />
      ) : null}
    </>
  );

  const element =
    href !== undefined && !disabled ? (
      <a
        href={href}
        onClick={onClick}
        aria-current={active ? 'page' : undefined}
        // Collapsed, the link is an icon alone: its name lives here, for
        // assistive technology, and nothing is shown beside it on hover.
        aria-label={collapsed ? label : undefined}
        className={classes}
      >
        {content}
      </a>
    ) : (
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        aria-current={active ? 'page' : undefined}
        aria-label={collapsed ? label : undefined}
        className={classes}
      >
        {content}
      </button>
    );

  return element;
}

/*
 * SidebarGroup — a parent row with nested destinations (DS §8.16).
 *
 * The parent is a disclosure, not a link: choosing it opens or closes its
 * list and never navigates. It carries the active state whenever one of its
 * children is the current page, so the area stays lit while its list is shut.
 *
 * Expanded sidebar: the list opens inline beneath the parent on a thin guide
 * rule. Its real height and its opacity transition together over 700ms on
 * the emphasized curve (`--duration-expand`), and so does the close — the
 * list is never unmounted, only shut, so closing is as smooth as opening.
 * Because the groups are an accordion, opening one while another is open
 * runs both at once: one list folds while the other unfolds, on the same
 * clock and curve, so the rows below move once rather than jumping twice.
 * Reduced motion makes all of it instant.
 *
 * Collapsed rail: there is no room inline, so the list opens as a flyout
 * beside the rail. It is `position: fixed`, which escapes the rail's
 * scrolling overflow, and it stays in the sidebar's DOM so Tab moves from
 * its last link on to the next rail item. It closes on a choice, an outside
 * click, Escape (returning focus to the parent) or focus leaving it.
 */

const GroupContext = createContext<{ flyout: boolean; close: () => void }>({
  flyout: false,
  close: () => undefined,
});

/** Space between the rail's edge and the flyout, and the flyout and the viewport. */
const FLYOUT_GAP = 6;
const FLYOUT_MARGIN = 8;

export interface SidebarGroupProps {
  icon: LucideIcon;
  label: string;
  /** One of the group's routes is the current page. */
  active?: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** `SidebarSubItem`s. */
  children: ReactNode;
}

export function SidebarGroup({
  icon: Icon,
  label,
  active = false,
  open,
  onOpenChange,
  children,
}: SidebarGroupProps) {
  const { collapsed } = useContext(SidebarContext);
  const listId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const flyoutOpen = collapsed && open;
  // Held in a ref so a caller's inline handler does not re-run the flyout
  // effect (and pull focus back to its first link) on every render.
  const onOpenChangeRef = useRef(onOpenChange);
  onOpenChangeRef.current = onOpenChange;

  // Flyout geometry: beside the rail, level with the parent, kept on screen.
  useLayoutEffect(() => {
    if (!flyoutOpen) {
      setPosition(null);
      return undefined;
    }
    const place = () => {
      const button = buttonRef.current;
      const flyout = flyoutRef.current;
      if (!button || !flyout) return;
      const row = button.getBoundingClientRect();
      const rail = (button.closest('nav') ?? button).getBoundingClientRect();
      const top = Math.max(
        FLYOUT_MARGIN,
        Math.min(row.top, window.innerHeight - flyout.offsetHeight - FLYOUT_MARGIN),
      );
      const rtl = getComputedStyle(button).direction === 'rtl';
      setPosition(
        rtl
          ? { top, right: window.innerWidth - rail.left + FLYOUT_GAP }
          : { top, left: rail.right + FLYOUT_GAP },
      );
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [flyoutOpen]);

  // Flyout: focus its first link on open; dismiss on outside click, Escape or
  // focus moving elsewhere.
  useEffect(() => {
    if (!flyoutOpen) return undefined;
    flyoutRef.current?.querySelector<HTMLElement>('a')?.focus();
    const inside = (node: EventTarget | null) =>
      node instanceof Node &&
      (flyoutRef.current?.contains(node) === true || buttonRef.current?.contains(node) === true);
    const close = () => onOpenChangeRef.current(false);
    const onPointerDown = (event: MouseEvent) => {
      if (!inside(event.target)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      close();
      buttonRef.current?.focus();
    };
    const onFocusIn = (event: FocusEvent) => {
      if (!inside(event.target)) close();
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('focusin', onFocusIn);
    };
  }, [flyoutOpen]);

  const button = (
    <button
      ref={buttonRef}
      type="button"
      aria-expanded={open}
      aria-controls={listId}
      aria-label={collapsed ? label : undefined}
      onClick={() => onOpenChange(!open)}
      className={rowClasses(active, collapsed)}
    >
      {active ? <ActiveBar /> : null}
      <Icon aria-hidden="true" className="h-4 w-4 shrink-0" strokeWidth={1.75} />
      {collapsed ? (
        // On the rail the row is an icon alone; a small chevron toward the
        // flyout says it opens a list. Pinned to the row's end so the icon
        // stays centred with every other rail item.
        <ChevronRight
          aria-hidden="true"
          data-testid="sidebar-group-chevron"
          strokeWidth={2}
          className="pointer-events-none absolute end-0.5 top-1/2 h-3 w-3 -translate-y-1/2 opacity-70 rtl:-scale-x-100"
        />
      ) : (
        <>
          <span className="flex-1 truncate text-start">{label}</span>
          <ChevronDown
            aria-hidden="true"
            strokeWidth={1.75}
            className={cn(
              'h-4 w-4 shrink-0 transition-transform duration-popover ease-emphasized motion-reduce:transition-none',
              open && 'rotate-180',
            )}
          />
        </>
      )}
    </button>
  );

  if (collapsed) {
    return (
      // The rail shows the icon and its chevron only — no hover label. The
      // row spans the rail, centring the icon with every other rail item.
      <div className="flex flex-col">
        {button}
        {open ? (
          <GroupContext.Provider value={{ flyout: true, close: () => onOpenChange(false) }}>
            <div
              ref={flyoutRef}
              id={listId}
              role="group"
              aria-label={label}
              data-sidebar-flyout=""
              // First frame: laid out to be measured, never seen.
              style={
                position
                  ? { position: 'fixed', ...position }
                  : { position: 'fixed', top: 0, left: 0, opacity: 0, pointerEvents: 'none' }
              }
              className="z-dropdown w-56 animate-popover-in rounded-surface border border-border bg-surface-overlay p-1 shadow-popover"
            >
              <p className="px-2.5 pb-1 pt-1.5 text-caption font-semibold uppercase tracking-wider text-text-tertiary">
                {label}
              </p>
              <ul className="flex flex-col gap-0.5">{children}</ul>
            </div>
          </GroupContext.Provider>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      {button}
      {/* 0fr → 1fr animates the list's real height; `invisible` takes the
          shut list out of the tab order and the accessibility tree, and is
          transitioned too so the list stays visible while it closes. */}
      <div
        id={listId}
        className={cn(
          'grid transition-[grid-template-rows,opacity,visibility] duration-expand ease-emphasized motion-reduce:transition-none',
          open ? 'visible grid-rows-[1fr] opacity-100' : 'invisible grid-rows-[0fr] opacity-0',
        )}
      >
        <div className="overflow-hidden">
          <GroupContext.Provider value={{ flyout: false, close: () => undefined }}>
            <ul className="ms-[1.0625rem] mt-0.5 flex flex-col gap-0.5 border-s border-border ps-2">
              {children}
            </ul>
          </GroupContext.Provider>
        </div>
      </div>
    </div>
  );
}

export interface SidebarSubItemProps {
  label: string;
  href: string;
  active?: boolean;
  onClick?: (() => void) | undefined;
}

export function SidebarSubItem({ label, href, active = false, onClick }: SidebarSubItemProps) {
  const { flyout, close } = useContext(GroupContext);
  return (
    <li>
      <a
        href={href}
        aria-current={active ? 'page' : undefined}
        onClick={() => {
          if (flyout) close();
          onClick?.();
        }}
        className={cn(
          'relative flex h-8 w-full items-center rounded-surface px-2.5 text-body-sm touch:h-11',
          'transition-colors duration-base ease-out',
          active
            ? cn('font-semibold text-primary', flyout && 'bg-primary-subtle')
            : 'font-medium text-text-secondary hover:bg-surface-sunken hover:text-text-primary',
        )}
      >
        {/* Inline, the current child marks the guide rule it sits on. */}
        {active && !flyout ? (
          <span
            aria-hidden="true"
            className="absolute inset-y-1.5 -start-[0.5625rem] w-0.5 rounded-pill bg-primary"
          />
        ) : null}
        <span className="truncate">{label}</span>
      </a>
    </li>
  );
}
