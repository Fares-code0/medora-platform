import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { createPortal } from 'react-dom';

import { useOutsideClick } from '@/hooks/useOutsideClick';
import { cn } from '@/utils/cn';

import { MenuList, type MenuEntry } from './internal/MenuList';

/**
 * ContextMenu — right-click menu sharing the DS §8.13 menu pattern.
 * Opens at the pointer position (clamped to the viewport) in a portal;
 * focus moves into the menu and returns to the previously focused element
 * on close. Item semantics and keyboard behavior come from MenuList.
 */
export interface ContextMenuProps {
  entries: readonly MenuEntry[];
  children: ReactNode;
  disabled?: boolean;
  menuLabel?: string | undefined;
  className?: string;
}

const MENU_ESTIMATED_WIDTH = 200;
const MENU_ESTIMATED_HEIGHT = 240;

export function ContextMenu({
  entries,
  children,
  disabled = false,
  menuLabel,
  className,
}: ContextMenuProps) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    setPosition(null);
    previousFocus.current?.focus();
  }, []);

  useOutsideClick([menuRef], close, position !== null);

  useEffect(() => {
    if (!position) return;
    const onScroll = () => close();
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [position, close]);

  return (
    <div
      className={cn('contents', className)}
      onContextMenu={(event) => {
        if (disabled) return;
        event.preventDefault();
        previousFocus.current =
          document.activeElement instanceof HTMLElement ? document.activeElement : null;
        setPosition({
          x: Math.min(event.clientX, window.innerWidth - MENU_ESTIMATED_WIDTH),
          y: Math.min(event.clientY, window.innerHeight - MENU_ESTIMATED_HEIGHT),
        });
      }}
    >
      {children}
      {position
        ? createPortal(
            <div
              ref={menuRef}
              className="fixed z-dropdown animate-menu-in"
              style={{ left: position.x, top: position.y }}
            >
              <MenuList entries={entries} onClose={close} aria-label={menuLabel} />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
