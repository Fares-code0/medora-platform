/**
 * Geometry for a navbar popover that drops down from its trigger (the
 * notification bell). Pure, so every viewport case is unit-testable without
 * a layout engine.
 *
 * The panel hangs beneath the trigger and lines up with the trigger's
 * reading-end edge — its right edge in English, its left edge in Arabic —
 * so it reads as coming *out of* the button rather than appearing somewhere
 * on the right. When that would push it past the viewport (a phone, where
 * the bell sits a few pixels from the edge and the panel is wider than the
 * space beside it), it slides back inside with an `EDGE` margin, and the
 * caret moves along its top edge so it still points at the bell.
 */

/** Widest the panel gets; narrower viewports shrink it to fit. */
export const PANEL_MAX_WIDTH = 380;
/** Minimum distance kept between the panel and either viewport edge. */
export const PANEL_EDGE = 12;
/** Vertical gap between the trigger's bottom and the panel's top. */
export const PANEL_GAP = 8;
/** The caret never sits closer than this to either of the panel's corners. */
const CARET_INSET = 18;

export interface TriggerRect {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
  readonly width: number;
}

export interface AnchoredPanelPosition {
  /** Viewport (fixed-position) coordinates of the panel's top-left corner. */
  readonly top: number;
  readonly left: number;
  readonly width: number;
  /** The caret's centre, measured from the panel's left edge. */
  readonly caretX: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function computeAnchoredPanel(
  trigger: TriggerRect,
  viewportWidth: number,
  rtl: boolean,
): AnchoredPanelPosition {
  const width = Math.max(0, Math.min(PANEL_MAX_WIDTH, viewportWidth - PANEL_EDGE * 2));
  const preferredLeft = rtl ? trigger.left : trigger.right - width;
  const left = clamp(preferredLeft, PANEL_EDGE, viewportWidth - width - PANEL_EDGE);
  const caretX = clamp(
    trigger.left + trigger.width / 2 - left,
    CARET_INSET,
    Math.max(CARET_INSET, width - CARET_INSET),
  );
  return { top: trigger.bottom + PANEL_GAP, left, width, caretX };
}
