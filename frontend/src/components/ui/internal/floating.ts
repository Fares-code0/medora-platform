import { useLayoutEffect, useRef, useState } from 'react';
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
 * "Room" is measured against the *visible* viewport (`visualViewport` where
 * the browser has one — on a phone the toolbars and the on-screen keyboard
 * eat into `innerHeight`), less a small edge margin, and the menu's height
 * never exceeds `VIEWPORT_HEIGHT_RATIO` of it, so on a phone a long menu is a
 * compact scrolling panel beside its trigger rather than a full-height sheet.
 * Horizontally it is clamped on both sides and given a `max-width`, so it can
 * never hang off a narrow screen.
 *
 * Fixed positioning never adds to the page's height, so opening a menu
 * cannot push content or add a scrollbar. The geometry is recomputed when the
 * viewport resizes or anything scrolls and written straight to the element in
 * the event handler — not through a React render a frame later — so the menu
 * stays on its trigger while the page scrolls. When the trigger scrolls fully
 * out of view (of the viewport or of any clipping ancestor), `onAnchorHidden`
 * is called so the owner can close the menu.
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
/** The tallest a menu may be, as a share of the visible viewport height. */
export const VIEWPORT_HEIGHT_RATIO = 0.6;

export interface AnchorRect {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly width: number;
}

/**
 * The visible area, in the coordinates `position: fixed` and
 * `getBoundingClientRect` use (the layout viewport). `offsetTop/offsetLeft`
 * place the visual viewport inside the layout viewport; `layoutWidth/Height`
 * are the layout viewport's own size, which `right`/`bottom` are measured
 * from. All default to a plain, unzoomed viewport.
 */
export interface FloatingViewport {
  readonly width: number;
  readonly height: number;
  readonly offsetTop?: number;
  readonly offsetLeft?: number;
  readonly layoutWidth?: number;
  readonly layoutHeight?: number;
}

export interface FloatingGeometry {
  readonly placement: FloatingPlacement;
  readonly top?: number;
  readonly bottom?: number;
  readonly left?: number;
  readonly right?: number;
  readonly width?: number;
  readonly maxHeight: number;
  readonly maxWidth: number;
}

export interface FloatingInput {
  readonly anchor: AnchorRect;
  readonly viewport: FloatingViewport;
  /** The menu's natural height, uncapped. */
  readonly contentHeight: number;
  /** The menu's rendered width, if known (0 when not measured). */
  readonly contentWidth?: number;
  /** The tallest the menu may ever be (its design cap, e.g. 320px). */
  readonly cap: number;
  readonly align: FloatingAlign;
  /** Make the menu exactly as wide as its trigger (a select's listbox). */
  readonly matchWidth: boolean;
  readonly rtl: boolean;
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

/** Pure geometry — the whole decision, so it can be tested without a browser. */
export function computeFloating({
  anchor,
  viewport,
  contentHeight,
  contentWidth = 0,
  cap,
  align,
  matchWidth,
  rtl,
}: FloatingInput): FloatingGeometry {
  const offsetTop = viewport.offsetTop ?? 0;
  const offsetLeft = viewport.offsetLeft ?? 0;
  const layoutWidth = viewport.layoutWidth ?? offsetLeft + viewport.width;
  const layoutHeight = viewport.layoutHeight ?? offsetTop + viewport.height;

  // The visible box, less the edge margin.
  const minY = offsetTop + FLOATING_MARGIN;
  const maxY = offsetTop + viewport.height - FLOATING_MARGIN;
  const minX = offsetLeft + FLOATING_MARGIN;
  const maxX = offsetLeft + viewport.width - FLOATING_MARGIN;

  // Where the menu's edge would sit on each side, kept inside the visible box.
  const topEdge = clamp(anchor.bottom + FLOATING_GAP, minY, maxY);
  const bottomEdge = clamp(anchor.top - FLOATING_GAP, minY, maxY);
  const below = Math.max(0, maxY - topEdge);
  const above = Math.max(0, bottomEdge - minY);

  const limit = Math.min(cap, Math.floor(viewport.height * VIEWPORT_HEIGHT_RATIO));
  const wanted = Math.min(contentHeight, limit);

  let placement: FloatingPlacement;
  if (wanted <= below) placement = 'bottom';
  else if (wanted <= above) placement = 'top';
  else placement = below >= above ? 'bottom' : 'top';
  const maxHeight = Math.min(limit, placement === 'bottom' ? below : above);

  const vertical =
    placement === 'bottom' ? { top: topEdge } : { bottom: layoutHeight - bottomEdge };

  // Never wider than the visible box; a select matches its trigger within that.
  const maxWidth = Math.max(0, maxX - minX);
  const width = matchWidth ? Math.min(anchor.width, maxWidth) : undefined;
  const menuWidth = Math.min(width ?? contentWidth, maxWidth);

  // Logical start/end → physical sides, mirrored in a right-to-left page.
  // The pinned edge follows the trigger, then the whole menu is clamped so
  // neither of its edges leaves the visible box.
  const startIsLeft = !rtl;
  const pinLeft = matchWidth || (align === 'start') === startIsLeft;
  const horizontal = pinLeft
    ? { left: clamp(anchor.left, minX, Math.max(minX, maxX - menuWidth)) }
    : { right: layoutWidth - clamp(anchor.right, Math.min(maxX, minX + menuWidth), maxX) };

  return {
    placement,
    maxHeight,
    maxWidth,
    ...vertical,
    ...horizontal,
    ...(width !== undefined ? { width } : {}),
  };
}

/**
 * True when no part of the trigger is visible — outside the viewport, or
 * scrolled out of any of the clipping boxes it sits in. A trigger with no
 * box at all (not laid out) cannot be judged, so it is never "hidden".
 */
export function isAnchorHidden(anchor: AnchorRect, clips: readonly AnchorRect[]): boolean {
  if (anchor.bottom <= anchor.top || anchor.right <= anchor.left) return false;
  let top = anchor.top;
  let bottom = anchor.bottom;
  let left = anchor.left;
  let right = anchor.right;
  for (const clip of clips) {
    // A clip box with no area (a `display: contents` wrapper, an ancestor
    // not laid out yet) clips nothing real: skipping it keeps a visible
    // trigger from reading as hidden and closing its menu on open.
    if (clip.bottom <= clip.top || clip.right <= clip.left) continue;
    top = Math.max(top, clip.top);
    bottom = Math.min(bottom, clip.bottom);
    left = Math.max(left, clip.left);
    right = Math.min(right, clip.right);
  }
  return bottom <= top || right <= left;
}

/** The visible viewport, from `visualViewport` when the browser has one. */
export function readViewport(): FloatingViewport {
  const layoutWidth = document.documentElement.clientWidth || window.innerWidth;
  const layoutHeight = window.innerHeight;
  const vv = window.visualViewport;
  if (!vv) return { width: layoutWidth, height: layoutHeight, layoutWidth, layoutHeight };
  return {
    width: vv.width,
    height: vv.height,
    offsetTop: vv.offsetTop,
    offsetLeft: vv.offsetLeft,
    layoutWidth,
    layoutHeight,
  };
}

/** The viewport as a clip box, in layout-viewport coordinates. */
export function viewportRect(viewport: FloatingViewport): AnchorRect {
  const top = viewport.offsetTop ?? 0;
  const left = viewport.offsetLeft ?? 0;
  return {
    top,
    left,
    bottom: top + viewport.height,
    right: left + viewport.width,
    width: viewport.width,
  };
}

const naturalHeight = (el: HTMLElement) => el.scrollHeight + (el.offsetHeight - el.clientHeight);

/**
 * The menu's natural (uncapped) height. When the scrolling surface is a
 * descendant marked `data-floating-scroller` (MenuList), that is what holds
 * the overflow; otherwise the floating element scrolls itself (Select).
 */
export function measureContentHeight(floating: HTMLElement): number {
  const scroller = floating.querySelector<HTMLElement>('[data-floating-scroller]');
  if (!scroller) return naturalHeight(floating);
  return naturalHeight(scroller) + (floating.offsetHeight - scroller.offsetHeight);
}

const GEOMETRY_SIDES = ['top', 'bottom', 'left', 'right', 'width', 'maxHeight', 'maxWidth'] as const;

/** Write the geometry straight to the element; sides it leaves unset are cleared. */
export function applyGeometry(el: HTMLElement, geometry: FloatingGeometry): void {
  for (const side of GEOMETRY_SIDES) {
    const value = geometry[side];
    el.style[side] = value === undefined ? '' : `${value}px`;
  }
}

function clippingAncestors(el: HTMLElement): HTMLElement[] {
  const result: HTMLElement[] = [];
  for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(node);
    if (/(auto|scroll|hidden|clip)/.test(overflowX + overflowY)) result.push(node);
  }
  return result;
}

export interface UseFloatingOptions {
  readonly align?: FloatingAlign;
  readonly matchWidth?: boolean;
  /** Design cap on the menu's height, px. */
  readonly cap?: number;
  /** Called when the trigger has scrolled fully out of view (e.g. to close). */
  readonly onAnchorHidden?: () => void;
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
  { align = 'start', matchWidth = false, cap = 320, onAnchorHidden }: UseFloatingOptions = {},
): FloatingLayer<T> {
  const floatingRef = useRef<T | null>(null);
  const [placement, setPlacement] = useState<FloatingPlacement | null>(null);
  const onHiddenRef = useRef(onAnchorHidden);
  onHiddenRef.current = onAnchorHidden;

  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return undefined;
    }
    const anchorEl = anchorRef.current;
    if (!anchorEl) return undefined;
    const clips = clippingAncestors(anchorEl);
    const rtl = getComputedStyle(anchorEl).direction === 'rtl';

    // Synchronous: positions are written to the element inside the scroll
    // handler itself, so the menu moves in the same frame as the page.
    const update = (): boolean => {
      const floating = floatingRef.current;
      if (!floating) return false;
      const rect = anchorEl.getBoundingClientRect();
      const viewport = readViewport();
      if (
        onHiddenRef.current &&
        isAnchorHidden(rect, [viewportRect(viewport), ...clips.map((c) => c.getBoundingClientRect())])
      ) {
        onHiddenRef.current();
        return false;
      }
      const geometry = computeFloating({
        anchor: rect,
        viewport,
        contentHeight: measureContentHeight(floating),
        contentWidth: floating.offsetWidth,
        cap,
        align,
        matchWidth,
        rtl,
      });
      applyGeometry(floating, geometry);
      setPlacement(geometry.placement);
      return true;
    };

    // First measurement: at the origin, unconstrained by any previous position.
    const initial = floatingRef.current;
    if (initial) {
      initial.style.top = '0px';
      initial.style.left = '0px';
      initial.style.maxWidth = `${readViewport().width - 2 * FLOATING_MARGIN}px`;
    }
    update();

    const onScroll = (event: Event) => {
      // Scrolling the menu's own list moves nothing.
      if (event.target instanceof Node && floatingRef.current?.contains(event.target)) return;
      update();
    };
    const onResize = () => update();
    const vv = window.visualViewport;
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);
    vv?.addEventListener('resize', onResize);
    vv?.addEventListener('scroll', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
      vv?.removeEventListener('resize', onResize);
      vv?.removeEventListener('scroll', onResize);
    };
  }, [open, anchorRef, align, matchWidth, cap]);

  // React owns only these; the geometry itself is written by `applyGeometry`.
  // First frame: laid out where it can be measured, never seen. Opacity,
  // not visibility — a listbox focuses itself on open, and a hidden element
  // cannot take focus.
  const style: CSSProperties = placement
    ? { position: 'fixed' }
    : { position: 'fixed', opacity: 0, pointerEvents: 'none' };

  const anchor = anchorRef.current;
  const container =
    typeof document === 'undefined' ? null : (anchor?.closest('dialog') ?? document.body);

  return { floatingRef, style, placement: placement ?? 'bottom', container };
}
