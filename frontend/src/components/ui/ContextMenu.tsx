import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { createPortal } from 'react-dom';

import { useOutsideClick } from '@/hooks/useOutsideClick';
import { cn } from '@/utils/cn';

import {
  applyGeometry,
  computeFloating,
  measureContentHeight,
  readViewport,
} from './internal/floating';
import { MenuList, type MenuEntry } from './internal/MenuList';

/**
 * ContextMenu — right-click menu sharing the DS §8.13 menu pattern.
 * Opens at the pointer position in a portal, measured and clamped to the
 * visible viewport on both axes (flipping above the pointer when there is no
 * room below), with a viewport-relative max-height so a long menu scrolls
 * inside its own surface. Any page scroll or viewport resize closes it.
 * Focus moves into the menu and returns to the previously focused element
 * on close. Item semantics and keyboard behavior come from MenuList.
 */
export interface ContextMenuProps {
  entries: readonly MenuEntry[];
  children: ReactNode;
  disabled?: boolean;
  menuLabel?: string | undefined;
  className?: string;
}

const MENU_CAP = 400;

interface OpenState {
  readonly x: number;
  readonly y: number;
  readonly rtl: boolean;
}

export function ContextMenu({
  entries,
  children,
  disabled = false,
  menuLabel,
  className,
}: ContextMenuProps) {
  const [position, setPosition] = useState<OpenState | null>(null);
  const [placed, setPlaced] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setPosition(null);
    previousFocus.current?.focus();
  }, []);

  useOutsideClick([menuRef], close, position !== null);

  // Measure the real menu, then place it — before paint.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!position || !menu) {
      setPlaced(false);
      return;
    }
    menu.style.top = '0px';
    menu.style.left = '0px';
    applyGeometry(
      menu,
      computeFloating({
        anchor: { top: position.y, bottom: position.y, left: position.x, right: position.x, width: 0 },
        viewport: readViewport(),
        contentHeight: measureContentHeight(menu),
        contentWidth: menu.offsetWidth,
        cap: MENU_CAP,
        align: 'start',
        matchWidth: false,
        rtl: position.rtl,
      }),
    );
    setPlaced(true);
  }, [position]);

  useEffect(() => {
    if (!position) return;
    const onScroll = (event: Event) => {
      // Scrolling the menu's own list keeps it open.
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      close();
    };
    const vv = window.visualViewport;
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    vv?.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
      vv?.removeEventListener('resize', close);
    };
  }, [position, close]);

  return (
    <div
      className={cn('contents', className)}
      onContextMenu={(event) => {
        if (disabled) return;
        event.preventDefault();
        previousFocus.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const target = event.target instanceof Element ? event.target : event.currentTarget;
        setPosition({
          x: event.clientX,
          y: event.clientY,
          rtl: getComputedStyle(target).direction === 'rtl',
        });
      }}
    >
      {children}
      {position
        ? createPortal(
            <div
              ref={menuRef}
              className="fixed z-dropdown flex flex-col animate-menu-in"
              // First frame is measured unseen; opacity, not visibility, so
              // MenuList can still take focus.
              style={placed ? undefined : { opacity: 0, pointerEvents: 'none' }}
            >
              <MenuList entries={entries} onClose={close} aria-label={menuLabel} />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
