import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, MutableRefObject, RefObject } from 'react';

/**
 * Floating layer — where a dropdown's menu goes, and which way it opens.
 *
 * A menu positioned `absolute` inside its trigger's wrapper is clipped by any
 * ancestor with `overflow: hidden|auto` (a card, a table, a drawer body), and
 * it can only ever open downward. Every dropdown now renders its menu through
 * a portal at `position: fixed`, measured against the trigger:
 *
 * - room below for the whole menu        → opens downward;
 * - not below, but room above            → opens upward;
 * - room for it on neither side          → opens toward the larger side with
 *                                          its height capped to that space,
 *                                          and its contents scroll.
 *
 * Fixed positioning never adds to the page's height, so opening a menu
 * cannot push content or add a scrollbar. The geometry is recomputed when the
 * viewport resizes or anything scrolls, so the menu stays on its trigger.
 *
 * The portal target is the trigger's own `<dialog>` when it has one: Modal
 * and Drawer are native modal dialogs, which live in the browser's top layer
 * and make everything outside them inert — a menu portaled to `<body>` would
 * render beneath the dialog and could not be clicked.
 */

export type FloatingPlacement = 'bottom' | 'top';
export type FloatingAlign = 'start' | 'end';

/** Space kept between the trigger and the menu, and between the menu and the viewport edge. */
export const FLOATING_GAP = 4;
export const FLOATING_MARGIN = 8;

export interface AnchorRect {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly width: number;
}

export interface FloatingGeometry {
  readonly placement: FloatingPlacement;
  readonly top?: number;
  readonly bottom?: number;
  readonly left?: number;
  readonly right?: number;
  readonly width?: number;
  readonly maxHeight: number;
}

export interface FloatingInput {
  readonly anchor: AnchorRect;
  readonly viewport: { readonly width: number; readonly height: number };
  /** The menu's natural height, uncapped. */
  readonly contentHeight: number;
  /** The tallest the menu may ever be (its design cap, e.g. 320px). */
  readonly cap: number;
  readonly align: FloatingAlign;
  /** Make the menu exactly as wide as its trigger (a select's listbox). */
  readonly matchWidth: boolean;
  readonly rtl: boolean;
}

/** Pure geometry — the whole decision, so it can be tested without a browser. */
export function computeFloating({
  anchor,
  viewport,
  contentHeight,
  cap,
  align,
  matchWidth,
  rtl,
}: FloatingInput): FloatingGeometry {
  const below = Math.max(0, viewport.height - anchor.bottom - FLOATING_GAP - FLOATING_MARGIN);
  const above = Math.max(0, anchor.top - FLOATING_GAP - FLOATING_MARGIN);
  const wanted = Math.min(contentHeight, cap);

  let placement: FloatingPlacement;
  let maxHeight: number;
  if (wanted <= below) {
    placement = 'bottom';
    maxHeight = Math.min(cap, below);
  } else if (wanted <= above) {
    placement = 'top';
    maxHeight = Math.min(cap, above);
  } else {
    placement = below >= above ? 'bottom' : 'top';
    maxHeight = Math.min(cap, placement === 'bottom' ? below : above);
  }

  const vertical =
    placement === 'bottom'
      ? { top: anchor.bottom + FLOATING_GAP }
      : { bottom: viewport.height - anchor.top + FLOATING_GAP };

  // Logical start/end → physical sides, mirrored in a right-to-left page.
  const startIsLeft = !rtl;
  const pinLeft = matchWidth || (align === 'start') === startIsLeft;
  const horizontal = pinLeft
    ? { left: Math.max(FLOATING_MARGIN, anchor.left) }
    : { right: Math.max(FLOATING_MARGIN, viewport.width - anchor.right) };

  return {
    placement,
    maxHeight,
    ...vertical,
    ...horizontal,
    ...(matchWidth ? { width: anchor.width } : {}),
  };
}

export interface UseFloatingOptions {
  readonly align?: FloatingAlign;
  readonly matchWidth?: boolean;
  /** Design cap on the menu's height, px. */
  readonly cap?: number;
}

export interface FloatingLayer<T extends HTMLElement> {
  readonly floatingRef: MutableRefObject<T | null>;
  readonly style: CSSProperties;
  readonly placement: FloatingPlacement;
  /** Where to portal the menu: the trigger's dialog, else `<body>`. */
  readonly container: HTMLElement | null;
}

export function useFloating<T extends HTMLElement>(
  open: boolean,
  anchorRef: RefObject<HTMLElement | null>,
  { align = 'start', matchWidth = false, cap = 320 }: UseFloatingOptions = {},
): FloatingLayer<T> {
  const floatingRef = useRef<T | null>(null);
  const [geometry, setGeometry] = useState<FloatingGeometry | null>(null);

  const update = useCallback(() => {
    const anchor = anchorRef.current;
    const floating = floatingRef.current;
    if (!anchor || !floating) return;
    const rect = anchor.getBoundingClientRect();
    // scrollHeight ignores the current max-height; add the borders back.
    const contentHeight = floating.scrollHeight + (floating.offsetHeight - floating.clientHeight);
    setGeometry(
      computeFloating({
        anchor: rect,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        contentHeight,
        cap,
        align,
        matchWidth,
        rtl: getComputedStyle(anchor).direction === 'rtl',
      }),
    );
  }, [anchorRef, align, matchWidth, cap]);

  useLayoutEffect(() => {
    if (!open) {
      setGeometry(null);
      return undefined;
    }
    update();
    const onScroll = (event: Event) => {
      // Scrolling the menu's own list moves nothing.
      if (event.target instanceof Node && floatingRef.current?.contains(event.target)) return;
      update();
    };
    window.addEventListener('resize', update);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [open, update]);

  let style: CSSProperties;
  if (geometry) {
    // Only the sides `computeFloating` set are written; the rest stay absent.
    style = { position: 'fixed', maxHeight: geometry.maxHeight };
    for (const side of ['top', 'bottom', 'left', 'right', 'width'] as const) {
      const value = geometry[side];
      if (value !== undefined) style[side] = value;
    }
  } else {
    // First frame: laid out where it can be measured, never seen. Opacity,
    // not visibility — a listbox focuses itself on open, and a hidden
    // element cannot take focus.
    style = { position: 'fixed', top: 0, left: 0, opacity: 0, pointerEvents: 'none' };
  }

  const anchor = anchorRef.current;
  const container =
    typeof document === 'undefined' ? null : (anchor?.closest('dialog') ?? document.body);

  return { floatingRef, style, placement: geometry?.placement ?? 'bottom', container };
}
